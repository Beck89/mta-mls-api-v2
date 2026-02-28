# Listing ID Migration: `listing_key` → `listing_id_display`

## Summary

All public-facing API responses now use `listing_id_display` (the MLS-approved display ID) instead of internal identifiers (`listing_key`, `listing_id`). This ensures MLS compliance — only the display-approved ID is exposed to end users on the marketing site.

---

## What Changed

### Search Results (`GET /api/listings/search`)

**Before:**
```json
{
  "data": [
    {
      "listing_key": "abc123-internal-key",
      "listing_id": "9876543",
      "standard_status": "Active",
      ...
    }
  ]
}
```

**After:**
```json
{
  "data": [
    {
      "listing_id": "1234567",
      "standard_status": "Active",
      ...
    }
  ]
}
```

- `listing_key` — **removed** from response
- `listing_id` — now contains the **display ID** (`listing_id_display` value), not the internal MLS ID
- This is the ID you should use for linking to property detail pages

### Map Pins (`include_map_pins=true`)

**Before:**
```json
{
  "map_pins": [
    {
      "id": "abc123-internal-key",
      "lat": 30.27,
      "lng": -97.74,
      "price": 450000,
      ...
    }
  ]
}
```

**After:**
```json
{
  "map_pins": [
    {
      "id": "1234567",
      "lat": 30.27,
      "lng": -97.74,
      "price": 450000,
      ...
    }
  ]
}
```

- `id` — now contains the **display ID** instead of `listing_key`

### Property Detail (`GET /api/listings`)

**Before:**
```
GET /api/listings?listing_id=abc123-internal-key
```

**After — preferred:**
```
GET /api/listings?listing_id=1234567
```

The `listing_id` parameter now resolves the **display ID** first, then falls back to `listing_key` for backward compatibility.

**New alternative (internal use only):**
```
GET /api/listings?listing_key=abc123-internal-key
```

The detail response is unchanged — it still returns the full property detail object with `ids.listing_id_display`.

### Typeahead Address Suggestions (`GET /api/suggest`)

Address suggestions now return the display ID as `search_value`:

**Before:**
```json
{
  "label": "123 Main St, Austin, TX 78701",
  "type": "address",
  "search_value": "abc123-internal-key",
  "search_param": null
}
```

**After:**
```json
{
  "label": "123 Main St, Austin, TX 78701",
  "type": "address",
  "search_value": "1234567",
  "search_param": null
}
```

---

## Frontend Integration Guide

### Linking from Search Results to Detail Page

```typescript
// Search result item
const listing = searchResults.data[0];

// Navigate to detail page using the listing_id (now the display ID)
const detailUrl = `/api/listings?listing_id=${listing.listing_id}`;
```

### Linking from Map Pin Click to Detail Page

```typescript
// Map pin click handler
function onPinClick(pin) {
  // pin.id is now the display ID
  const detailUrl = `/api/listings?listing_id=${pin.id}`;
}
```

### Linking from Typeahead Address Selection

```typescript
// When user selects an address suggestion
function onAddressSelect(suggestion) {
  if (suggestion.type === 'address') {
    // search_value is now the display ID
    const detailUrl = `/api/listings?listing_id=${suggestion.search_value}`;
  }
}
```

### Displaying the MLS Number

The `listing_id` in search results is the MLS-approved display ID. You can show it directly:

```html
<span class="mls-number">MLS# {{ listing.listing_id }}</span>
```

---

## Migration Checklist for Frontend

- [ ] Update search result card links to use `listing.listing_id` (was `listing.listing_key`)
- [ ] Update map pin click handlers to use `pin.id` for detail navigation (value changed from internal key to display ID)
- [ ] Update typeahead address selection to navigate using `suggestion.search_value` (value changed from internal key to display ID)
- [ ] Remove any references to `listing_key` in frontend code — it's no longer returned
- [ ] Update any URL patterns that used `listing_key` to use `listing_id` instead
- [ ] Verify MLS number display uses `listing.listing_id`

---

## Backward Compatibility

- The detail route (`GET /api/listings`) still accepts internal `listing_key` values via the new `?listing_key=` parameter for backward compatibility
- If `?listing_id=` doesn't match a `listing_id_display`, it falls back to trying it as a `listing_key`
- The search and map pin responses have **breaking changes** — `listing_key` is removed, `listing_id` / `id` values have changed

---

## Deployment Notes

After deploying the API changes, run the suggestions refresh to update address suggestion `search_value` fields:

```bash
npx tsx src/db/refresh-suggestions.ts
```
