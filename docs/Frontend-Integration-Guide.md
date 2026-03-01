# MLS API v2 — Frontend Integration Guide

Complete reference for integrating the new API into the Astro + React frontend. Covers search, listing detail, typeahead, and neighborhoods.

**Base URL**: Configured via environment variable (e.g., `http://localhost:3000` dev, `https://api.movingtoaustin.com` prod)

**Authentication**: All requests require `x-api-key` header (except `/health`).

---

## Table of Contents

1. [Authentication](#authentication)
2. [Search Listings](#search-listings)
3. [Property Detail](#property-detail)
4. [Batch Property Details](#batch-property-details)
5. [Similar Homes](#similar-homes)
6. [Typeahead / Suggestions](#typeahead--suggestions)
7. [Neighborhoods](#neighborhoods)
8. [Stats](#stats)
9. [Key Differences from Legacy API](#key-differences-from-legacy-api)
10. [Frontend Integration Patterns](#frontend-integration-patterns)

---

## Authentication

Every API request (except `/health`) must include the `x-api-key` header. The API uses a **single static API key** — there are no per-user keys, token expiration, or permission scoping.

### Auth Model

| Property | Value |
|----------|-------|
| **Header** | `x-api-key` |
| **Key type** | Single shared static secret |
| **Expiration** | None — key is valid until rotated server-side |
| **Exempt routes** | `GET /health` (no key required) |
| **Rate limiting** | Not currently enforced |

### Basic Usage

```typescript
// In your Astro server-side code
const API_URL = import.meta.env.MLS_API_URL;
const API_KEY = import.meta.env.MLS_API_KEY;

async function fetchAPI(path: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}
```

### Error Response

If the API key is missing or invalid, the server returns a `401` with this body:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key. Provide a valid x-api-key header."
  }
}
```

Handle this in your fetch helper:

```typescript
async function fetchAPI(path: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'x-api-key': API_KEY },
  });

  if (response.status === 401) {
    throw new Error('API key is invalid or missing — check MLS_API_KEY env var');
  }

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}
```

### CORS

The API supports configurable CORS origins via the `CORS_ORIGIN` server environment variable:

| `CORS_ORIGIN` value | Behavior |
|---------------------|----------|
| `*` (default) | All origins allowed |
| `https://movingtoaustin.com,https://www.movingtoaustin.com` | Only listed origins allowed |

Allowed methods: `GET`, `POST`, `OPTIONS`.

### Security Notes

- **API calls should happen server-side** (Astro SSR) to keep the API key secret. Never expose the API key in client-side JavaScript.
- The `CORS_ORIGIN` setting provides an additional layer of protection but is not a substitute for keeping the key server-side.

---

## Search Listings

### Endpoint
```
GET /api/listings/search
```

### Query Parameters

#### Pagination & Sorting

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | `1` | Page number (1-indexed) |
| `items_per_page` | int or `"all"` | `20` | Results per page (1-10000) |
| `sort_by` | enum | `list_date` | `list_date`, `list_price`, `living_area`, `price_per_sqft`, `status`, `bedrooms_total`, `bathrooms_total` |
| `sort_direction` | enum | `desc` | `asc` or `desc` |

#### Geographic Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `min_latitude` | number | Bounding box south (all 4 required together) |
| `max_latitude` | number | Bounding box north |
| `min_longitude` | number | Bounding box west |
| `max_longitude` | number | Bounding box east |
| `polygon` | string | Stringified GeoJSON for custom shape search |
| `neighborhood` | string | Comma-separated neighborhood slugs (e.g., `downtown`, `downtown,east-cesar-chavez`) |
| `city` | string | Comma-separated city names, case-insensitive (e.g., `Austin`, `Austin,Round Rock`) |
| `zip_code` | string | Comma-separated ZIP codes (e.g., `78704`, `78704,78745,78748`) |

#### Property Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `property_type` | string | Comma-separated: `Residential`, `Residential Lease`, `Land`, `Farm`, `Commercial Sale`, `Commercial Lease`, `Residential Income` |
| `property_sub_type` | string | Comma-separated: `Single Family Residence`, `Condominium`, `Townhouse`, etc. |
| `min_price` / `max_price` | int | Price range |
| `min_bedrooms` / `max_bedrooms` | int | Bedroom count |
| `min_bathrooms` / `max_bathrooms` | number | Bathroom count (supports 0.5) |
| `min_sqft` / `max_sqft` | int | Living area sq ft |
| `min_lot_size` / `max_lot_size` | number | Lot size in acres |
| `min_year_built` / `max_year_built` | int | Year built |
| `min_price_per_sqft` / `max_price_per_sqft` | number | Price per sq ft |

#### Amenity Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `pool` | `"true"` | Has private pool |
| `garage` | `"true"` | Has garage |
| `min_garage_spaces` / `max_garage_spaces` | int | Garage spaces |
| `min_parking_spaces` / `max_parking_spaces` | int | Total parking |
| `waterfront` | `"true"` | Waterfront property |
| `fireplace` | `"true"` | Has fireplace |
| `new_construction` | `"true"` | New construction |

#### Status & Timing

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Comma-separated: `active`, `pending`, `active_under_contract`, `sold` |
| `days_on_market` | int | Max days on market |
| `price_reduction` | enum | `any`, `last_day`, `last_3_days`, `last_7_days`, `last_14_days`, `last_30_days`, `over_1_month`, `over_2_months`, `over_3_months` |
| `open_house` | enum | `this_weekend`, `next_weekend`, `all` |

#### History-Derived Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `back_on_market` | `"true"` | Listings that went Pending/Active Under Contract → Active (deal fell through) |
| `multiple_price_reductions` | `"true"` | Listings with more than one price reduction (motivated sellers) |

#### Text Search

| Parameter | Type | Description |
|-----------|------|-------------|
| `keywords` | string | Searches address, city, subdivision, remarks, ZIP |

#### Map Pins (Split-Response Mode)

| Parameter | Type | Description |
|-----------|------|-------------|
| `include_map_pins` | `"true"` | Returns a lightweight `map_pins` array with ALL matching listings (up to 5,000) alongside the normal paginated `data`. Use on initial load and bounds changes; omit for pagination (page 2+). Not available when `open_house` filter is active. |

### Response Format (Standard)

```json
{
  "data": [
    {
      "listing_id": "7522990",
      "standard_status": "Active",
      "list_price": 400000,
      "price_per_sqft": 219.06,
      "price_reduced": false,
      "price_reduction_amount": null,
      "bedrooms_total": 4,
      "bathrooms_total": 4,
      "living_area": 1826,
      "year_built": 1977,
      "lot_size_acres": 0.1457,
      "days_on_market": 21,
      "pool_private": false,
      "garage_spaces": 0,
      "new_construction": false,
      "waterfront": false,
      "property_type": "Residential",
      "property_sub_type": "Single Family Residence",
      "street_name": "Baldridge",
      "city": "Austin",
      "state_or_province": "TX",
      "postal_code": "78748",
      "county_or_parish": "Travis",
      "unparsed_address": "424 Baldridge Dr",
      "subdivision_name": "Beaconridge 03",
      "list_office_name": "JBGoodwin REALTORS NW",
      "major_change_type": "New Listing",
      "_geo": {
        "lat": 30.1787,
        "lng": -97.7929
      },
      "photo_count": 27,
      "photo_urls": [
        { "order": 0, "url": "https://mls-media.movingtoaustin.com/Property/ACT218251278/ACT218350136.jpg" },
        { "order": 1, "url": "https://mls-media.movingtoaustin.com/Property/ACT218251278/ACT218350137.jpg" },
        { "order": 2, "url": "https://mls-media.movingtoaustin.com/Property/ACT218251278/ACT218350138.jpg" }
      ],
      "next_open_house": null
    }
  ],
  "metadata": {
    "total_listings_count": 33882,
    "filtered_listings_count": 623,
    "current_page": 1,
    "total_pages": 312,
    "items_per_page": 2,
    "sort_by": "list_price",
    "sort_direction": "asc",
    "bounds": {
      "sw": { "lat": 30.1787, "lng": -97.7929 },
      "ne": { "lat": 30.3574, "lng": -97.6505 }
    }
  }
}
```

### Response Format (with `include_map_pins=true`)

When `include_map_pins=true` is passed, the response includes an additional `map_pins` array containing lightweight pin data for ALL matching listings (up to 5,000). This enables the frontend to render complete map coverage while paginating the card list independently.

```json
{
  "map_pins": [
    {
      "id": "7522990",
      "lat": 30.1787,
      "lng": -97.7929,
      "price": 400000,
      "status": "Active",
      "beds": 4,
      "baths": 4,
      "property_type": "Residential"
    }
  ],
  "data": [
    { "listing_id": "7522990", "list_price": 400000, "photo_urls": [...], ... }
  ],
  "metadata": {
    "total_listings_count": 33882,
    "filtered_listings_count": 2847,
    "current_page": 1,
    "total_pages": 95,
    "items_per_page": 30,
    "sort_by": "list_date",
    "sort_direction": "desc",
    "bounds": {
      "sw": { "lat": 30.13, "lng": -98.09 },
      "ne": { "lat": 30.53, "lng": -97.46 }
    },
    "map_pins_count": 2847,
    "map_pins_truncated": false
  }
}
```

#### Map Pin Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | The `listing_id` (display ID) — use to correlate with card data and for detail navigation |
| `lat` | number | Latitude |
| `lng` | number | Longitude |
| `price` | number | List price |
| `status` | string | Standard status (e.g., "Active") |
| `beds` | number \| null | Bedroom count |
| `baths` | number \| null | Bathroom count |
| `property_type` | string | Property type for pin icon differentiation |

#### Map Pins Metadata

| Field | Type | Notes |
|-------|------|-------|
| `map_pins_count` | number | Number of pins returned |
| `map_pins_truncated` | boolean | `true` if results exceeded 5,000 limit — frontend should show "Zoom in to see all results" |

> **Note**: When `include_map_pins=true`, the `bounds` in metadata are computed from ALL map pins (the full filtered dataset), not just the paginated page. This gives accurate bounds for `map.fitBounds()`.

> **Note**: Map pins are not available when the `open_house` filter is active (those searches require a JOIN and typically return small result sets where the standard `data` array suffices).

### Key Response Fields

| Field | Type | Notes |
|-------|------|-------|
| `list_price` | number | Always a number, not a string |
| `price_per_sqft` | number \| null | Calculated server-side |
| `price_reduced` | boolean | `true` if current < original price |
| `price_reduction_amount` | number \| null | Dollar amount of reduction |
| `price_reduction_count` | number | Number of times price was reduced |
| `back_on_market` | boolean | `true` if listing went Pending/AUC → Active |
| `bathrooms_total` | number | Pre-calculated (full + half, e.g., 2.5) |
| `days_on_market` | number \| null | Calculated from `original_entry_ts` |
| `_geo` | object \| null | `{ lat, lng }` for mapping libraries |
| `photo_urls` | array | First 3 photos with `{ order, url }` |
| `next_open_house` | object \| null | `{ date, start_time, end_time }` |
| `bounds` | object \| null | Bounding box of results for map centering |

### Example Requests

```bash
# Active homes in Austin, 3+ beds, $400k-$600k, sorted by price
GET /api/listings/search?city=Austin&status=active&min_bedrooms=3&min_price=400000&max_price=600000&sort_by=list_price&sort_direction=asc

# Neighborhood search (shows only listings inside polygon)
GET /api/listings/search?neighborhood=downtown&status=active

# Multi-neighborhood search (union of polygons)
GET /api/listings/search?neighborhood=downtown,east-cesar-chavez,zilker&status=active

# Multi-ZIP code search (badge-style multi-select)
GET /api/listings/search?zip_code=78704,78745,78748&status=active

# Multi-city search
GET /api/listings/search?city=Austin,Round Rock,Cedar Park&status=active

# Map bounding box search
GET /api/listings/search?min_latitude=30.25&max_latitude=30.30&min_longitude=-97.78&max_longitude=-97.72&status=active

# Custom polygon search (user draws on map)
GET /api/listings/search?polygon={"type":"Polygon","coordinates":[[[-97.75,30.26],[-97.74,30.26],[-97.74,30.27],[-97.75,30.27],[-97.75,30.26]]]}&status=active

# Map search with split response (initial load / bounds change)
GET /api/listings/search?min_latitude=30.25&max_latitude=30.35&min_longitude=-97.80&max_longitude=-97.70&status=active&items_per_page=30&include_map_pins=true

# Pagination (page 2+) — no map_pins needed, pins already loaded
GET /api/listings/search?min_latitude=30.25&max_latitude=30.35&min_longitude=-97.80&max_longitude=-97.70&status=active&items_per_page=30&page=2
```

> **Multi-value logic**: Comma-separated values within the same parameter use **OR** logic (e.g., `zip_code=78704,78745` returns listings in either ZIP). Different parameters are combined with **AND** logic (e.g., `city=Austin&min_bedrooms=3` returns Austin listings with 3+ beds).

---

## Property Detail

### Endpoint
```
GET /api/listings
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | Conditional* | MLS display ID (e.g., `7522990`) |
| `address` | string | Conditional* | Address with hyphens (e.g., `508-echo-pass`) |
| `city` | string | Conditional* | City with hyphens (e.g., `liberty-hill`) |

\* Must provide either `listing_id` OR both `address` and `city`.

### Response Format

Returns a comprehensive `listing` object with nested sections:

```json
{
  "listing": {
    "ids": { "listing_id", "mls" },
    "status": { "standard_status", "mls_status", "listing_date", "days_on_market", "last_modified", "back_on_market", "back_on_market_date" },
    "pricing": { "current_price", "original_price", "previous_price", "price_reduction", "price_reduction_percentage", "price_per_sqft", "last_price_change" },
    "property_details": { "type", "category", "condition", "year_built", "architectural_style" },
    "location": { "address", "street_number", "street_name", "street_suffix", "city", "state", "zip", "county", "country", "subdivision", "mls_area", "coordinates": { "latitude", "longitude" } },
    "size": { "living_area_sqft", "lot_size_acres", "lot_size_sqft", "stories" },
    "rooms": { "bedrooms", "bathrooms_full", "bathrooms_half", "bathrooms_total", "garage_spaces", "parking_total" },
    "room_list": [{ "type", "dimensions", "features" }],
    "features": { "interior", "exterior", "construction", "roof", "foundation", "flooring", "windows", "lot", "fencing", "parking", "security", "pool", "fireplace", "fireplaces_total", "view", "waterfront", "waterfront_features", "horse_property", "horse_amenities", "patio_porch", "community", "green_energy" },
    "systems": { "cooling", "heating", "appliances", "utilities", "water", "sewer" },
    "financial": { "hoa": { "required", "fee", "fee_frequency", "fee_monthly", "name", "includes", "fee2", "fee2_frequency" }, "taxes": { "year", "assessed_value", "annual_amount", "monthly_amount", "tax_rate", "legal_description", "parcel_number" } },
    "schools": { "elementary", "middle", "high" },
    "description": "...",
    "directions": "...",
    "disclosures": [],
    "listing_agent": { "name", "email", "phone", "mls_id", "key" },
    "listing_office": { "name", "phone", "mls_id", "key" },
    "media": { "photo_count", "photos_last_updated", "virtual_tour", "photos": [{ "order", "url", "content_type" }] },
    "syndication": { "display_online", "allow_avm", "syndicated_to" },
    "open_houses": [{ "date", "start_time", "end_time", "remarks" }],
    "price_history": {
      "summary": { "total_changes", "net_change_from_first", "net_change_percentage", "avg_days_between_changes" },
      "entries": [{ "old_price", "new_price", "change_amount", "change_percentage", "change_type", "days_at_previous_price", "timestamp" }]
    },
    "status_history": [{ "old_status", "new_status", "days_in_status", "timestamp" }],
    "calculated_metrics": { "price_per_sqft", "price_per_acre", "days_on_market" },
    "local_fields": { ... }
  }
}
```

### Example Requests

```bash
# By listing display ID
GET /api/listings?listing_id=7522990

# By address + city (SEO-friendly URLs)
GET /api/listings?address=508-echo-pass&city=liberty-hill
```

---

## Batch Property Details

### Endpoint
```
GET /api/listings/batch
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | string | Yes | Comma-separated listing IDs (display IDs, max 50) |

### Response Format

```json
{
  "listings": [ /* same structure as single detail */ ],
  "found": ["7522990", "7654321"],
  "not_found": ["9999999"]
}
```

---

## Similar Homes

### Endpoint
```
GET /api/listings/similar
```

Find properties similar to a given listing, ranked by a **weighted composite similarity score** that considers geographic proximity, price, size, bedrooms/bathrooms, year built, and bonus feature matches.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `listing_id` | string | *required* | MLS display ID (e.g., `7522990`) or listing key |
| `limit` | int | `12` | Number of similar homes to return (1–50) |
| `radius_miles` | number | `10` | Search radius in miles (1–100). Auto-widens if too few results. |
| `include_pending` | `"true"` | `false` | Include Pending listings alongside Active |
| `price_tolerance` | number | `0.5` | Price band tolerance (0.1–1.0). `0.5` = ±50% of subject price. |

### Similarity Scoring Algorithm

Each candidate property receives a composite score (0–1) based on weighted signals:

| Signal | Weight | Scoring |
|--------|--------|---------|
| **Geographic proximity** | 30% | 1.0 at 0 miles → 0.0 at radius edge |
| **Price similarity** | 25% | 1.0 at 0% diff → 0.0 at tolerance% diff |
| **Size similarity** | 20% | 1.0 at 0% diff → 0.0 at 50% diff |
| **Bedroom/bath match** | 15% | 1.0 exact match, 0.5 within ±1, 0.0 otherwise |
| **Year built similarity** | 10% | 1.0 same year → 0.0 at 20+ years apart |

**Bonus modifiers** (additive):

| Bonus | Value | Condition |
|-------|-------|-----------|
| Same subdivision | +5% | Both in same subdivision |
| Matching pool | +2% | Both have pool, or both don't |
| Matching waterfront | +2% | Both waterfront, or both not |

### Auto-Widening

If fewer than 4 results are found within the initial radius, the search automatically widens:
- Radius expands by 2.5× (up to 50 miles max)
- Price tolerance relaxes by 1.5× (up to 100%)
- The `radius_widened` flag in metadata indicates when this occurred

### Response Format

```json
{
  "subject": {
    "listing_id": "7522990",
    "standard_status": "Active",
    "list_price": 450000,
    "bedrooms_total": 3,
    "bathrooms_total": 2,
    "living_area": 1800,
    "lot_size_acres": 0.15,
    "year_built": 2005,
    "property_type": "Residential",
    "property_sub_type": "Single Family Residence",
    "unparsed_address": "123 Main St",
    "city": "Austin",
    "state_or_province": "TX",
    "postal_code": "78704",
    "subdivision_name": "Travis Heights",
    "pool_private": false,
    "waterfront": false,
    "_geo": { "lat": 30.2401, "lng": -97.7654 }
  },
  "similar": [
    {
      "listing_id": "7654321",
      "similarity_score": 0.847,
      "distance_miles": 0.42,
      "score_breakdown": {
        "geographic": 0.287,
        "price": 0.231,
        "size": 0.185,
        "rooms": 0.15,
        "age": 0.09,
        "subdivision_bonus": 0.05,
        "pool_bonus": 0.02,
        "waterfront_bonus": 0.02
      },
      "standard_status": "Active",
      "list_price": 465000,
      "price_per_sqft": 251.35,
      "price_reduced": false,
      "bedrooms_total": 3,
      "bathrooms_total": 2,
      "living_area": 1850,
      "lot_size_acres": 0.18,
      "year_built": 2008,
      "stories": 2,
      "garage_spaces": 2,
      "pool_private": false,
      "waterfront": false,
      "new_construction": false,
      "property_type": "Residential",
      "property_sub_type": "Single Family Residence",
      "unparsed_address": "456 Oak Ave",
      "city": "Austin",
      "state_or_province": "TX",
      "postal_code": "78704",
      "subdivision_name": "Travis Heights",
      "days_on_market": 14,
      "_geo": { "lat": 30.2415, "lng": -97.7638 },
      "photo_count": 22,
      "photo_urls": [
        { "order": 0, "url": "https://mls-media.movingtoaustin.com/..." },
        { "order": 1, "url": "https://mls-media.movingtoaustin.com/..." },
        { "order": 2, "url": "https://mls-media.movingtoaustin.com/..." }
      ]
    }
  ],
  "metadata": {
    "total_candidates": 12,
    "returned": 12,
    "radius_miles": 10,
    "radius_widened": false,
    "price_tolerance": 0.5,
    "weights": { "geo": 0.3, "price": 0.25, "size": 0.2, "rooms": 0.15, "age": 0.1 },
    "bonuses": { "same_subdivision": 0.05, "matching_pool": 0.02, "matching_waterfront": 0.02 }
  }
}
```

### Key Response Fields

| Field | Type | Notes |
|-------|------|-------|
| `subject` | object | Summary of the input listing for context |
| `similar[].similarity_score` | number | Composite score (0–1, higher = more similar) |
| `similar[].distance_miles` | number | Distance from subject in miles |
| `similar[].score_breakdown` | object | Individual component scores for transparency |
| `metadata.radius_widened` | boolean | `true` if search auto-expanded beyond initial radius |

### Example Requests

```bash
# Basic: find 12 similar homes
GET /api/listings/similar?listing_id=7522990

# Custom limit and radius
GET /api/listings/similar?listing_id=7522990&limit=6&radius_miles=5

# Include pending listings, tighter price band
GET /api/listings/similar?listing_id=7522990&include_pending=true&price_tolerance=0.3

# Wider search for rural properties
GET /api/listings/similar?listing_id=7522990&radius_miles=25&limit=20
```

### Error Responses

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Missing `listing_id` or invalid parameters |
| 404 | `NOT_FOUND` | Listing ID doesn't exist |
| 422 | `NO_COORDINATES` | Subject listing has no lat/lng (can't compute spatial similarity) |

### Frontend Integration

```typescript
// On listing detail page, fetch similar homes
const similar = await fetchAPI(`/api/listings/similar?listing_id=${listingId}&limit=8`);

// Render carousel/grid of similar homes
similar.similar.map(home => (
  <SimilarHomeCard
    key={home.listing_id}
    price={home.list_price}
    beds={home.bedrooms_total}
    baths={home.bathrooms_total}
    sqft={home.living_area}
    address={home.unparsed_address}
    city={home.city}
    photo={home.photo_urls[0]?.url}
    distance={home.distance_miles}
    score={home.similarity_score}
  />
));
```

---

## Typeahead / Suggestions

### Endpoint
```
GET /api/suggest
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (min 1 character) |
| `limit` | int | No | Max results (default: 10, max: 20) |
| `types` | string | No | Comma-separated type filter: `city`, `zip`, `subdivision`, `neighborhood`, `address` |

### Response Format

```json
{
  "suggestions": [
    {
      "label": "Downtown",
      "type": "neighborhood",
      "search_value": "downtown",
      "listing_count": 368,
      "location": { "lat": 30.2707, "lng": -97.7431 }
    },
    {
      "label": "78704 - Austin, TX",
      "type": "zip",
      "search_value": "78704",
      "listing_count": 245,
      "location": { "lat": 30.2401, "lng": -97.7654 }
    }
  ],
  "grouped": {
    "neighborhood": [ ... ],
    "zip": [ ... ],
    "subdivision": [ ... ]
  },
  "query": "down"
}
```

### Suggestion Types

| Type | `search_value` | How to use |
|------|---------------|------------|
| `city` | City name | `?city={search_value}` |
| `zip` | ZIP code | `?zip_code={search_value}` |
| `subdivision` | Subdivision name | `?keywords={search_value}` |
| `neighborhood` | Neighborhood slug | `?neighborhood={search_value}` + fetch polygon |
| `address` | Listing display ID | Navigate to `/listing/{search_value}` |

### Frontend Integration

```typescript
// Debounce 300ms, min 2 characters
const suggestions = await fetchAPI(`/api/suggest?q=${encodeURIComponent(query)}`);

// When user clicks a suggestion:
switch (suggestion.type) {
  case 'neighborhood':
    // 1. Search listings inside the neighborhood
    const results = await fetchAPI(`/api/listings/search?neighborhood=${suggestion.search_value}&status=active`);
    // 2. Fetch polygon for map overlay
    const hood = await fetchAPI(`/api/neighborhoods/${suggestion.search_value}`);
    // 3. Draw polygon on map, show pins, zoom to bounds
    break;
  case 'city':
    const results = await fetchAPI(`/api/listings/search?city=${suggestion.search_value}&status=active`);
    break;
  case 'zip':
    const results = await fetchAPI(`/api/listings/search?zip_code=${suggestion.search_value}&status=active`);
    break;
  case 'address':
    // Navigate directly to listing detail page
    window.location.href = `/listing/${suggestion.search_value}`;
    break;
  case 'subdivision':
    const results = await fetchAPI(`/api/listings/search?keywords=${encodeURIComponent(suggestion.label)}&status=active`);
    break;
}
```

---

## Neighborhoods

### List All Neighborhoods
```
GET /api/neighborhoods
```

Returns all 169 neighborhoods with names, centers, and listing counts (no polygon geometry).

```json
{
  "neighborhoods": [
    {
      "id": 1,
      "name": "Downtown",
      "slug": "downtown",
      "source": "City of Austin",
      "sq_miles": 1.23,
      "center": { "lat": 30.2707, "lng": -97.7431 },
      "listing_count": 368
    }
  ],
  "total": 169
}
```

### Get Neighborhood with Polygon
```
GET /api/neighborhoods/:slug
```

Returns full GeoJSON polygon geometry for map overlay.

```json
{
  "neighborhood": {
    "id": 1,
    "name": "Downtown",
    "slug": "downtown",
    "center": { "lat": 30.2707, "lng": -97.7431 },
    "listing_count": 368,
    "geometry": {
      "type": "MultiPolygon",
      "coordinates": [ ... ]
    }
  }
}
```

---

## Stats

### Endpoint
```
GET /api/stats
```

### Response
```json
{
  "homes_for_sale": 13068,
  "homes_for_rent": 5915,
  "new_listings_30_days": 7370,
  "timestamp": "2026-02-27T00:13:21.559Z"
}
```

---

## Key Differences from Legacy API

### Authentication
| | Legacy | v2 |
|---|--------|-----|
| Auth | None | `x-api-key` header required |

### Search Endpoint

| Feature | Legacy (`/api/listings/search`) | v2 (`/api/listings/search`) |
|---------|------|-----|
| **Numeric fields** | Returned as strings (`"400000"`) | Returned as numbers (`400000`) |
| **Coordinates** | Separate `latitude`/`longitude` fields | `_geo: { lat, lng }` object |
| **Photos** | Single `primary_photo_url` | `photo_urls` array (first 3 with order) |
| **Open houses** | `open_houses` array (all) | `next_open_house` object (next upcoming only) |
| **Bounds** | Not included | `metadata.bounds` with `sw`/`ne` for map |
| **Neighborhood search** | Not supported | `?neighborhood=slug` with polygon matching |
| **Custom polygon** | Not supported | `?polygon={geojson}` |
| **Text search** | Via Meilisearch | Via PostgreSQL ILIKE (no Meilisearch dependency) |
| **Typeahead** | Meilisearch-based | pg_trgm fuzzy matching |
| **Price reduction** | Separate fields | `price_reduced` boolean + `price_reduction_amount` |
| **Days on market** | Returned from DB | Calculated server-side from `original_entry_ts` |

### Suggest Endpoint

| Feature | Legacy (`/suggest`) | v2 (`/api/suggest`) |
|---------|------|-----|
| **Path** | `/suggest` | `/api/suggest` |
| **Engine** | Meilisearch | PostgreSQL pg_trgm |
| **Results** | Flat list | Flat `suggestions` + `grouped` by type |
| **Types** | address, zip, city | address, zip, city, subdivision, **neighborhood** |
| **Neighborhood support** | No | Yes — returns slug for polygon search |
| **Type filtering** | No | `?types=city,neighborhood` |

### Detail Endpoint

| Feature | Legacy (`/api/listings`) | v2 (`/api/listings`) |
|---------|------|-----|
| **Address lookup** | Exact match | Flexible whitespace matching |
| **Price history** | Not included | Included in response |
| **Room list** | Not included | Included from `rooms` table |
| **Local fields** | Not included | Included as `local_fields` object |

### New Endpoints (not in legacy)

| Endpoint | Description |
|----------|-------------|
| `GET /api/neighborhoods` | List all 169 neighborhoods with centers and listing counts |
| `GET /api/neighborhoods/:slug` | Get neighborhood polygon for map overlay |

### Removed Endpoints

| Legacy Endpoint | Status |
|----------------|--------|
| `GET /listings/search` | Removed (was Meilisearch-based legacy) |
| `GET /status` | Removed (operational, not needed for frontend) |
| `GET /status/dashboard` | Removed |
| `GET /status/media-delay` | Removed |
| `POST /status/media-delay` | Removed |
| `GET /api-docs` | Removed (Swagger) |

---

## Frontend Integration Patterns

### Map Search Flow (Split-Response)

```
1. User lands on /for-sale/search
2. SSR: GET /api/listings/search?...&items_per_page=30&include_map_pins=true
3. Hydrate React with SSR data
4. Map renders ALL pins from map_pins array (use clustering for dense areas)
5. Card list renders 30 items from data array

On scroll (infinite scroll / load more):
6. GET /api/listings/search?...&items_per_page=30&page=2  (NO include_map_pins)
7. Append 30 cards to list, don't touch map pins

On map pan/zoom:
8. Debounce 800ms
9. GET /api/listings/search?...new bounds...&items_per_page=30&include_map_pins=true
10. Replace ALL map pins with new map_pins array
11. Replace card list with new page 1 data

If metadata.map_pins_truncated === true:
12. Show "Zoom in to see all results" indicator on map
```

### Map Search Flow (Legacy — without map pins)

```
1. User pans/zooms map
2. Frontend debounces 200-300ms
3. GET /api/listings/search?min_latitude=...&max_latitude=...&min_longitude=...&max_longitude=...&status=active
4. Render pins from _geo coordinates
5. Use metadata.bounds to verify map viewport
```

### Neighborhood Search Flow

```
1. User types "downtown" in search bar
2. GET /api/suggest?q=downtown → shows categorized results
3. User clicks "Downtown" (type: neighborhood)
4. GET /api/listings/search?neighborhood=downtown&status=active → listings inside polygon
5. GET /api/neighborhoods/downtown → polygon geometry for map overlay
6. Draw polygon boundary on map, show pins, zoom to metadata.bounds
7. User clicks "Clear boundary" → remove neighborhood param, switch to bounding box search
```

### Map Pin Component

```typescript
interface MapPin {
  id: string;        // listing_id (display ID)
  lat: number;
  lng: number;
  price: number;
  status: string;
  beds: number | null;
  baths: number | null;
  property_type: string;
}

// Use map_pins for markers, data for cards
interface SearchResponse {
  map_pins?: MapPin[];           // Only present when include_map_pins=true
  data: ListingCard[];           // Paginated card data
  metadata: {
    filtered_listings_count: number;
    current_page: number;
    total_pages: number;
    items_per_page: number;
    bounds: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
    map_pins_count?: number;     // Only present when include_map_pins=true
    map_pins_truncated?: boolean; // Only present when include_map_pins=true
  };
}
```

### Listing Card Component

```typescript
interface ListingCard {
  listing_id: string;
  list_price: number;
  bedrooms_total: number;
  bathrooms_total: number;
  living_area: number | null;
  unparsed_address: string;
  city: string;
  state_or_province: string;
  photo_urls: { order: number; url: string }[];
  price_reduced: boolean;
  price_reduction_amount: number | null;
  price_reduction_count: number;
  back_on_market: boolean;
  next_open_house: { date: string; start_time: string; end_time: string } | null;
  _geo: { lat: number; lng: number } | null;
}
```

### SEO-Friendly Listing URLs

```
/listing/{listing_id}/{slugified-address}
Example: /listing/7522990/424-baldridge-dr-austin-tx-78748
```

Use `listing_id` for both API lookups and display URLs — it is the MLS-approved display ID.

---

**Last Updated**: February 2026
**API Version**: 2.0.0
