/**
 * Refresh the search_suggestions table with current data.
 * 
 * Sources (in priority order):
 *   1. search_areas polygons (cities, counties, zipcodes, neighborhoods) — polygon-backed
 *   2. Property field values — text-based fallback for cities/zips with no polygon data
 *   3. Subdivisions — from property fields (no polygon data)
 *   4. Addresses — individual active listings
 * 
 * The polygon-first approach ensures:
 *   - Areas with polygon data get accurate spatial filtering in search
 *   - Areas without polygon data still appear in typeahead if they have listings
 * 
 * Usage: npx tsx src/db/refresh-suggestions.ts
 * Can also be called programmatically or on a cron schedule.
 */

import postgres from 'postgres';
import { env } from '../config/env.js';

const sql = postgres(env.DATABASE_URL, { max: 1 });

export async function refreshSuggestions(client?: ReturnType<typeof postgres>) {
  const db = client || sql;
  console.log('🔄 Refreshing search suggestions...');

  // Clear existing suggestions
  await db`TRUNCATE search_suggestions RESTART IDENTITY`;

  // ─── Neighborhoods (polygon-backed) ──────────────────────────────────────
  // Priority 9 — from search_areas WHERE type = 'neighborhood'
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      name AS label,
      'neighborhood' AS type,
      slug AS search_value,
      centroid_lat::numeric AS latitude,
      centroid_lng::numeric AS longitude,
      listing_count,
      9 AS priority
    FROM search_areas
    WHERE type = 'neighborhood'
      AND listing_count > 0
      AND name IS NOT NULL
      AND name != ''
    ORDER BY listing_count DESC
  `;
  const nhoodCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'neighborhood'`;
  console.log(`  ✓ ${nhoodCount[0].cnt} neighborhoods (polygon-backed)`);

  // ─── Cities — Step 1: Polygon-backed ─────────────────────────────────────
  // Priority 10 — from search_areas WHERE type = 'city'
  // search_value = slug (used for ST_Within polygon lookup in search route)
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      name || ', TX' AS label,
      'city' AS type,
      slug AS search_value,
      centroid_lat::numeric AS latitude,
      centroid_lng::numeric AS longitude,
      listing_count,
      10 AS priority
    FROM search_areas
    WHERE type = 'city'
      AND listing_count > 0
      AND name IS NOT NULL
      AND name != ''
    ORDER BY listing_count DESC
  `;
  const cityPolygonCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'city'`;
  console.log(`  ✓ ${cityPolygonCount[0].cnt} cities (polygon-backed)`);

  // ─── Cities — Step 2: Text fallback ──────────────────────────────────────
  // For cities that have listings but no polygon in search_areas.
  // search_value = raw city name (used for LOWER(p.city) = LOWER(value) in search route)
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      INITCAP(p.city) || ', ' || COALESCE(p.state_or_province, 'TX') AS label,
      'city' AS type,
      p.city AS search_value,
      AVG(p.latitude::numeric) AS latitude,
      AVG(p.longitude::numeric) AS longitude,
      COUNT(*)::int AS listing_count,
      10 AS priority
    FROM properties p
    WHERE p.mlg_can_view = true
      AND p.standard_status IN ('Active', 'Active Under Contract', 'Pending')
      AND p.city IS NOT NULL
      AND p.city != ''
      -- Exclude cities already covered by a polygon-backed suggestion
      -- Match by comparing the city name against existing polygon-backed labels
      AND NOT EXISTS (
        SELECT 1 FROM search_suggestions ss
        WHERE ss.type = 'city'
          AND LOWER(ss.label) LIKE LOWER(p.city) || '%'
      )
    GROUP BY p.city, p.state_or_province
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
  `;
  const cityTotalCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'city'`;
  const cityFallbackCount = parseInt(cityTotalCount[0].cnt) - parseInt(cityPolygonCount[0].cnt);
  console.log(`  ✓ ${cityFallbackCount} cities (text fallback — no polygon data)`);
  console.log(`  ✓ ${cityTotalCount[0].cnt} cities total`);

  // ─── Counties (polygon-backed only) ──────────────────────────────────────
  // Priority 7 — from search_areas WHERE type = 'county'
  // Counties are new; no text fallback needed (not previously in typeahead)
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      name || ' County, TX' AS label,
      'county' AS type,
      slug AS search_value,
      centroid_lat::numeric AS latitude,
      centroid_lng::numeric AS longitude,
      listing_count,
      7 AS priority
    FROM search_areas
    WHERE type = 'county'
      AND listing_count > 0
      AND name IS NOT NULL
      AND name != ''
    ORDER BY listing_count DESC
  `;
  const countyCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'county'`;
  console.log(`  ✓ ${countyCount[0].cnt} counties (polygon-backed)`);

  // ─── ZIP Codes — Step 1: Polygon-backed ──────────────────────────────────
  // Priority 8 — from search_areas WHERE type = 'zipcode'
  // search_value = slug (used for ST_Within polygon lookup in search route)
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      name AS label,
      'zip' AS type,
      slug AS search_value,
      centroid_lat::numeric AS latitude,
      centroid_lng::numeric AS longitude,
      listing_count,
      8 AS priority
    FROM search_areas
    WHERE type = 'zipcode'
      AND listing_count > 0
      AND name IS NOT NULL
      AND name != ''
    ORDER BY listing_count DESC
  `;
  const zipPolygonCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'zip'`;
  console.log(`  ✓ ${zipPolygonCount[0].cnt} ZIP codes (polygon-backed)`);

  // ─── ZIP Codes — Step 2: Text fallback ───────────────────────────────────
  // For ZIP codes that have listings but no polygon in search_areas.
  // search_value = raw postal_code (used for p.postal_code = value in search route)
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      p.postal_code || ' - ' || COALESCE(INITCAP(MIN(p.city)), '') || ', ' || COALESCE(MIN(p.state_or_province), 'TX') AS label,
      'zip' AS type,
      p.postal_code AS search_value,
      AVG(p.latitude::numeric) AS latitude,
      AVG(p.longitude::numeric) AS longitude,
      COUNT(*)::int AS listing_count,
      8 AS priority
    FROM properties p
    WHERE p.mlg_can_view = true
      AND p.standard_status IN ('Active', 'Active Under Contract', 'Pending')
      AND p.postal_code IS NOT NULL
      AND p.postal_code != ''
      -- Exclude ZIP codes already covered by a polygon-backed suggestion
      AND NOT EXISTS (
        SELECT 1 FROM search_suggestions ss
        WHERE ss.type = 'zip'
          AND ss.label LIKE p.postal_code || '%'
      )
    GROUP BY p.postal_code
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
  `;
  const zipTotalCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'zip'`;
  const zipFallbackCount = parseInt(zipTotalCount[0].cnt) - parseInt(zipPolygonCount[0].cnt);
  console.log(`  ✓ ${zipFallbackCount} ZIP codes (text fallback — no polygon data)`);
  console.log(`  ✓ ${zipTotalCount[0].cnt} ZIP codes total`);

  // ─── Subdivisions ─────────────────────────────────────────────────────────
  // Priority 6 — text-based from property fields (no polygon data)
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      subdivision_name || ', ' || COALESCE(INITCAP(MIN(city)), '') AS label,
      'subdivision' AS type,
      subdivision_name AS search_value,
      AVG(latitude::numeric) AS latitude,
      AVG(longitude::numeric) AS longitude,
      COUNT(*)::int AS listing_count,
      6 AS priority
    FROM properties
    WHERE mlg_can_view = true
      AND standard_status IN ('Active', 'Active Under Contract', 'Pending')
      AND subdivision_name IS NOT NULL
      AND subdivision_name != ''
    GROUP BY subdivision_name
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
  `;
  const subCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'subdivision'`;
  console.log(`  ✓ ${subCount[0].cnt} subdivisions`);

  // ─── Addresses (active listings only) ─────────────────────────────────────
  // Priority 4 — individual listing addresses
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      COALESCE(unparsed_address, '') || ', ' || COALESCE(INITCAP(city), '') || ', ' || COALESCE(state_or_province, 'TX') || ' ' || COALESCE(postal_code, '') AS label,
      'address' AS type,
      listing_key AS search_value,
      latitude::numeric AS latitude,
      longitude::numeric AS longitude,
      1 AS listing_count,
      4 AS priority
    FROM properties
    WHERE mlg_can_view = true
      AND 'IDX' = ANY(mlg_can_use)
      AND standard_status IN ('Active', 'Active Under Contract', 'Pending')
      AND unparsed_address IS NOT NULL
      AND unparsed_address != ''
      AND city IS NOT NULL
    ORDER BY original_entry_ts DESC NULLS LAST
  `;
  const addrCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'address'`;
  console.log(`  ✓ ${addrCount[0].cnt} addresses`);

  const totalCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions`;
  console.log(`\n✅ Total suggestions: ${totalCount[0].cnt}`);

  if (!client) {
    await sql.end();
  }
}

// Run directly if called as script
if (process.argv[1]?.includes('refresh-suggestions')) {
  refreshSuggestions().catch((err) => {
    console.error('❌ Refresh failed:', err);
    process.exit(1);
  });
}
