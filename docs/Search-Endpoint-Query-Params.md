# Search Endpoint — Query Parameter Reference

**Endpoint:** `GET /api/listings/search`

All parameters are optional unless noted. Parameters are passed as URL query strings. Multiple filters are combined with `AND` logic unless otherwise specified.

---

## Pagination

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `page` | integer | `1` | ≥ 1 | Page number to return. |
| `items_per_page` | integer \| `"all"` | `20` | 1–10,000 or `"all"` | Number of listings per page. Use `"all"` to return up to 10,000 results in a single response (use with caution on large result sets). |

---

## Sorting

| Parameter | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `sort_by` | enum | `list_date` | `list_date`, `list_price`, `living_area`, `price_per_sqft`, `status`, `bedrooms_total`, `bathrooms_total` | Field to sort results by. `list_date` sorts by the original listing entry timestamp. `price_per_sqft` is a computed value (`list_price / living_area`). |
| `sort_direction` | enum | `desc` | `asc`, `desc` | Sort order. `NULL` values are always sorted last regardless of direction. |

---

## Geographic Filters

Geographic filters can be combined. When multiple area-type parameters are provided (e.g., `zip_code` + `neighborhood`), listings matching **any** of the selected areas are returned (union/OR logic). Within a single parameter, comma-separated values are also unioned.

### Bounding Box

All four parameters must be provided together for the bounding box filter to apply.

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `min_latitude` | float | -90 to 90 | Southwest corner latitude. |
| `max_latitude` | float | -90 to 90 | Northeast corner latitude. |
| `min_longitude` | float | -180 to 180 | Southwest corner longitude. |
| `max_longitude` | float | -180 to 180 | Northeast corner longitude. |

### GeoJSON Polygon

| Parameter | Type | Description |
|---|---|---|
| `polygon` | string (JSON) | A URL-encoded GeoJSON geometry object (e.g., `Polygon` or `MultiPolygon`). Listings are filtered using `ST_Within`. Returns a `400 INVALID_POLYGON` error if the JSON is malformed. |

### Named Area Filters

Values for these parameters are **slugs** obtained from the `/api/suggest` typeahead endpoint. Multiple slugs can be comma-separated within a single parameter.

| Parameter | Type | Description |
|---|---|---|
| `neighborhood` | string (slug) | Filter by one or more neighborhood polygon areas. Always polygon-backed (`ST_Within`). |
| `city` | string (slug) | Filter by one or more city polygon areas. Falls back to a text match on the `city` field if no polygon exists for the slug. |
| `zip_code` | string (slug) | Filter by one or more ZIP code polygon areas. Falls back to a text match on the `postal_code` field if no polygon exists. |
| `county` | string (slug) | Filter by one or more county polygon areas. Always polygon-backed (`ST_Within`). |
| `school_district` | string (slug) | Filter by one or more school district polygon areas. Always polygon-backed (`ST_Within`). |

**Example:** `?city=austin&zip_code=78701,78702` returns listings in Austin city limits **or** in ZIP codes 78701/78702.

---

## Property Characteristics

### Status

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `status` | string | `active`, `pending`, `active_under_contract`, `sold` | Listing status. Comma-separate multiple values (e.g., `active,pending`). Maps to MLS standard statuses: `active` → `Active`, `pending` → `Pending`, `active_under_contract` → `Active Under Contract`, `sold` → `Closed`. |

### Property Type

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `property_type` | string | `Residential`, `Residential Lease`, `Residential Income`, `Commercial Sale`, `Commercial Lease`, `Land`, `Farm` | Property type as stored in the MLS. Comma-separate multiple values. |
| `property_sub_type` | string | `Single Family Residence`, `Condominium`, `Townhouse`, `Duplex`, `Triplex`, `Quadruplex`, `Multi Family`, `Apartment`, `Manufactured Home`, `Mobile Home`, `Modular Home`, `Mobile Home Park`, `Agriculture`, `Ranch`, `Unimproved Land`, `Site Planned`, `Site-Pad`, `Multiple Lots (Adjacent)`, `Business`, `Industrial`, `Office`, `Retail`, `Hotel/Motel`, `Warehouse`, `Mixed Use`, `See Remarks` | Property sub-type. Comma-separate multiple values. Passing `all` is treated as no filter. |

### Price

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `min_price` | integer | ≥ 0 | Minimum list price in USD. |
| `max_price` | integer | ≥ 0 | Maximum list price in USD. |
| `min_price_per_sqft` | float | ≥ 0 | Minimum price per square foot (computed as `list_price / living_area`). |
| `max_price_per_sqft` | float | ≥ 0 | Maximum price per square foot. |

### Size

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `min_sqft` | integer | ≥ 0 | Minimum living area in square feet. |
| `max_sqft` | integer | ≥ 0 | Maximum living area in square feet. |
| `min_lot_size` | float | ≥ 0 | Minimum lot size in acres. |
| `max_lot_size` | float | ≥ 0 | Maximum lot size in acres. |

### Bedrooms & Bathrooms

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `min_bedrooms` | integer | ≥ 0 | Minimum total bedrooms. |
| `max_bedrooms` | integer | ≥ 0 | Maximum total bedrooms. |
| `min_bathrooms` | float | ≥ 0 | Minimum total bathrooms (supports half-baths, e.g., `2.5`). |
| `max_bathrooms` | float | ≥ 0 | Maximum total bathrooms. |

### Year Built

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `min_year_built` | integer | ≥ 1800 | Earliest year the property was built. |
| `max_year_built` | integer | ≤ 2100 | Latest year the property was built. |

---

## Amenities

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `pool` | boolean | `true`, `false` | When `true`, only returns listings with a private pool (`pool_private_yn = true`). |
| `waterfront` | boolean | `true`, `false` | When `true`, only returns waterfront listings (`waterfront_yn = true`). |
| `fireplace` | boolean | `true`, `false` | When `true`, only returns listings with at least one fireplace (`fireplaces_total > 0`). |
| `new_construction` | boolean | `true`, `false` | When `true`, only returns new construction listings (`new_construction_yn = true`). |
| `garage` | boolean | `true`, `false` | When `true`, only returns listings with at least one garage space (`garage_spaces > 0`). |
| `min_garage_spaces` | integer | ≥ 0 | Minimum number of garage spaces. |
| `max_garage_spaces` | integer | ≥ 0 | Maximum number of garage spaces. |
| `min_parking_spaces` | integer | ≥ 0 | Minimum total parking spaces (includes garage + other). |
| `max_parking_spaces` | integer | ≥ 0 | Maximum total parking spaces. |

> **Note:** Boolean parameters must be passed as the string `"true"` or `"false"` (not `1`/`0`).

---

## Timing & Market Filters

### Days on Market

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `days_on_market` | integer | ≥ 0 | Maximum number of days the listing has been on market. Calculated from the original listing entry timestamp using the America/Chicago timezone to avoid UTC boundary issues. |

### Price Reduction

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `price_reduction` | enum | `any`, `last_day`, `last_3_days`, `last_7_days`, `last_14_days`, `last_30_days`, `over_1_month`, `over_2_months`, `over_3_months` | Filters to listings where `list_price < original_list_price`. The value further constrains when the most recent price change occurred (`major_change_ts`). `any` returns all reduced listings regardless of when. `last_*` values require the reduction to have occurred within that window. `over_*` values require the reduction to have occurred more than that many days ago. |

### Open Houses

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `open_house` | enum | `this_weekend`, `next_weekend`, `all` | Filters to listings with a scheduled open house. `this_weekend` = Saturday–Sunday of the current week. `next_weekend` = Saturday–Sunday of the following week. `all` = any future open house date. **Note:** When this filter is active, `include_map_pins` is ignored (map pins are not returned). |

---

## History-Derived Filters

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `back_on_market` | boolean | `true`, `false` | When `true`, returns listings that previously went Pending or Active Under Contract and have since returned to Active status (detected via `status_history`). |
| `multiple_price_reductions` | boolean | `true`, `false` | When `true`, returns listings that have had more than one price reduction (detected via `price_history`). |

---

## Text Search

| Parameter | Type | Description |
|---|---|---|
| `keywords` | string | Case-insensitive partial text match (`ILIKE`) against: street address, city, subdivision name, public remarks, and postal code. |

---

## Map Pins (Split-Response Mode)

| Parameter | Type | Allowed Values | Description |
|---|---|---|---|
| `include_map_pins` | boolean | `true`, `false` | When `true`, the response includes a `map_pins` array containing lightweight pin data (id, lat, lng, price, status, beds, baths, property_type) for **all** matching listings (up to 5,000), alongside the normal paginated `data` array. This allows the frontend to render all map markers while paginating the card list independently. Ignored when `open_house` filter is active. |

When `include_map_pins=true`, the response `metadata` object includes two additional fields:

| Field | Type | Description |
|---|---|---|
| `map_pins_count` | integer | Number of pins returned in the `map_pins` array. |
| `map_pins_truncated` | boolean | `true` if the result set exceeded 5,000 listings and the pin array was capped. |

---

## Response Shape

### `data[]` — Paginated listing cards

Each object in the `data` array includes:

| Field | Type | Description |
|---|---|---|
| `listing_id` | string | Display listing ID. |
| `standard_status` | string | MLS status (`Active`, `Pending`, `Active Under Contract`, `Closed`). |
| `list_price` | number | Current list price in USD. |
| `price_per_sqft` | number \| null | Computed price per square foot. |
| `price_reduced` | boolean | `true` if current price is below original list price. |
| `price_reduction_amount` | number \| null | Dollar amount of reduction (rounded to nearest dollar). |
| `price_reduction_count` | integer | Total number of price reductions recorded. |
| `back_on_market` | boolean | Whether the listing returned to Active from Pending/AUC. |
| `bedrooms_total` | number \| null | Total bedrooms. |
| `bathrooms_total` | number \| null | Total bathrooms. |
| `living_area` | number \| null | Living area in square feet. |
| `year_built` | integer \| null | Year the property was built. |
| `lot_size_acres` | number \| null | Lot size in acres. |
| `days_on_market` | integer | Days since original listing entry (Chicago timezone). |
| `pool_private` | boolean | Has a private pool. |
| `garage_spaces` | number | Number of garage spaces. |
| `new_construction` | boolean | Is new construction. |
| `waterfront` | boolean | Is waterfront. |
| `property_type` | string | Property type. |
| `property_sub_type` | string | Property sub-type. |
| `street_name` | string | Street name. |
| `city` | string | City. |
| `state_or_province` | string | State. |
| `postal_code` | string | ZIP code. |
| `county_or_parish` | string | County. |
| `unparsed_address` | string | Full address string. |
| `subdivision_name` | string | Subdivision or community name. |
| `list_office_name` | string | Listing brokerage name. |
| `major_change_type` | string | Most recent major change type (e.g., `Price Decrease`). |
| `_geo` | `{ lat, lng }` \| null | Coordinates for map rendering. |
| `photo_count` | integer | Total number of photos. |
| `photo_urls` | `{ order, url }[]` | Up to 3 photo URLs, ordered by `media_order`. |
| `next_open_house` | `{ date, start_time, end_time }` \| null | Next upcoming open house, if any. |

### `metadata` object

| Field | Type | Description |
|---|---|---|
| `total_listings_count` | integer | Total IDX-eligible listings in the database (cached, refreshed every 5 minutes). |
| `filtered_listings_count` | integer | Total listings matching the current filters. |
| `current_page` | integer | Current page number. |
| `total_pages` | integer | Total number of pages for the filtered result set. |
| `items_per_page` | integer | Items per page used for this request. |
| `sort_by` | string | Active sort field. |
| `sort_direction` | string | Active sort direction. |
| `bounds` | `{ sw: { lat, lng }, ne: { lat, lng } }` \| null | Geographic bounding box of the returned results. Computed from map pins when available (covers full filtered set), otherwise from the paginated page data. |

### `map_pins[]` — Only present when `include_map_pins=true`

| Field | Type | Description |
|---|---|---|
| `id` | string | Listing display ID. |
| `lat` | number | Latitude. |
| `lng` | number | Longitude. |
| `price` | number | List price. |
| `status` | string | MLS status. |
| `beds` | number \| null | Bedrooms. |
| `baths` | number \| null | Bathrooms. |
| `property_type` | string | Property type. |

---

## Error Responses

| HTTP Status | Code | Description |
|---|---|---|
| `400` | `VALIDATION_ERROR` | One or more query parameters failed validation. The `details` field contains per-field error messages. |
| `400` | `INVALID_POLYGON` | The `polygon` parameter contains invalid JSON. |
| `500` | `SEARCH_ERROR` | An internal server error occurred. In development mode, `details` contains the error message. |

---

## Example Requests

```
# Active single-family homes in Austin under $600k with 3+ beds
GET /api/listings/search?status=active&city=austin&property_sub_type=Single Family Residence&max_price=600000&min_bedrooms=3

# Listings with a price reduction in the last 7 days, sorted by price ascending
GET /api/listings/search?price_reduction=last_7_days&sort_by=list_price&sort_direction=asc

# Map view: all active listings in a bounding box with map pins
GET /api/listings/search?status=active&min_latitude=30.1&max_latitude=30.5&min_longitude=-97.9&max_longitude=-97.5&include_map_pins=true&items_per_page=20

# Open houses this weekend in Travis County
GET /api/listings/search?county=travis-county&open_house=this_weekend

# New construction condos or townhouses, sorted by newest
GET /api/listings/search?new_construction=true&property_sub_type=Condominium,Townhouse&sort_by=list_date&sort_direction=desc
```
