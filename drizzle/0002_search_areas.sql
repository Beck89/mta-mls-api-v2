-- Migration: Rename neighborhoods → search_areas, add type column
-- This generalizes the neighborhoods table to support cities, counties, zipcodes, and neighborhoods

-- Rename the table
ALTER TABLE neighborhoods RENAME TO search_areas;

-- Add type column (default 'neighborhood' for existing rows)
ALTER TABLE search_areas ADD COLUMN type VARCHAR NOT NULL DEFAULT 'neighborhood';

-- Drop the old unique constraint on slug alone
ALTER TABLE search_areas DROP CONSTRAINT IF EXISTS neighborhoods_slug_unique;

-- Add composite unique constraint: slug must be unique per type
-- (allows "Austin" city and "Austin" county to coexist)
ALTER TABLE search_areas ADD CONSTRAINT search_areas_type_slug_unique UNIQUE (type, slug);

-- Rename the slug index
DROP INDEX IF EXISTS idx_neighborhoods_slug;
CREATE INDEX idx_search_areas_slug ON search_areas (slug);

-- Add index on type for filtered queries
CREATE INDEX idx_search_areas_type ON search_areas (type);

-- Add composite index for the most common query pattern
CREATE INDEX idx_search_areas_type_listing_count ON search_areas (type, listing_count DESC);
