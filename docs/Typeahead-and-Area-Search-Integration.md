# Typeahead & Area Search — Frontend Integration Guide

This document covers how to integrate the typeahead (autocomplete) and area-based search with map polygon overlays. It explains the data model, API contracts, and recommended frontend logic for handling both polygon-backed and text-fallback suggestions.

---

## Overview

The typeahead serves suggestions from a pre-computed `search_suggestions` table. Each suggestion includes two new fields that tell the frontend exactly how to handle it:

| Field | Type | Description |
|-------|------|-------------|
| `has_polygon` | `boolean` | If `true`, a GeoJSON boundary can be fetched and drawn on the map |
| `search_param` | `string \| null` | The query parameter name to use in `GET /api/listings/search` |

---

## Typeahead API

### Request

```
GET /api/suggest?q={query}&limit={n}&types={comma-separated-types}
x-api-key: <your-api-key>
```

**Parameters:**
- `q` — search query (required, min 1 char)
- `limit` — max results (default 10, max 20)
- `types` — filter by type: `city,county,zip,neighborhood,subdivision,address`

### Response Shape

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
      "label": "78999 - Smalltown, TX",
      "type": "zip",
      "search_value": "78999",
      "search_param": "zip_code",
      "has_polygon": false,
      "listing_count": 3,
      "location": { "lat": 30.12, "lng": -97.55 }
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
      "search_value": "TX-12345678",
      "search_param": null,
      "has_polygon": false,
      "listing_count": 1,
      "location": { "lat": 30.267, "lng": -97.743 }
    }
  ],
  "grouped": {
    "city": [...],
    "county": [...],
    "zip": [...],
    "address": [...]
  }
}
```

### Suggestion Types Reference

| `type` | `search_param` | `has_polygon` | `search_value` contains |
|--------|---------------|---------------|------------------------|
| `city` | `city` | `true` (polygon) or `false` (text fallback) | slug (polygon) or raw city name (text) |
| `county` | `county` | always `true` | slug |
| `zip` | `zip_code` | `true` (polygon) or `false` (text fallback) | slug (polygon) or raw postal code (text) |
| `neighborhood` | `neighborhood` | always `true` | slug |
| `subdivision` | `keywords` | always `false` | raw subdivision name |
| `address` | `null` | always `false` | `listing_key` (navigate to detail page) |

---

## Frontend Decision Logic

When a user selects a suggestion from the typeahead, the frontend should:

```
┌─────────────────────────────────────────────────────────────────┐
│                    User selects a suggestion                     │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
        type = 'address'              type = area type
              │                    (city/county/zip/neighborhood/subdivision)
              ▼                               │
    Navigate to listing                       │
    detail page using                         ▼
    search_value as              Build search URL using:
    listing_key                  ?{search_param}={search_value}
                                              │
                              ┌───────────────┴───────────────┐
                              │                               │
                        has_polygon = true            has_polygon = false
                              │                               │
                              ▼                               ▼
                  Fetch polygon boundary          Use location centroid
                  GET /api/areas/{type}/{slug}    to initially center map
                              │                               │
                              ▼                               ▼
                  Draw polygon overlay            Fire search request
                  on map                          with include_map_pins=true
                              │                               │
                              ▼                               ▼
                  fitBounds to polygon            Use metadata.bounds from
                  + fire search request           response to fitBounds
```

---

## Implementation Examples

### 1. Building the Search URL

```typescript
function buildSearchUrl(suggestion: Suggestion): string | null {
  // Address: navigate to detail page, not search
  if (suggestion.type === 'address') {
    return `/listings/${suggestion.search_value}`;
  }

  // All other types: build search URL
  const params = new URLSearchParams();
  
  if (suggestion.search_param) {
    params.set(suggestion.search_param, suggestion.search_value);
  }
  
  // Always request map pins for area searches
  params.set('include_map_pins', 'true');
  
  return `/search?${params.toString()}`;
}

// Examples:
// city (polygon): ?city=austin&include_map_pins=true
// city (text):    ?city=Pflugerville&include_map_pins=true
// county:         ?county=travis-county&include_map_pins=true
// zip (polygon):  ?zip_code=78641&include_map_pins=true
// zip (text):     ?zip_code=78999&include_map_pins=true
// neighborhood:   ?neighborhood=south-congress&include_map_pins=true
// subdivision:    ?keywords=Steiner+Ranch&include_map_pins=true
```

### 2. Handling Map Polygon Overlay

```typescript
async function handleSuggestionSelected(suggestion: Suggestion, map: MapInstance) {
  if (suggestion.type === 'address') {
    // Navigate to listing detail — no map polygon needed
    router.push(`/listings/${suggestion.search_value}`);
    return;
  }

  if (suggestion.has_polygon) {
    // ── Polygon-backed area ──────────────────────────────────────────
    // Fetch the GeoJSON boundary and draw it on the map
    try {
      const res = await fetch(
        `/api/areas/${suggestion.type}/${suggestion.search_value}`,
        { headers: { 'x-api-key': API_KEY } }
      );
      const { area } = await res.json();
      
      // Draw polygon overlay (Mapbox GL / Google Maps / Leaflet)
      drawPolygonOverlay(map, area.geometry);
      
      // Zoom map to fit the polygon boundary
      const bounds = getBoundsFromGeoJSON(area.geometry);
      map.fitBounds(bounds, { padding: 40 });
    } catch (err) {
      // Fallback to centroid if polygon fetch fails
      if (suggestion.location) {
        map.flyTo({ center: [suggestion.location.lng, suggestion.location.lat], zoom: 12 });
      }
    }
  } else {
    // ── Text-fallback area (no polygon) ─────────────────────────────
    // Pan to the centroid from the suggestion
    if (suggestion.location) {
      const zoomLevel = getZoomForType(suggestion.type);
      map.flyTo({
        center: [suggestion.location.lng, suggestion.location.lat],
        zoom: zoomLevel,
      });
    }
  }

  // Fire the search request (same for both polygon and text-fallback)
  const searchUrl = buildSearchUrl(suggestion);
  const results = await fetchSearchResults(searchUrl);
  
  // After results load, use metadata.bounds to fit the map
  // This works for BOTH polygon and text-fallback cases
  if (results.metadata.bounds && !suggestion.has_polygon) {
    map.fitBounds([
      [results.metadata.bounds.sw.lng, results.metadata.bounds.sw.lat],
      [results.metadata.bounds.ne.lng, results.metadata.bounds.ne.lat],
    ], { padding: 40 });
  }
}

// Suggested zoom levels by type when no polygon is available
function getZoomForType(type: string): number {
  switch (type) {
    case 'county':      return 9;
    case 'city':        return 11;
    case 'zip':         return 12;
    case 'neighborhood':return 13;
    case 'subdivision': return 14;
    default:            return 12;
  }
}
```

### 3. Fetching the Polygon Boundary

```
GET /api/areas/{type}/{slug}
x-api-key: <your-api-key>
```

**Supported types:** `city` | `county` | `zipcode` | `neighborhood`

**Note:** Use `zipcode` (not `zip`) in the URL path. The `type` field in the suggestion response matches the URL path type for `city`, `county`, and `neighborhood`. For `zip` suggestions, use `zipcode` in the URL:

```typescript
function getAreaUrlType(suggestionType: string): string {
  // suggestion.type uses 'zip' but the URL path uses 'zipcode'
  return suggestionType === 'zip' ? 'zipcode' : suggestionType;
}

async function fetchAreaPolygon(suggestion: Suggestion) {
  const urlType = getAreaUrlType(suggestion.type);
  const res = await fetch(
    `/api/areas/${urlType}/${suggestion.search_value}`,
    { headers: { 'x-api-key': API_KEY } }
  );
  return res.json(); // { area: { name, slug, type, geometry, listing_count, center, ... } }
}
```

**Response:**
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
      "coordinates": [...]
    }
  }
}
```

### 4. Listing All Areas by Type

```
GET /api/areas?type=city&min_listings=1
GET /api/areas?type=county
GET /api/areas?type=neighborhood
GET /api/areas?type=zipcode
```

Useful for building browse pages, filter dropdowns, or pre-loading polygon data.

---

## Search API — Area Parameters

When the user selects a suggestion, pass `search_value` as the value for `search_param`:

```
GET /api/listings/search?city=austin
GET /api/listings/search?county=travis-county
GET /api/listings/search?zip_code=78641
GET /api/listings/search?neighborhood=south-congress
GET /api/listings/search?keywords=Steiner+Ranch
```

All area parameters support **comma-separated multi-select**, and **all area filters use OR (union) logic** — both within a single parameter and across different area types:

```
GET /api/listings/search?city=austin,georgetown,round-rock
GET /api/listings/search?county=travis-county,williamson-county
GET /api/listings/search?zip_code=78641,78645&neighborhood=south-congress
GET /api/listings/search?city=austin&county=williamson-county&zip_code=78641
```

- `?zip_code=78641,78645` → listings in 78641 **OR** 78645
- `?zip_code=78641&neighborhood=south-congress` → listings in 78641 **OR** South Congress
- `?city=austin&county=williamson-county` → listings in Austin **OR** Williamson County

A listing matches if it falls within **any** of the selected areas. The frontend can freely mix area types without worrying about empty intersections.

The backend automatically handles polygon vs text matching:
- **Polygon-backed** (slug in `search_areas`): uses `ST_Within(property.geog, polygon)` — spatially accurate
- **Text-fallback** (raw value): uses `LOWER(city) = LOWER(value)` or `postal_code = value` — field matching

The frontend does **not** need to know which path the backend takes — just pass `search_value` as the value for `search_param`.

---

## Map Bounds After Search

The search response always includes `metadata.bounds` when results exist:

```json
{
  "data": [...],
  "metadata": {
    "filtered_listings_count": 7388,
    "bounds": {
      "sw": { "lat": 30.098, "lng": -97.978 },
      "ne": { "lat": 30.516, "lng": -97.561 }
    }
  },
  "map_pins": [...]
}
```

Use `metadata.bounds` to `fitBounds` the map after results load. This works for both polygon-backed and text-fallback areas, and gives you the exact bounding box of the actual listings — not just the polygon boundary.

**Recommended pattern:**
1. If `has_polygon = true`: draw polygon overlay + `fitBounds(polygon)` immediately
2. Fire search request with `include_map_pins=true`
3. Render map pins from `map_pins` array
4. If `has_polygon = false`: `fitBounds(metadata.bounds)` after results load

---

## Backward Compatibility

The existing `/api/neighborhoods` and `/api/neighborhoods/:slug` endpoints are unchanged and continue to work. The new `/api/areas` endpoints are additive.

---

## Data Freshness

| Data | Refresh Frequency | Notes |
|------|------------------|-------|
| Polygon boundaries (`search_areas`) | Manual — run `npm run db:seed-areas` | Only needed when GeoJSON file is updated |
| Typeahead suggestions (`search_suggestions`) | Every 30 min (in-process cron) | Counts may lag up to 30 min behind live listings |
| Search results | Real-time | Queries live `properties` table directly |
| Map pins | Real-time | Included in search response when `include_map_pins=true` |

New listings appear in **search results immediately** after replication. They appear in **typeahead** within 30 minutes (next cron cycle).
