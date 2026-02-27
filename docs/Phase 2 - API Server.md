# MLS IDX Platform — Phase 2: API Server

## Overview

The consumer-facing API server that powers the IDX frontend. Serves property search with map-based browsing, typeahead, saved searches, and user features. Reads from the shared PostgreSQL database (populated by the Replication Worker in Phase 1) and proxies media from Cloudflare R2.

**Stack:** TypeScript (Node.js), Fastify, Drizzle ORM, PostgreSQL 16+ (PostGIS, pg_trgm), Cloudflare R2, Docker on Coolify

**Repo Scope:** This service owns all external-facing HTTP endpoints, search logic, user feature APIs, media proxying, and frontend serving. It is a read-heavy service with writes limited to user-generated data (saves, searches, preferences).

---

## Infrastructure

### Container Architecture (Coolify / Docker)

Single container, deployed independently:

| Container | Role | Scaling | Notes |
|---|---|---|---|
| **API Server** | Serves frontend, handles search/filter, proxies R2 media, manages user features | Stateless, horizontally scalable | Fastify recommended over Express for performance |

### PostgreSQL (Independent Instance)

The database is hosted separately and already provisioned. The API server connects as a read-heavy client, with writes limited to user feature tables (`saved_properties`, `saved_searches`, `user_refs`).

### Cloudflare R2

The API server generates signed URLs or proxies through a lightweight endpoint to serve images to the frontend. MLS Grid's MediaURLs must never be exposed to end users — all media is served from R2.

### Technology Summary

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript (Node.js) | Shared types with replication worker via shared package |
| API Framework | Fastify | Lighter and faster than Express |
| ORM | Drizzle | Better raw SQL control for PostGIS, JSONB, array queries |
| Database | PostgreSQL 16+ | PostGIS, pg_trgm extensions |
| Object Storage | Cloudflare R2 | Media proxying / signed URLs |
| Deployment | Docker on Coolify | Single stateless container |
| Frontend (TBD) | React / Next.js | Shared TypeScript types with backend |

---

## Database Schema — API-Owned Tables

The API server reads from all tables created by the Replication Worker (Phase 1). It additionally owns the following tables for user features and search infrastructure.

### User Feature Tables

> **Note:** User authentication, profile data, and settings are managed by a separate Auth API. This database stores only a UUID reference for FK relationships. The Auth API provides the `user_id` after token validation.

#### `user_refs`

Thin reference table. Not the source of truth for user data.

```
user_refs
├── id                 UUID PRIMARY KEY        -- provided by external Auth API
├── created_at         TIMESTAMPTZ DEFAULT NOW()
```

**User Deletion:** When a user is deleted in the external Auth API, handle via webhook: soft-delete the reference and gracefully orphan their saved data. Do not cascade-delete `saved_properties` or `saved_searches`.

#### `saved_properties`

```
saved_properties
├── id                 BIGSERIAL PRIMARY KEY
├── user_id            UUID NOT NULL           -- FK to user_refs
├── listing_key        VARCHAR NOT NULL        -- FK to properties
├── notes              TEXT                    -- user's private notes
├── saved_at           TIMESTAMPTZ DEFAULT NOW()
├── UNIQUE(user_id, listing_key)
```

**Note:** When a property's `MlgCanView` flips to false, do NOT cascade-delete. Keep the save and show "This listing is no longer available" in the UI. Users appreciate knowing what they previously saved.

#### `saved_searches`

Alert columns (`alerts_enabled`, `alert_types`, `alert_frequency`) are included now so users can configure preferences before the notification system is wired up in Phase 3.

```
saved_searches
├── id                 BIGSERIAL PRIMARY KEY
├── user_id            UUID NOT NULL           -- FK to user_refs
├── name               VARCHAR NOT NULL        -- user-defined label
├── filters            JSONB NOT NULL          -- serialized search parameters
├── alerts_enabled     BOOLEAN DEFAULT false   -- Phase 3 activation
├── alert_types        TEXT[]                  -- ['new_listing', 'price_drop']
├── alert_frequency    VARCHAR DEFAULT 'daily' -- 'instant', 'daily', 'weekly'
├── last_alerted_at    TIMESTAMPTZ             -- Phase 3 activation
├── created_at         TIMESTAMPTZ DEFAULT NOW()
├── updated_at         TIMESTAMPTZ DEFAULT NOW()
```

**`filters` JSONB structure example:**
```json
{
  "min_price": 300000,
  "max_price": 600000,
  "min_beds": 3,
  "min_baths": 2,
  "property_type": "Residential",
  "standard_status": ["Active", "Coming Soon"],
  "min_sqft": 1500,
  "bounds": {
    "sw": { "lat": 30.25, "lng": -97.85 },
    "ne": { "lat": 30.45, "lng": -97.65 }
  },
  "postal_codes": ["78626", "78628"]
}
```

> **Phase 3 Placeholder:** `pending_notifications` table and `user_property_views` table will be added in Phase 3. See Phase 3 document for full schemas.

---

### Search Infrastructure

#### `search_suggestions` (Materialized View)

Populated from properties and geographic aggregations. Refreshed by the Replication Worker (Phase 1) after each Property replication cycle completes.

```
search_suggestions
├── id                 SERIAL PRIMARY KEY
├── label              VARCHAR NOT NULL        -- display text (e.g., "1506 Timber St, Georgetown, TX 78626")
├── type               VARCHAR NOT NULL        -- 'address', 'zip', 'city', 'subdivision'
├── search_value       VARCHAR                 -- value to use when executing the search
├── latitude           NUMERIC                 -- for centering map on selection
├── longitude          NUMERIC
├── listing_count      INTEGER                 -- number of active listings (for zip/city/subdivision)
├── priority           INTEGER DEFAULT 0       -- for ranking within type
```

**Indexes:** GIN index using `gin_trgm_ops` on `label` for fast fuzzy prefix matching

**Data Sources:**
- **Addresses:** Concatenate StreetNumber + StreetName + StreetSuffix + City + StateOrProvince + PostalCode from active properties
- **Subdivisions:** Distinct `subdivision_name` values from active properties
- **Zip Codes:** Distinct `postal_code` values with listing counts
- **Cities:** Distinct `city` values with listing counts

**Query Pattern:** Use trigram similarity (`similarity()` or `word_similarity()`) with a threshold > 0.3, ordered by similarity score. Avoid `ILIKE` with leading wildcards which defeat the `pg_trgm` GIN index for short inputs. Fall back to full `ILIKE` only if prefix/similarity search returns too few results. Results returned grouped by type with category headers.

---

## Search Architecture

### Map Boundary Search

**Query Pattern:**
```sql
SELECT * FROM properties
WHERE mlg_can_view = true
  AND 'IDX' = ANY(mlg_can_use)
  AND ST_Within(geog, ST_MakeEnvelope(sw_lng, sw_lat, ne_lng, ne_lat, 4326))
  AND standard_status IN ('Active', 'Coming Soon')
  -- plus additional filters: price, beds, baths, etc.
ORDER BY list_price
LIMIT 500;
```

**Frontend Considerations:**
- Debounce map pan/zoom events by 200–300ms before querying
- At low zoom levels, return clustered points (PostGIS `ST_SnapToGrid` or client-side Supercluster)
- At high zoom levels, return individual pins
- Return a lightweight payload for map pins (listing_key, lat, lng, price, beds, baths, sqft, thumbnail R2 URL); load full details on click

### Typeahead Search

Use trigram similarity functions (`similarity()` or `word_similarity()`) with a threshold > 0.3, ordered by similarity score. Avoid `ILIKE` with leading wildcards which defeat the `pg_trgm` GIN index for short inputs. Fall back to full `ILIKE` only if prefix/similarity search returns too few results.

Results returned to frontend grouped by type with category headers.

**Refresh Strategy:** The `search_suggestions` materialized view is refreshed by the Replication Worker (Phase 1) after each Property replication cycle completes. This ensures new listings appear in typeahead within minutes.

---

## URL Structure

```
/listing/{listing-id-stripped}/{slugified-address}
Example: /listing/1475089/1506-timber-st-georgetown-tx-78626
```

The `listing_id_display` (prefix stripped per MLS Grid guidance) is the permanent identifier. The address slug is for SEO and human readability. If the slug doesn't match (e.g., address changed), redirect to the canonical URL.

---

## MLS Grid Compliance Notes (Display Layer)

The API server is responsible for enforcing all consumer-facing compliance rules:

- **MlgCanView:** Never serve properties where `mlg_can_view = false` in any consumer-facing response. The Replication Worker handles soft-deletion; the API enforces the filter on every query.
- **MlgCanUse:** Filter all IDX-facing queries with `WHERE 'IDX' = ANY(mlg_can_use)`. Records with only 'VOW' or 'BO' must not appear on a public IDX site.
- **MediaURL:** Never expose MLS Grid's MediaURLs to end users. Serve all media from R2 via signed URLs or proxy endpoint.
- **Key Prefixes:** Strip MLS prefixes (e.g., "ACT") from all key fields before displaying to users. Use `listing_id_display` for user-facing display. Retain prefixed versions internally for database lookups.
- **Date Handling:** All RESO date fields are stored in UTC. Convert to user's local timezone for display.
- **Local Fields:** Prefixed with MLS code + underscore (e.g., `ACT_EstimatedTaxes`). Stored in `local_fields` JSONB. Do not rely on these being present — they vary by MLS source.

---

## ORM / Query Layer

**Recommendation:** Drizzle ORM over Prisma.

**Reasoning:** This project requires extensive PostGIS spatial queries, JSONB operations, array column filtering, and complex search query composition. Drizzle provides much better control over raw SQL while still offering type safety. Prisma's abstraction layer becomes an obstacle for these use cases.
