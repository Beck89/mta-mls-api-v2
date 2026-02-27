/**
 * Database migration script for API-owned tables.
 * Creates: neighborhoods, search_suggestions, trigram indexes.
 * Safe to run multiple times (uses IF NOT EXISTS).
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

  // ─── Neighborhoods table ─────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS neighborhoods (
      id SERIAL PRIMARY KEY,
      name VARCHAR NOT NULL,
      slug VARCHAR NOT NULL,
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
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS neighborhoods_slug_unique ON neighborhoods (slug)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neighborhoods_slug ON neighborhoods USING btree (slug)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neighborhoods_geom ON neighborhoods USING gist (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neighborhoods_name_trgm ON neighborhoods USING gin (name gin_trgm_ops)`;
  console.log('  ✓ neighborhoods table');

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
