/**
 * Database migration script for API-owned tables.
 * Creates: search_areas, search_suggestions, trigram indexes.
 * Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Also handles migration from the old `neighborhoods` table if it exists.
 */

import postgres from 'postgres';
import { env } from '../config/env.js';

const sql = postgres(env.DATABASE_URL, { max: 1 });

async function migrate() {
  console.log('🔄 Running API server migrations...');

  // ─── Ensure extensions ───────────────────────────────────────────────
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  console.log('  ✓ Extensions verified (pg_trgm, postgis)');

  // ─── Step 1: Rename neighborhoods → search_areas if old table exists ─
  // Handles upgrading existing deployments that still have the old table name.
  const oldTableExists = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'neighborhoods'
    ) as exists
  `;
  if (oldTableExists[0].exists) {
    console.log('  ℹ️  Found old neighborhoods table — renaming to search_areas...');
    await sql`ALTER TABLE neighborhoods RENAME TO search_areas`;
    console.log('  ✓ Renamed neighborhoods → search_areas');
  }

  // ─── Step 2: Create search_areas if it doesn't exist yet ─────────────
  // Fresh installs: creates the table. Upgrades: no-op (table already exists).
  await sql`
    CREATE TABLE IF NOT EXISTS search_areas (
      id SERIAL PRIMARY KEY,
      name VARCHAR NOT NULL,
      slug VARCHAR NOT NULL,
      type VARCHAR NOT NULL DEFAULT 'neighborhood',
      source VARCHAR,
      sq_miles NUMERIC,
      geom GEOMETRY(MultiPolygon, 4326),
      centroid_lat NUMERIC,
      centroid_lng NUMERIC,
      listing_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // ─── Step 3: Ensure type column exists (upgrade path) ────────────────
  // No-op on fresh installs (column already in CREATE TABLE above).
  // Adds the column on upgrades from old neighborhoods table.
  await sql`ALTER TABLE search_areas ADD COLUMN IF NOT EXISTS type VARCHAR NOT NULL DEFAULT 'neighborhood'`;

  // ─── Step 4: Drop old neighborhoods constraints/indexes ───────────────
  // These linger when the table was renamed but constraints weren't cleaned up.
  // All DROP IF EXISTS — safe to run on fresh installs too.
  await sql`ALTER TABLE search_areas DROP CONSTRAINT IF EXISTS neighborhoods_slug_unique`;
  await sql`DROP INDEX IF EXISTS neighborhoods_slug_unique`;
  await sql`DROP INDEX IF EXISTS idx_neighborhoods_slug`;
  await sql`DROP INDEX IF EXISTS idx_neighborhoods_geom`;
  await sql`DROP INDEX IF EXISTS idx_neighborhoods_name_trgm`;

  // ─── Step 5: Add new search_areas constraints and indexes ────────────
  // Composite unique: slug must be unique per type (allows "Austin" city + "Austin" county)
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'search_areas_type_slug_unique'
      ) THEN
        ALTER TABLE search_areas ADD CONSTRAINT search_areas_type_slug_unique UNIQUE (type, slug);
      END IF;
    END $$
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_search_areas_slug ON search_areas USING btree (slug)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_search_areas_type ON search_areas USING btree (type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_search_areas_type_listing_count ON search_areas USING btree (type, listing_count DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_search_areas_geom ON search_areas USING gist (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_search_areas_name_trgm ON search_areas USING gin (name gin_trgm_ops)`;
  console.log('  ✓ search_areas table');

  // ─── Search Suggestions table ────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS search_suggestions (
      id SERIAL PRIMARY KEY,
      label VARCHAR NOT NULL,
      type VARCHAR NOT NULL,
      search_value VARCHAR,
      latitude NUMERIC,
      longitude NUMERIC,
      listing_count INTEGER,
      priority INTEGER DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_suggestions_type ON search_suggestions USING btree (type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_suggestions_label_trgm ON search_suggestions USING gin (label gin_trgm_ops)`;
  console.log('  ✓ search_suggestions table');

  // ─── Trigram indexes on properties for fast search ───────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_city_trgm ON properties USING gin (city gin_trgm_ops)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_subdivision_trgm ON properties USING gin (subdivision_name gin_trgm_ops)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_address_trgm ON properties USING gin (unparsed_address gin_trgm_ops)`;
  console.log('  ✓ Trigram indexes on properties');

  // ─── Composite indexes for common search patterns ────────────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_active_viewable ON properties (standard_status, mlg_can_view) WHERE mlg_can_view = true`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_bedrooms ON properties USING btree (bedrooms_total)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_bathrooms ON properties USING btree (bathrooms_total)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_year_built ON properties USING btree (year_built)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_living_area ON properties USING btree (living_area)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_properties_original_entry ON properties USING btree (original_entry_ts)`;
  console.log('  ✓ Additional property indexes');

  console.log('✅ All migrations complete');
  await sql.end();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
