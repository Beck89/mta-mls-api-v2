-- Search Performance Indexes
-- These indexes optimize the most common search query patterns.
-- Run manually or via migration runner.

-- #2: Partial index for IDX-viewable listings
-- Pre-filters mlg_can_view=true AND 'IDX'=ANY(mlg_can_use) so the planner
-- skips these checks entirely. Covers the most common search: status + price.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_active_idx
  ON properties (standard_status, list_price)
  WHERE mlg_can_view = true AND 'IDX' = ANY(mlg_can_use);

-- #5: Composite index for default sort (list_date → original_entry_ts DESC)
-- Avoids in-memory sort for the most common sort order.
-- Partial index only includes IDX-viewable listings.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_status_entry_ts
  ON properties (standard_status, original_entry_ts DESC NULLS LAST)
  WHERE mlg_can_view = true AND 'IDX' = ANY(mlg_can_use);

-- #7: Functional index for LOWER(city)
-- The search handler uses LOWER(p.city) = LOWER(...) which defeats the
-- existing btree index on city. This index supports case-insensitive lookups.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_city_lower
  ON properties (LOWER(city));

-- #9: Covering index for photo lookups (lateral join)
-- Supports the LATERAL subquery that fetches first 3 photos per listing.
-- Partial index only includes complete photos with public URLs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_listing_photos
  ON media (listing_key, media_order ASC NULLS LAST)
  INCLUDE (public_url)
  WHERE status = 'complete' AND public_url IS NOT NULL;
