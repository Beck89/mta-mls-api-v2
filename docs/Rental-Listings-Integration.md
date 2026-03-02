# Rental Listings — Frontend Integration Guide

Complete reference for integrating rental listing features into the marketing site. Covers search filters, search result cards, and property detail pages for `Residential Lease` and `Commercial Lease` listings.

**Data coverage**: ~8,450 rental listings with rich rental-specific metadata (security deposits, pet policies, lease terms, laundry, application URLs, etc.)

---

## Table of Contents

1. [Overview](#overview)
2. [Search Filters](#search-filters)
3. [Search Results — `rental_details` Object](#search-results--rental_details-object)
4. [Property Detail — `rental_details` Object](#property-detail--rental_details-object)
5. [TypeScript Interfaces](#typescript-interfaces)
6. [UI Component Patterns](#ui-component-patterns)
7. [Example API Calls](#example-api-calls)

---

## Overview

Rental listings are identified by `property_type` containing "Lease" (e.g., `Residential Lease`, `Commercial Lease`). When a listing is a lease, both the search and detail endpoints now return a `rental_details` object with structured rental-specific data. For non-lease listings, `rental_details` is `null`.

### What Changed

| Endpoint | Change |
|----------|--------|
| `GET /api/listings/search` | New `rental_details` field on each search result card |
| `GET /api/listings/search` | 6 new rental-specific filter parameters |
| `GET /api/listings` (detail) | New `rental_details` section with full rental data |

### Data Coverage (out of ~8,450 rental listings)

| Field | Coverage | Notes |
|-------|----------|-------|
| Security deposit | 100% | Always present |
| Pet deposit | 97% | Almost always present |
| Monthly pet rent | 57% | When applicable |
| Min lease months | 69% | |
| Max lease months | 63% | |
| Housing vouchers | 100% | Boolean (accepts or not) |
| Max # of pets | 98% | 0 = no pets allowed |
| Smoking allowed | 100% | Boolean |
| Laundry location | 100% | e.g., "In Unit", "Main Level" |
| Unit style | 47% | e.g., "1st Floor Entry", "End Unit" |
| Management company | 56% | Company name |
| Application URL | 45% | RentSpree or custom URL |
| Complex name | 32% | Apartment complex name |
| Meter/utility billing | 45% | e.g., "Electric Separate" |

---

## Search Filters

Add these query parameters to `GET /api/listings/search` to filter rental listings. Best used with `property_type=Residential Lease`.

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `pets_allowed` | `"true"` | `pets_allowed=true` | Only listings that allow pets (max pets > 0) |
| `housing_vouchers` | `"true"` | `housing_vouchers=true` | Only listings accepting Section 8 housing vouchers |
| `max_security_deposit` | integer | `max_security_deposit=1500` | Maximum security deposit in USD |
| `laundry_in_unit` | `"true"` | `laundry_in_unit=true` | Only listings with in-unit laundry |
| `min_lease_months` | integer | `min_lease_months=6` | Minimum acceptable lease term (filters by max lease ≥ this value) |
| `max_lease_months` | integer | `max_lease_months=12` | Maximum acceptable lease term (filters by min lease ≤ this value) |

> **Note**: These filters query JSONB fields in the database. They work on any listing but are most meaningful when combined with `property_type=Residential Lease`.

### Filter Combinations

```
# Basic rental search
?property_type=Residential Lease&status=active&city=austin

# Pet-friendly with in-unit laundry
?property_type=Residential Lease&status=active&pets_allowed=true&laundry_in_unit=true

# Budget-friendly: under $1500/mo, low deposit, accepts vouchers
?property_type=Residential Lease&status=active&max_price=1500&max_security_deposit=1000&housing_vouchers=true

# Short-term rentals (6 months or less)
?property_type=Residential Lease&status=active&max_lease_months=6

# 2+ bed apartments under $2000
?property_type=Residential Lease&property_sub_type=Apartment&min_bedrooms=2&max_price=2000&status=active
```

---

## Search Results — `rental_details` Object

Each item in the search `data[]` array now includes a `rental_details` field. It is `null` for non-lease listings and an object for lease listings.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `security_deposit` | number \| null | Security deposit amount in USD |
| `pet_deposit` | number \| null | Pet deposit amount in USD |
| `monthly_pet_rent` | number \| null | Additional monthly pet rent in USD |
| `pets_allowed` | boolean | Whether pets are allowed |
| `max_pets` | number \| null | Maximum number of pets allowed |
| `lease_min_months` | number \| null | Minimum lease term in months |
| `lease_max_months` | number \| null | Maximum lease term in months |
| `housing_vouchers_accepted` | boolean | Whether Section 8 vouchers are accepted |
| `smoking_allowed` | boolean | Whether smoking is allowed inside |
| `laundry_location` | string[] | Laundry location(s), e.g., `["In Unit"]`, `["Main Level", "Laundry Room"]` |
| `application_url` | string \| null | URL for online rental application (RentSpree or custom) |

### Example Search Result (Rental)

```json
{
  "listing_id": "8234567",
  "standard_status": "Active",
  "list_price": 1650,
  "property_type": "Residential Lease",
  "property_sub_type": "Single Family Residence",
  "bedrooms_total": 3,
  "bathrooms_total": 2,
  "living_area": 1400,
  "unparsed_address": "1234 Oak Hill Dr",
  "city": "Austin",
  "state_or_province": "TX",
  "postal_code": "78745",
  "photo_urls": [
    { "order": 0, "url": "https://mls-media.movingtoaustin.com/..." }
  ],
  "rental_details": {
    "security_deposit": 1650,
    "pet_deposit": 300,
    "monthly_pet_rent": 25,
    "pets_allowed": true,
    "max_pets": 2,
    "lease_min_months": 12,
    "lease_max_months": 24,
    "housing_vouchers_accepted": false,
    "smoking_allowed": false,
    "laundry_location": ["In Unit"],
    "application_url": "https://apply.link/abc123"
  }
}
```

### Example Search Result (Non-Rental)

```json
{
  "listing_id": "7522990",
  "property_type": "Residential",
  "list_price": 450000,
  "rental_details": null
}
```

---

## Property Detail — `rental_details` Object

The detail endpoint (`GET /api/listings?listing_id=...`) returns a more comprehensive `rental_details` object for lease listings. It includes everything from the search result plus additional fields.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `security_deposit` | number \| null | Security deposit amount in USD |
| `lease_terms.min_months` | number \| null | Minimum lease term in months |
| `lease_terms.max_months` | number \| null | Maximum lease term in months |
| `pets.allowed` | boolean | Whether pets are allowed |
| `pets.max_number` | number \| null | Maximum number of pets |
| `pets.deposit` | number \| null | Pet deposit in USD |
| `pets.monthly_pet_rent` | number \| null | Additional monthly pet rent in USD |
| `pets.deposit_per_pet` | boolean | Whether the deposit is charged per pet |
| `smoking_allowed` | boolean | Whether smoking is allowed inside |
| `housing_vouchers_accepted` | boolean | Whether Section 8 vouchers are accepted |
| `laundry_location` | string[] | Laundry location(s) |
| `unit_style` | string[] | Unit style descriptors (e.g., `["1st Floor Entry", "End Unit"]`) |
| `meter_description` | string[] | Utility billing info (e.g., `["Electric Separate", "Water Common"]`) |
| `complex_name` | string \| null | Apartment complex name |
| `management_company` | string \| null | Property management company name |
| `home_office` | boolean \| null | Whether the unit has a home office |
| `guest_accommodation` | string \| null | Guest accommodation description |
| `num_living_areas` | number \| null | Number of living areas |
| `application.rentspree_url` | string \| null | RentSpree application URL |
| `application.online_app_url` | string \| null | Other online application URL |
| `flood_plain` | string \| null | FEMA flood plain designation |

### Example Detail Response (Rental)

```json
{
  "listing": {
    "ids": { "listing_id": "8234567", "mls": "actris" },
    "status": { "standard_status": "Active", "days_on_market": 14 },
    "pricing": { "current_price": 1650 },
    "property_details": { "type": "Single Family Residence", "category": "Residential Lease" },
    "location": { "address": "1234 Oak Hill Dr", "city": "Austin", "state": "TX", "zip": "78745" },
    "size": { "living_area_sqft": 1400 },
    "rooms": { "bedrooms": 3, "bathrooms_total": 2 },
    "rental_details": {
      "security_deposit": 1650,
      "lease_terms": {
        "min_months": 12,
        "max_months": 24
      },
      "pets": {
        "allowed": true,
        "max_number": 2,
        "deposit": 300,
        "monthly_pet_rent": 25,
        "deposit_per_pet": true
      },
      "smoking_allowed": false,
      "housing_vouchers_accepted": false,
      "laundry_location": ["In Unit"],
      "unit_style": ["1st Floor Entry", "Single level Floor Plan"],
      "meter_description": ["Electric Separate", "Water Common"],
      "complex_name": null,
      "management_company": "Knippa Properties",
      "home_office": true,
      "guest_accommodation": null,
      "num_living_areas": 1,
      "application": {
        "rentspree_url": "https://apply.link/abc123",
        "online_app_url": null
      },
      "flood_plain": null
    },
    "local_fields": { "..." }
  }
}
```

> **Note**: `rental_details` is `null` for non-lease listings. The `local_fields` object still contains the raw MLS data for any edge cases.

---

## TypeScript Interfaces

### Search Result Rental Details

```typescript
interface SearchRentalDetails {
  security_deposit: number | null;
  pet_deposit: number | null;
  monthly_pet_rent: number | null;
  pets_allowed: boolean;
  max_pets: number | null;
  lease_min_months: number | null;
  lease_max_months: number | null;
  housing_vouchers_accepted: boolean;
  smoking_allowed: boolean;
  laundry_location: string[];
  application_url: string | null;
}
```

### Detail Rental Details

```typescript
interface DetailRentalDetails {
  security_deposit: number | null;
  lease_terms: {
    min_months: number | null;
    max_months: number | null;
  };
  pets: {
    allowed: boolean;
    max_number: number | null;
    deposit: number | null;
    monthly_pet_rent: number | null;
    deposit_per_pet: boolean;
  };
  smoking_allowed: boolean;
  housing_vouchers_accepted: boolean;
  laundry_location: string[];
  unit_style: string[];
  meter_description: string[];
  complex_name: string | null;
  management_company: string | null;
  home_office: boolean | null;
  guest_accommodation: string | null;
  num_living_areas: number | null;
  application: {
    rentspree_url: string | null;
    online_app_url: string | null;
  };
  flood_plain: string | null;
}
```

### Updated Listing Card

```typescript
interface ListingCard {
  listing_id: string;
  list_price: number;
  property_type: string;
  property_sub_type: string;
  bedrooms_total: number;
  bathrooms_total: number;
  living_area: number | null;
  unparsed_address: string;
  city: string;
  state_or_province: string;
  photo_urls: { order: number; url: string }[];
  price_reduced: boolean;
  price_reduction_amount: number | null;
  rental_details: SearchRentalDetails | null;  // null for non-lease listings
  _geo: { lat: number; lng: number } | null;
  // ... other fields
}
```

---

## UI Component Patterns

### Rental Search Card — Key Fields to Display

For rental listing cards, display these fields from `rental_details`:

```tsx
function RentalListingCard({ listing }: { listing: ListingCard }) {
  const rental = listing.rental_details;
  const isRental = rental !== null;

  return (
    <div className="listing-card">
      {/* Photo */}
      <img src={listing.photo_urls[0]?.url} alt={listing.unparsed_address} />

      {/* Price — show as monthly rent for rentals */}
      <div className="price">
        {isRental ? `$${listing.list_price.toLocaleString()}/mo` : `$${listing.list_price.toLocaleString()}`}
      </div>

      {/* Beds / Baths / Sqft */}
      <div className="specs">
        {listing.bedrooms_total} bd | {listing.bathrooms_total} ba | {listing.living_area?.toLocaleString()} sqft
      </div>

      {/* Address */}
      <div className="address">{listing.unparsed_address}, {listing.city}</div>

      {/* Rental-specific badges */}
      {isRental && (
        <div className="rental-badges">
          {rental.pets_allowed && <span className="badge">🐾 Pets OK</span>}
          {rental.laundry_location.some(l => l.includes('In Unit')) && <span className="badge">🧺 In-Unit Laundry</span>}
          {rental.housing_vouchers_accepted && <span className="badge">🏠 Vouchers Accepted</span>}
          {rental.application_url && <span className="badge">📋 Apply Online</span>}
        </div>
      )}

      {/* Rental quick facts */}
      {isRental && (
        <div className="rental-facts">
          {rental.security_deposit && <span>Deposit: ${rental.security_deposit.toLocaleString()}</span>}
          {rental.lease_min_months && rental.lease_max_months && (
            <span>Lease: {rental.lease_min_months}–{rental.lease_max_months} mo</span>
          )}
        </div>
      )}
    </div>
  );
}
```

### Rental Detail Page — Sections to Add

On the property detail page, add a "Rental Information" section for lease listings:

```tsx
function RentalInfoSection({ rental }: { rental: DetailRentalDetails }) {
  return (
    <section className="rental-info">
      <h2>Rental Information</h2>

      {/* Lease Terms */}
      <div className="info-group">
        <h3>Lease Terms</h3>
        <dl>
          {rental.security_deposit && <><dt>Security Deposit</dt><dd>${rental.security_deposit.toLocaleString()}</dd></>}
          {rental.lease_terms.min_months && <><dt>Min Lease</dt><dd>{rental.lease_terms.min_months} months</dd></>}
          {rental.lease_terms.max_months && <><dt>Max Lease</dt><dd>{rental.lease_terms.max_months} months</dd></>}
        </dl>
      </div>

      {/* Pet Policy */}
      <div className="info-group">
        <h3>Pet Policy</h3>
        <dl>
          <dt>Pets Allowed</dt><dd>{rental.pets.allowed ? 'Yes' : 'No'}</dd>
          {rental.pets.allowed && (
            <>
              {rental.pets.max_number && <><dt>Max Pets</dt><dd>{rental.pets.max_number}</dd></>}
              {rental.pets.deposit && <><dt>Pet Deposit</dt><dd>${rental.pets.deposit.toLocaleString()}{rental.pets.deposit_per_pet ? ' per pet' : ''}</dd></>}
              {rental.pets.monthly_pet_rent && <><dt>Monthly Pet Rent</dt><dd>${rental.pets.monthly_pet_rent}/mo</dd></>}
            </>
          )}
        </dl>
      </div>

      {/* Rules */}
      <div className="info-group">
        <h3>Rules & Policies</h3>
        <dl>
          <dt>Smoking</dt><dd>{rental.smoking_allowed ? 'Allowed' : 'Not Allowed'}</dd>
          <dt>Housing Vouchers</dt><dd>{rental.housing_vouchers_accepted ? 'Accepted' : 'Not Accepted'}</dd>
        </dl>
      </div>

      {/* Unit Features */}
      <div className="info-group">
        <h3>Unit Features</h3>
        <dl>
          {rental.laundry_location.length > 0 && <><dt>Laundry</dt><dd>{rental.laundry_location.join(', ')}</dd></>}
          {rental.unit_style.length > 0 && <><dt>Unit Style</dt><dd>{rental.unit_style.join(', ')}</dd></>}
          {rental.num_living_areas && <><dt>Living Areas</dt><dd>{rental.num_living_areas}</dd></>}
          {rental.home_office && <><dt>Home Office</dt><dd>Yes</dd></>}
        </dl>
      </div>

      {/* Utilities */}
      {rental.meter_description.length > 0 && (
        <div className="info-group">
          <h3>Utilities</h3>
          <ul>{rental.meter_description.map(m => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      {/* Management */}
      {(rental.management_company || rental.complex_name) && (
        <div className="info-group">
          <h3>Management</h3>
          <dl>
            {rental.complex_name && <><dt>Complex</dt><dd>{rental.complex_name}</dd></>}
            {rental.management_company && <><dt>Management</dt><dd>{rental.management_company}</dd></>}
          </dl>
        </div>
      )}

      {/* Apply Button */}
      {(rental.application.rentspree_url || rental.application.online_app_url) && (
        <a
          href={rental.application.rentspree_url || rental.application.online_app_url!}
          target="_blank"
          rel="noopener noreferrer"
          className="apply-button"
        >
          Apply Online
        </a>
      )}
    </section>
  );
}
```

### Rental Search Filter Panel

```tsx
function RentalFilters({ onFilterChange }: { onFilterChange: (params: Record<string, string>) => void }) {
  return (
    <div className="rental-filters">
      <h3>Rental Filters</h3>

      <label>
        <input type="checkbox" onChange={e => onFilterChange({ pets_allowed: e.target.checked ? 'true' : '' })} />
        Pets Allowed
      </label>

      <label>
        <input type="checkbox" onChange={e => onFilterChange({ laundry_in_unit: e.target.checked ? 'true' : '' })} />
        In-Unit Laundry
      </label>

      <label>
        <input type="checkbox" onChange={e => onFilterChange({ housing_vouchers: e.target.checked ? 'true' : '' })} />
        Accepts Housing Vouchers
      </label>

      <label>
        Max Security Deposit
        <input
          type="number"
          placeholder="e.g., 1500"
          onChange={e => onFilterChange({ max_security_deposit: e.target.value })}
        />
      </label>

      <label>
        Lease Term (months)
        <div className="range-inputs">
          <input type="number" placeholder="Min" onChange={e => onFilterChange({ min_lease_months: e.target.value })} />
          <input type="number" placeholder="Max" onChange={e => onFilterChange({ max_lease_months: e.target.value })} />
        </div>
      </label>
    </div>
  );
}
```

---

## Example API Calls

### Search: All Active Rentals in Austin

```bash
GET /api/listings/search?property_type=Residential Lease&status=active&city=austin
```

### Search: Pet-Friendly Rentals with In-Unit Laundry

```bash
GET /api/listings/search?property_type=Residential Lease&status=active&city=austin&pets_allowed=true&laundry_in_unit=true
```

### Search: Budget Rentals Accepting Vouchers

```bash
GET /api/listings/search?property_type=Residential Lease&status=active&max_price=1500&housing_vouchers=true&max_security_deposit=1000
```

### Search: Short-Term Rentals (6 Months or Less)

```bash
GET /api/listings/search?property_type=Residential Lease&status=active&max_lease_months=6
```

### Search: 2+ Bed Apartments Under $2000

```bash
GET /api/listings/search?property_type=Residential Lease&property_sub_type=Apartment&min_bedrooms=2&max_price=2000&status=active
```

### Search: Rentals with Map Pins

```bash
GET /api/listings/search?property_type=Residential Lease&status=active&city=austin&include_map_pins=true
```

### Detail: Single Rental Listing

```bash
GET /api/listings?listing_id=8234567
```

The response includes the full `rental_details` object when the listing is a lease.

---

## Conditional Rendering Pattern

Since `rental_details` is `null` for non-lease listings, use a simple null check:

```typescript
// In search results
const isRental = listing.rental_details !== null;

// In detail page
const isRental = listing.rental_details !== null;

// Or check property_type
const isRental = listing.property_type?.toLowerCase().includes('lease');
```

Both approaches work — `rental_details` being non-null is the most reliable indicator.

---

**Last Updated**: March 2026
