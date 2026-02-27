/**
 * Refresh the search_suggestions table with current data.
 * Sources: addresses, cities, ZIP codes, subdivisions, neighborhoods.
 * Usage: npx tsx src/db/refresh-suggestions.ts
 * 
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

  // ─── Cities ────────────────────────────────────────────────────────────
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      INITCAP(city) || ', ' || COALESCE(state_or_province, 'TX') AS label,
      'city' AS type,
      city AS search_value,
      AVG(latitude::numeric) AS latitude,
      AVG(longitude::numeric) AS longitude,
      COUNT(*) AS listing_count,
      10 AS priority
    FROM properties
    WHERE mlg_can_view = true
      AND standard_status IN ('Active', 'Active Under Contract', 'Pending')
      AND city IS NOT NULL
      AND city != ''
    GROUP BY city, state_or_province
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
  `;
  const cityCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'city'`;
  console.log(`  ✓ ${cityCount[0].cnt} cities`);

  // ─── ZIP Codes ─────────────────────────────────────────────────────────
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      postal_code || ' - ' || COALESCE(INITCAP(MIN(city)), '') || ', ' || COALESCE(MIN(state_or_province), 'TX') AS label,
      'zip' AS type,
      postal_code AS search_value,
      AVG(latitude::numeric) AS latitude,
      AVG(longitude::numeric) AS longitude,
      COUNT(*) AS listing_count,
      8 AS priority
    FROM properties
    WHERE mlg_can_view = true
      AND standard_status IN ('Active', 'Active Under Contract', 'Pending')
      AND postal_code IS NOT NULL
      AND postal_code != ''
    GROUP BY postal_code
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
  `;
  const zipCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'zip'`;
  console.log(`  ✓ ${zipCount[0].cnt} ZIP codes`);

  // ─── Subdivisions ─────────────────────────────────────────────────────
  await db`
    INSERT INTO search_suggestions (label, type, search_value, latitude, longitude, listing_count, priority)
    SELECT 
      subdivision_name || ', ' || COALESCE(INITCAP(MIN(city)), '') AS label,
      'subdivision' AS type,
      subdivision_name AS search_value,
      AVG(latitude::numeric) AS latitude,
      AVG(longitude::numeric) AS longitude,
      COUNT(*) AS listing_count,
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

  // ─── Neighborhoods ────────────────────────────────────────────────────
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
    FROM neighborhoods
    WHERE listing_count > 0
      AND name IS NOT NULL
      AND name != ''
    ORDER BY listing_count DESC
  `;
  const nhoodCount = await db`SELECT COUNT(*) as cnt FROM search_suggestions WHERE type = 'neighborhood'`;
  console.log(`  ✓ ${nhoodCount[0].cnt} neighborhoods`);

  // ─── Addresses (active listings only) ─────────────────────────────────
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
  console.log(`✅ Total suggestions: ${totalCount[0].cnt}`);

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
