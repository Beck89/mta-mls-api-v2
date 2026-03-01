# MLS API v2 — Endpoint Reference

Complete reference for all API endpoints, query parameters, and response formats.

**Base URL**: `https://api.movingtoaustin.com` (Production) or `http://localhost:3000` (Development)

**Framework**: Fastify with gzip/brotli compression enabled globally.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Search Listings](#2-search-listings)
3. [Property Detail](#3-property-detail)
4. [Batch Property Details](#4-batch-property-details)
5. [Resolve Listing Keys](#5-resolve-listing-keys)
6. [Typeahead / Suggestions](#6-typeahead--suggestions)
7. [Geographic Areas](#7-geographic-areas)
8. [Public Listing Statistics](#8-public-listing-statistics)
9. [Health Check](#9-health-check)
10. [Background Scheduler](#10-background-scheduler)

---

## 1. Authentication

All routes except `/health` require a valid API key via the `x-api-key` header.

**Source**: [`server.ts`](../src/server.ts) (onRequest hook)

### Auth Model

| Property | Value |
|----------|-------|
| **Header** | `x-api-key` |
| **Key type** | Single shared static secret |
| **Expiration** | None — key is valid until rotated server-side |
| **Exempt routes** | `GET /health` (no key required) |
| **Rate limiting** | Not currently enforced |
| **Env variable** | `API_KEY` |

### Error Response (401)

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key. Provide a valid x-api-key header."
  }
}
```

### Example

```bash
curl -H "x-api-key: YOUR_API_KEY" https://api.movingtoaustin.com/api/listings/search?status=active
```

### Security Notes

- API calls should happen **server-side** (Astro SSR) to keep the API key secret. Never expose the key in client-side JavaScript.
- `CORS_ORIGIN` provides an additional layer of protection but is not a substitute for keeping the key server-side.

---

## 2. Search Listings

Comprehensive property search with advanced filtering, sorting, pagination, bounding box, GeoJSON polygon, and named area (neighborhood/city/ZIP/county/school district) support.

Supports **split-response mode**: when `include_map_pins=true`, returns a lightweight `map_pins` array (all matching listings, up to 5,000) alongside the normal paginated `data` array.

### Endpoint

```
GET /api/listings/search
```

**Source**: [`search.ts`](../src/routes/search.ts)

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
| `polygon` | string | Stringified GeoJSON for custom shape search (user draws on map) |
| `neighborhood` | string | Comma-separated neighborhood slugs (e.g., `downtown,east-cesar-chavez`) |
| `city` | string | Comma-separated city slugs or names (e.g., `austin,round-rock`) |
| `zip_code` | string | Comma-separated ZIP codes (e.g., `78704,78745,78748`) |
| `county` | string | Comma-separated county slugs (e.g., `travis-county,williamson-county`) |
| `school_district` | string | Comma-separated school district slugs |

> **Area filter logic**: All area parameters use **OR (union)** logic — both within a single parameter and across different area types. A listing matches if it falls within **any** selected area. Polygon-backed areas use `ST_Within()` spatial matching; areas without polygons fall back to text matching.

#### Property Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `property_type` | string | Comma-separated: `Residential`, `Residential Lease`, `Land`, `Farm`, `Commercial Sale`, `Commercial Lease`, `Residential Income` |
| `property_sub_type` | string | Comma-separated (or `"all"` to skip): `Single Family Residence`, `Condominium`, `Townhouse`, etc. |
| `min_price` / `max_price` | int | Price range |
| `min_bedrooms` / `max_bedrooms` | int | Bedroom count |
| `min_bathrooms` / `max_bathrooms` | number | Bathroom count (supports 0.5 increments) |
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
| `days_on_market` | int | Maximum days on market |
| `price_reduction` | enum | `any`, `last_day`, `last_3_days`, `last_7_days`, `last_14_days`, `last_30_days`, `over_1_month`, `over_2_months`, `over_3_months` |
| `open_house` | enum | `this_weekend`, `next_weekend`, `all` |

#### Text Search

| Parameter | Type | Description |
|-----------|------|-------------|
| `keywords` | string | ILIKE search across address, city, subdivision, remarks, ZIP |

#### Map Pins (Split-Response Mode)

| Parameter | Type | Description |
|-----------|------|-------------|
| `include_map_pins` | `"true"` | Returns a lightweight `map_pins` array with ALL matching listings (up to 5,000) alongside the normal paginated `data`. Not available when `open_house` filter is active. |

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
      "_geo": { "lat": 30.1787, "lng": -97.7929 },
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
  "data": [ ... ],
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

### Key Response Fields

| Field | Type | Notes |
|-------|------|-------|
| `listing_id` | string | MLS-approved display ID (not internal key) |
| `list_price` | number | Always a number, not a string |
| `price_per_sqft` | number \| null | Calculated server-side |
| `price_reduced` | boolean | `true` if current < original price |
| `price_reduction_amount` | number \| null | Dollar amount of reduction |
| `bathrooms_total` | number | Pre-calculated (full + half) |
| `days_on_market` | number \| null | Calculated from `original_entry_ts` |
| `_geo` | object \| null | `{ lat, lng }` for mapping libraries |
| `photo_urls` | array | First 3 photos with `{ order, url }` |
| `next_open_house` | object \| null | `{ date, start_time, end_time }` — next upcoming only |
| `bounds` | object \| null | Bounding box of results for map centering |

### Map Pin Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Display ID — use to correlate with card data |
| `lat` / `lng` | number | Coordinates |
| `price` | number | List price |
| `status` | string | Standard status |
| `beds` / `baths` | number \| null | Bedroom/bathroom count |
| `property_type` | string | For pin icon differentiation |

### Performance Headers

The response includes a `Server-Timing` header for diagnostics:

```
Server-Timing: db;dur=45, format;dur=3, total;dur=48
```

### Example Requests

```bash
# Active homes in Austin, 3+ beds, sorted by price
GET /api/listings/search?city=austin&status=active&min_bedrooms=3&sort_by=list_price&sort_direction=asc

# Neighborhood search (polygon-backed spatial filter)
GET /api/listings/search?neighborhood=downtown&status=active

# Multi-neighborhood search (union of polygons)
GET /api/listings/search?neighborhood=downtown,east-cesar-chavez,zilker&status=active

# Multi-ZIP code search
GET /api/listings/search?zip_code=78704,78745,78748&status=active

# County search
GET /api/listings/search?county=travis-county&status=active

# School district search
GET /api/listings/search?school_district=austin-isd&status=active

# Mixed area types (OR logic across all)
GET /api/listings/search?city=austin&county=williamson-county&zip_code=78641

# Map bounding box search
GET /api/listings/search?min_latitude=30.25&max_latitude=30.30&min_longitude=-97.78&max_longitude=-97.72&status=active

# Custom polygon search (user draws on map)
GET /api/listings/search?polygon={"type":"Polygon","coordinates":[[[-97.75,30.26],[-97.74,30.26],[-97.74,30.27],[-97.75,30.27],[-97.75,30.26]]]}&status=active

# Map search with split response (initial load / bounds change)
GET /api/listings/search?city=austin&status=active&items_per_page=30&include_map_pins=true

# Pagination (page 2+) — no map_pins needed, pins already loaded
GET /api/listings/search?city=austin&status=active&items_per_page=30&page=2

# Keyword search
GET /api/listings/search?keywords=lake+travis&min_price=500000&property_type=Residential

# Price reduced in last 7 days with pool
GET /api/listings/search?property_type=Residential&pool=true&price_reduction=last_7_days

# Open house this weekend
GET /api/listings/search?status=active&open_house=this_weekend
```

### Error Responses

**400 Validation Error:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid search parameters",
    "details": { "min_price": ["Expected number, received nan"] }
  }
}
```

**400 Invalid Polygon:**

```json
{
  "error": {
    "code": "INVALID_POLYGON",
    "message": "Invalid GeoJSON polygon"
  }
}
```

**500 Search Error:**

```json
{
  "error": {
    "code": "SEARCH_ERROR",
    "message": "An error occurred while searching listings"
  }
}
```

---

## 3. Property Detail

Retrieve complete property details in a clean, organized JSON structure with calculated metrics. Supports lookup by `listing_id` (display ID), `listing_key` (internal), or `address` + `city` combination.

### Endpoint

```
GET /api/listings
```

**Source**: [`detail.ts`](../src/routes/detail.ts)

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | Conditional* | MLS display ID (e.g., `7522990`) — preferred |
| `listing_key` | string | Conditional* | Internal listing key — backward compatibility |
| `address` | string | Conditional* | Address with hyphens (e.g., `508-echo-pass`) |
| `city` | string | Conditional* | City with hyphens (e.g., `liberty-hill`) |

\* Must provide `listing_id`, `listing_key`, or both `address` and `city`.

> **ID Resolution**: `listing_id` resolves `listing_id_display` first, then falls back to trying the value as a `listing_key` directly for backward compatibility.

### Response Format

```json
{
  "listing": {
    "ids": {
      "listing_key": "ACT209777414",
      "listing_id": "ACT9743847",
      "listing_id_display": "9743847",
      "mls": "actris"
    },
    "status": {
      "standard_status": "Active",
      "mls_status": "Active",
      "listing_date": "2025-10-27",
      "days_on_market": 14,
      "last_modified": "2025-01-15T10:30:00Z"
    },
    "pricing": {
      "current_price": 530000,
      "original_price": 559990,
      "previous_price": 545000,
      "price_reduction": 29990,
      "price_reduction_percentage": 5.36,
      "price_per_sqft": 205.83,
      "last_price_change": "2025-01-10T10:00:00Z"
    },
    "property_details": {
      "type": "Single Family Residence",
      "category": "Residential",
      "condition": "New Construction",
      "year_built": 2025,
      "architectural_style": "Contemporary"
    },
    "location": {
      "address": "508 Echo Pass",
      "street_number": "508",
      "street_name": "Echo",
      "street_suffix": "Pass",
      "city": "Liberty Hill",
      "state": "TX",
      "zip": "78642",
      "county": "Williamson",
      "country": "US",
      "subdivision": "Santa Rita Ranch",
      "mls_area": "LS",
      "coordinates": {
        "latitude": 30.65768844,
        "longitude": -97.82743594
      }
    },
    "size": {
      "living_area_sqft": 2575,
      "lot_size_acres": 0.1544,
      "lot_size_sqft": 6726,
      "stories": "Two"
    },
    "rooms": {
      "bedrooms": 4,
      "bathrooms_full": 3,
      "bathrooms_half": 0,
      "bathrooms_total": 3,
      "garage_spaces": 2,
      "parking_total": 2
    },
    "room_list": [
      { "type": "Bedroom", "dimensions": "12x14", "features": "Ceiling Fan" },
      { "type": "Kitchen", "dimensions": "15x20", "features": "Breakfast Bar" }
    ],
    "features": {
      "interior": ["Breakfast Bar", "Ceiling Fan(s)", "Open Floorplan"],
      "exterior": ["Covered Patio", "Rain Gutters"],
      "construction": ["Frame", "HardiPlank Type"],
      "roof": ["Composition"],
      "foundation": ["Slab"],
      "flooring": ["Carpet", "Tile", "Vinyl"],
      "windows": ["Double Pane Windows"],
      "lot": ["Corner Lot", "Sprinklers Automatic"],
      "fencing": ["Privacy", "Wood"],
      "parking": ["Attached", "Garage Door Opener"],
      "security": [],
      "accessibility": [],
      "pool": null,
      "fireplace": false,
      "fireplaces_total": 0,
      "view": ["Neighborhood"],
      "waterfront": false,
      "waterfront_features": [],
      "horse_property": false,
      "horse_amenities": [],
      "patio_porch": ["Covered Patio"],
      "community": ["Clubhouse", "Pool", "Trails"],
      "green_energy": []
    },
    "systems": {
      "cooling": ["Central Air"],
      "heating": ["Central", "Natural Gas"],
      "appliances": ["Dishwasher", "Disposal", "Microwave", "Range Hood"],
      "utilities": ["Electricity Connected", "Natural Gas Connected"],
      "water": ["Public"],
      "sewer": ["Public Sewer"]
    },
    "financial": {
      "hoa": {
        "required": true,
        "fee": 150,
        "fee_frequency": "Monthly",
        "fee_monthly": 150,
        "name": "Santa Rita Ranch HOA",
        "includes": ["Common Area Maintenance", "Landscaping"],
        "fee2": null,
        "fee2_frequency": null
      },
      "taxes": {
        "year": 2024,
        "assessed_value": 85000,
        "annual_amount": 5200,
        "monthly_amount": 433.33,
        "tax_rate": 6.12,
        "legal_description": "LOT 1 BLK A SANTA RITA RANCH",
        "parcel_number": "R123456"
      }
    },
    "schools": {
      "elementary": "Rutledge Elementary",
      "middle": "Running Brushy Middle",
      "high": "Glenn High School"
    },
    "description": "Beautiful new construction home in Santa Rita Ranch...",
    "directions": "From US 183, head west on CR 175...",
    "disclosures": ["Seller Disclosure"],
    "listing_agent": {
      "name": "Jane Smith",
      "email": "jane@realty.com",
      "phone": "512-555-0100",
      "mls_id": "AGT123",
      "key": "AGT123KEY"
    },
    "listing_office": {
      "name": "Austin Realty Group",
      "phone": "512-555-0200",
      "mls_id": "OFF456",
      "key": "OFF456KEY"
    },
    "media": {
      "photo_count": 30,
      "photos_last_updated": "2025-01-14T15:20:00Z",
      "virtual_tour": "https://tour.example.com/branded",
      "photos": [
        { "order": 0, "url": "https://mls-media.movingtoaustin.com/Property/ACT209777414/0.jpg", "content_type": "image/jpeg" },
        { "order": 1, "url": "https://mls-media.movingtoaustin.com/Property/ACT209777414/1.jpg", "content_type": "image/jpeg" }
      ]
    },
    "syndication": {
      "display_online": true,
      "allow_avm": false,
      "syndicated_to": ["Zillow", "Realtor.com"]
    },
    "open_houses": [
      {
        "date": "2025-01-20",
        "start_time": "14:00:00",
        "end_time": "16:00:00",
        "remarks": "Refreshments provided"
      }
    ],
    "price_history": [
      {
        "old_price": 559990,
        "new_price": 530000,
        "change_type": "Price Decrease",
        "timestamp": "2025-01-10T10:00:00Z"
      }
    ],
    "calculated_metrics": {
      "price_per_sqft": 205.83,
      "price_per_acre": 3432624.19,
      "days_on_market": 14
    },
    "local_fields": {}
  }
}
```

### Example Requests

```bash
# By display ID (preferred)
GET /api/listings?listing_id=9743847

# By internal listing key (backward compatibility)
GET /api/listings?listing_key=ACT209777414

# By address + city (SEO-friendly URLs)
GET /api/listings?address=508-echo-pass&city=liberty-hill
```

### Error Responses

**400 Bad Request:**

```json
{
  "error": "Invalid parameters. Must provide either listing_id or both address and city."
}
```

**404 Not Found:**

```json
{
  "error": "Listing not found"
}
```

---

## 4. Batch Property Details

Retrieve complete property details for multiple listings in a single request. Returns the same structure as the single detail endpoint.

### Endpoint

```
GET /api/listings/batch
```

**Source**: [`detail.ts`](../src/routes/detail.ts)

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | string | Yes | Comma-separated listing keys (max 50) |

### Response Format

```json
{
  "listings": [
    { "ids": { "listing_key": "ACT118922373", "..." : "..." }, "..." : "..." }
  ],
  "found": ["ACT118922373", "ACT118922374"],
  "not_found": ["ACT118922375"]
}
```

### Error Responses

**400 Bad Request:**

```json
{ "error": "Invalid parameters. Must provide ids query parameter with comma-separated listing IDs." }
```

```json
{ "error": "No valid listing IDs provided." }
```

```json
{ "error": "Batch size exceeds maximum of 50 listings." }
```

---

## 5. Resolve Listing Keys

Lightweight endpoint for converting internal `listing_key` values to public `listing_id_display` values. Supports single key or comma-separated batch (up to 100).

### Endpoint

```
GET /api/listings/resolve
```

**Source**: [`detail.ts`](../src/routes/detail.ts)

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keys` | string | Yes | Comma-separated `listing_key` values (max 100) |

### Response Format

```json
{
  "resolved": {
    "ACT209777414": "9743847",
    "ACT118922373": "8522990",
    "INVALID_KEY": null
  }
}
```

### Error Responses

**400 Bad Request:**

```json
{ "error": "Query parameter \"keys\" is required (comma-separated listing_key values)" }
```

```json
{ "error": "No valid listing keys provided." }
```

```json
{ "error": "Batch size exceeds maximum of 100 keys." }
```

---

## 6. Typeahead / Suggestions

Typeahead/autocomplete suggestions using PostgreSQL `pg_trgm` for fast fuzzy matching. Searches across addresses, cities, ZIP codes, subdivisions, neighborhoods, counties, and school districts. Results are grouped by type with per-type slot reservation for diversity.

### Endpoint

```
GET /api/suggest
```

**Source**: [`suggest.ts`](../src/routes/suggest.ts)

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (min 1 character) |
| `limit` | int | No | Max results (default: 30, max: 50) |
| `types` | string | No | Comma-separated type filter: `city`, `zip`, `subdivision`, `neighborhood`, `address`, `school_district`, `county` |

### Response Format

```json
{
  "query": "aus",
  "suggestions": [
    {
      "label": "Austin, TX",
      "type": "city",
      "search_value": "austin",
      "search_param": "city",
      "has_polygon": true,
      "listing_count": 7388,
      "location": { "lat": 30.267, "lng": -97.743 }
    },
    {
      "label": "78641",
      "type": "zip",
      "search_value": "78641",
      "search_param": "zip_code",
      "has_polygon": true,
      "listing_count": 959,
      "location": { "lat": 30.561, "lng": -97.823 }
    },
    {
      "label": "Travis County, TX",
      "type": "county",
      "search_value": "travis-county",
      "search_param": "county",
      "has_polygon": true,
      "listing_count": 11549,
      "location": { "lat": 30.334, "lng": -97.771 }
    },
    {
      "label": "123 Main St, Austin, TX 78701",
      "type": "address",
      "search_value": "1234567",
      "search_param": null,
      "has_polygon": false,
      "listing_count": 1,
      "location": { "lat": 30.267, "lng": -97.743 }
    }
  ],
  "grouped": {
    "city": [ "..." ],
    "county": [ "..." ],
    "zip": [ "..." ],
    "address": [ "..." ]
  }
}
```

### Suggestion Types Reference

| `type` | `search_param` | `has_polygon` | `search_value` contains |
|--------|---------------|---------------|------------------------|
| `city` | `city` | `true` (polygon) or `false` (text fallback) | slug or raw city name |
| `county` | `county` | always `true` | slug |
| `zip` | `zip_code` | `true` (polygon) or `false` (text fallback) | slug or raw postal code |
| `neighborhood` | `neighborhood` | always `true` | slug |
| `school_district` | `school_district` | always `true` | slug |
| `subdivision` | `keywords` | always `false` | raw subdivision name |
| `address` | `null` | always `false` | `listing_id_display` (navigate to detail page) |

### Search Matching

| Query length | Strategy |
|-------------|----------|
| 1-2 chars or numeric | Prefix match (`ILIKE 'query%'`) with per-type diversity |
| 3+ chars | Trigram similarity (`%` and `<%>` operators) + prefix match + word-boundary match, combined via `UNION ALL` |

### Caching

- In-memory LRU cache (2,000 entries, 5-minute TTL)
- `X-Cache` response header: `HIT` or `MISS`
- `Cache-Control: public, max-age=60`
- Cache is cleared automatically when the scheduler refreshes the `search_suggestions` table

### Example Requests

```bash
# Basic typeahead
GET /api/suggest?q=aus

# Filter to cities and neighborhoods only
GET /api/suggest?q=down&types=city,neighborhood

# ZIP code lookup
GET /api/suggest?q=78704

# With custom limit
GET /api/suggest?q=travis&limit=10
```

### Error Response

**400 Bad Request:**

```json
{
  "error": "Query parameter \"q\" is required"
}
```

---

## 7. Geographic Areas

Polygon boundaries for search and map overlays. Supports cities, counties, ZIP codes, neighborhoods, and school districts.

**Source**: [`neighborhoods.ts`](../src/routes/neighborhoods.ts)

### List All Areas

```
GET /api/areas
```

Returns all areas, optionally filtered by type. Lightweight — no polygon geometry included.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | Filter by type: `city`, `county`, `zipcode`, `neighborhood`, `school_district` |
| `min_listings` | int | No | Minimum listing count (default: 0) |

#### Response Format

```json
{
  "areas": [
    {
      "id": 42,
      "name": "Austin",
      "slug": "austin",
      "type": "city",
      "source": "US Census TIGER/Line 2023",
      "sq_miles": 322.48,
      "center": { "lat": 30.267, "lng": -97.743 },
      "listing_count": 7388
    }
  ],
  "total": 245
}
```

### Get Single Area with Polygon

```
GET /api/areas/:type/:slug
```

Returns full GeoJSON polygon geometry for map overlay.

#### URL Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | `city`, `county`, `zipcode`, `neighborhood`, or `school_district` |
| `slug` | string | Area slug (e.g., `austin`, `travis-county`, `78704`) |

#### Response Format

```json
{
  "area": {
    "id": 42,
    "name": "Austin",
    "slug": "austin",
    "type": "city",
    "source": "US Census TIGER/Line 2023",
    "sq_miles": 322.48,
    "center": { "lat": 30.267, "lng": -97.743 },
    "listing_count": 7388,
    "geometry": {
      "type": "MultiPolygon",
      "coordinates": ["..."]
    }
  }
}
```

### Backward-Compatible Neighborhood Aliases

These endpoints are equivalent to the area endpoints filtered by `type=neighborhood`:

```
GET /api/neighborhoods              → same as GET /api/areas?type=neighborhood
GET /api/neighborhoods/:slug        → same as GET /api/areas/neighborhood/:slug
```

### Example Requests

```bash
# List all cities with at least 1 listing
GET /api/areas?type=city&min_listings=1

# List all neighborhoods
GET /api/areas?type=neighborhood

# List all ZIP codes
GET /api/areas?type=zipcode

# Get Austin city polygon
GET /api/areas/city/austin

# Get Travis County polygon
GET /api/areas/county/travis-county

# Get ZIP code polygon
GET /api/areas/zipcode/78704

# Get neighborhood polygon
GET /api/areas/neighborhood/downtown

# Get school district polygon
GET /api/areas/school_district/austin-isd

# Backward-compatible neighborhood list
GET /api/neighborhoods

# Backward-compatible neighborhood detail
GET /api/neighborhoods/downtown
```

### Error Responses

**400 Bad Request:**

```json
{ "error": "Invalid type \"foo\". Must be one of: city, county, zipcode, neighborhood, school_district" }
```

**404 Not Found:**

```json
{ "error": "city \"nonexistent\" not found" }
```

---

## 8. Public Listing Statistics

Returns aggregate statistics about listings including homes for sale, homes for rent, and new listings in the last 30 days.

### Endpoint

```
GET /api/stats
```

**Source**: [`stats.ts`](../src/routes/stats.ts)

### Query Parameters

None.

### Response Format

```json
{
  "homes_for_sale": 13068,
  "homes_for_rent": 5915,
  "new_listings_30_days": 7370,
  "timestamp": "2026-02-27T00:13:21.559Z"
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `homes_for_sale` | int | Active Residential properties (`mlg_can_view = true`, `IDX` in `mlg_can_use`) |
| `homes_for_rent` | int | Active Residential Lease properties |
| `new_listings_30_days` | int | Active, viewable listings added in the last 30 days |
| `timestamp` | string | When the stats were generated |

---

## 9. Health Check

Simple health check for load balancers and monitoring. Verifies database connectivity. **No API key required.**

### Endpoint

```
GET /health
```

**Source**: [`health.ts`](../src/routes/health.ts)

### Query Parameters

None.

### Response Format (200 OK)

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00Z",
  "database": "connected"
}
```

### Response Format (503 Service Unavailable)

```json
{
  "status": "error",
  "timestamp": "2025-01-15T10:30:00Z",
  "database": "disconnected",
  "error": "Connection refused"
}
```

---

## 10. Background Scheduler

The API server runs an in-process scheduler for background maintenance tasks.

**Source**: [`scheduler.ts`](../src/scheduler.ts)

### Tasks

| Task | Interval | Initial Delay | Description |
|------|----------|---------------|-------------|
| `refresh-suggestions` | Every 30 min | 2 min after startup | Rebuilds the `search_suggestions` typeahead table to reflect new/expired listings. Clears the suggest LRU cache after each refresh. |

The scheduler uses `setInterval` — no external dependencies (no cron, no Redis, no separate worker).

---

## Common Response Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request — invalid parameters |
| 401 | Unauthorized — missing or invalid `x-api-key` header |
| 404 | Not Found — resource doesn't exist |
| 500 | Internal Server Error |
| 503 | Service Unavailable — database disconnected (health check only) |

---

## Endpoint Summary Table

| # | Method | Path | Auth | Description | Source |
|---|--------|------|------|-------------|--------|
| 1 | GET | `/api/listings/search` | Yes | Property search with filters, sorting, pagination, map pins | `search.ts` |
| 2 | GET | `/api/listings` | Yes | Single property detail | `detail.ts` |
| 3 | GET | `/api/listings/batch` | Yes | Batch property details (up to 50) | `detail.ts` |
| 4 | GET | `/api/listings/resolve` | Yes | Resolve listing_key to listing_id_display (up to 100) | `detail.ts` |
| 5 | GET | `/api/suggest` | Yes | Typeahead / autocomplete suggestions | `suggest.ts` |
| 6 | GET | `/api/areas` | Yes | List geographic areas (filterable by type) | `neighborhoods.ts` |
| 7 | GET | `/api/areas/:type/:slug` | Yes | Get single area with GeoJSON polygon | `neighborhoods.ts` |
| 8 | GET | `/api/neighborhoods` | Yes | List neighborhoods (backward-compatible alias) | `neighborhoods.ts` |
| 9 | GET | `/api/neighborhoods/:slug` | Yes | Get neighborhood with polygon (backward-compatible alias) | `neighborhoods.ts` |
| 10 | GET | `/api/stats` | Yes | Public listing statistics | `stats.ts` |
| 11 | GET | `/health` | No | Health check with database connectivity | `health.ts` |

---

## Route Registration

All routes are registered in [`server.ts`](../src/server.ts):

```typescript
app.register(searchRoutes,       { prefix: '/api/listings' });
app.register(detailRoutes,       { prefix: '/api/listings' });
app.register(suggestRoutes,      { prefix: '/api' });
app.register(statsRoutes,        { prefix: '/api' });
app.register(healthRoutes);       // no prefix — /health
app.register(neighborhoodRoutes, { prefix: '/api' });
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `localhost` (dev) / `0.0.0.0` (prod) | Bind address |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `CORS_ORIGIN` | No | `*` | Comma-separated allowed origins |
| `API_KEY` | Yes | — | Static API key for `x-api-key` header |
| `LOG_LEVEL` | No | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |

---

**Last Updated**: February 2026
**API Version**: 2.0.0
