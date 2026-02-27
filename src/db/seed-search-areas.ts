/**
 * Seed script to load geographic polygon data from GeoJSON into the search_areas table.
 * Supports cities, counties, zipcodes, and neighborhoods — all from a single file.
 * 
 * Usage: npx tsx src/db/seed-search-areas.ts
 * 
 * The GeoJSON file must have features with properties:
 *   - name: string
 *   - search_type: 'city' | 'county' | 'zipcode' | 'neighborhood'
 *   - area_sq_miles: number (optional)
 *   - source: string (optional)
 */

import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { env } from '../config/env.js';

const sql = postgres(env.DATABASE_URL, { max: 1 });

const VALID_TYPES = ['city', 'county', 'zipcode', 'neighborhood'] as const;
type AreaType = typeof VALID_TYPES[number];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    name: string;
    search_type: string;
    place_type?: string;
    area_sq_miles?: number;
    sq_miles?: number;
    source?: string;
    fid?: number;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][][] | number[][][];
  };
}

interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function seed() {
  const geojsonPath = path.resolve(process.cwd(), 'data/central-texas-search-index.geojson');

  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found at:', geojsonPath);
    process.exit(1);
  }

  const data: GeoJSONCollection = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  console.log(`🔄 Loading ${data.features.length} geographic areas...`);

  // Clear all existing data — the new file is the single source of truth
  console.log('🗑️  Clearing existing search_areas data...');
  await sql`DELETE FROM search_areas`;
  console.log('  ✓ Cleared');

  // Group by type for reporting
  const typeCounts: Record<string, number> = {};

  // Track skipped features
  let skipped = 0;
  let loaded = 0;

  for (const feature of data.features) {
    const name = feature.properties.name || 'Unknown';
    const rawType = feature.properties.search_type || feature.properties.place_type || '';
    const areaType = rawType.toLowerCase() as AreaType;

    // Validate type
    if (!VALID_TYPES.includes(areaType)) {
      console.warn(`  ⚠️  Skipping "${name}" — unknown search_type: "${rawType}"`);
      skipped++;
      continue;
    }

    const sqMiles = feature.properties.area_sq_miles ?? feature.properties.sq_miles ?? null;
    const source = feature.properties.source ?? null;
    const slug = slugify(name);

    // Normalize Polygon → MultiPolygon for consistency
    let geometry: { type: string; coordinates: any } = feature.geometry;
    if (geometry.type === 'Polygon') {
      geometry = {
        type: 'MultiPolygon',
        coordinates: [geometry.coordinates],
      };
    }

    const geojsonStr = JSON.stringify(geometry);

    await sql`
      INSERT INTO search_areas (name, slug, type, source, sq_miles, geom, centroid_lat, centroid_lng)
      VALUES (
        ${name},
        ${slug},
        ${areaType},
        ${source},
        ${sqMiles},
        ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326),
        ST_Y(ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326))),
        ST_X(ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)))
      )
      ON CONFLICT (type, slug) DO UPDATE SET
        name = EXCLUDED.name,
        source = EXCLUDED.source,
        sq_miles = EXCLUDED.sq_miles,
        geom = EXCLUDED.geom,
        centroid_lat = EXCLUDED.centroid_lat,
        centroid_lng = EXCLUDED.centroid_lng,
        updated_at = NOW()
    `;

    loaded++;
    typeCounts[areaType] = (typeCounts[areaType] || 0) + 1;

    if (loaded % 50 === 0) {
      console.log(`  ... loaded ${loaded}/${data.features.length}`);
    }
  }

  console.log(`\n📊 Loaded by type:`);
  for (const [type, count] of Object.entries(typeCounts).sort()) {
    console.log(`  ${type}: ${count}`);
  }
  if (skipped > 0) {
    console.log(`  ⚠️  Skipped: ${skipped}`);
  }

  // Update listing counts for all areas using spatial intersection
  console.log('\n🔄 Updating listing counts (spatial ST_Within queries)...');
  console.log('  This may take a few minutes for large datasets...');

  await sql`
    UPDATE search_areas sa SET listing_count = (
      SELECT COUNT(*)
      FROM properties p
      WHERE p.mlg_can_view = true
        AND p.standard_status IN ('Active', 'Active Under Contract')
        AND ST_Within(p.geog::geometry, sa.geom)
    )
  `;

  // Show summary by type
  const summary = await sql`
    SELECT type, COUNT(*) as total_areas, SUM(listing_count) as total_listings,
           COUNT(*) FILTER (WHERE listing_count > 0) as areas_with_listings
    FROM search_areas
    GROUP BY type
    ORDER BY type
  `;

  console.log('\n📊 Summary by type:');
  for (const row of summary) {
    console.log(`  ${row.type}: ${row.total_areas} areas, ${row.areas_with_listings} with listings, ${row.total_listings} total listings`);
  }

  // Show top areas by listing count
  const topAreas = await sql`
    SELECT name, type, slug, listing_count
    FROM search_areas
    WHERE listing_count > 0
    ORDER BY listing_count DESC
    LIMIT 15
  `;

  console.log('\n🏆 Top 15 areas by listing count:');
  for (const area of topAreas) {
    console.log(`  [${area.type}] ${area.name} (${area.slug}): ${area.listing_count} listings`);
  }

  console.log(`\n✅ Done! Loaded ${loaded} areas total.`);

  await sql.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
