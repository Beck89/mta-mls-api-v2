/**
 * Seed script to load neighborhood polygon data from GeoJSON into the database.
 * Usage: npx tsx src/db/seed-neighborhoods.ts
 */

import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { env } from '../config/env.js';

const sql = postgres(env.DATABASE_URL, { max: 1 });

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
    fid: number;
    sq_miles: number;
    source: string;
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
  const geojsonPath = path.resolve(process.cwd(), 'data/final-v1.geojson');
  
  if (!fs.existsSync(geojsonPath)) {
    console.error('❌ GeoJSON file not found at:', geojsonPath);
    process.exit(1);
  }

  const data: GeoJSONCollection = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  console.log(`🔄 Loading ${data.features.length} neighborhoods...`);

  // Clear existing neighborhoods
  await sql`DELETE FROM neighborhoods`;

  let loaded = 0;
  for (const feature of data.features) {
    const name = feature.properties.name || 'Unknown';
    const sqMiles = feature.properties.sq_miles != null ? feature.properties.sq_miles : null;
    const source = feature.properties.source != null ? feature.properties.source : null;
    const slug = slugify(name);

    // Normalize Polygon to MultiPolygon for consistency
    let geometry: { type: string; coordinates: any } = feature.geometry;
    if (geometry.type === 'Polygon') {
      geometry = {
        type: 'MultiPolygon',
        coordinates: [geometry.coordinates],
      };
    }

    const geojsonStr = JSON.stringify(geometry);

    await sql`
      INSERT INTO neighborhoods (name, slug, source, sq_miles, geom, centroid_lat, centroid_lng)
      VALUES (
        ${name},
        ${slug},
        ${source},
        ${sqMiles},
        ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326),
        ST_Y(ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326))),
        ST_X(ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)))
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        source = EXCLUDED.source,
        sq_miles = EXCLUDED.sq_miles,
        geom = EXCLUDED.geom,
        centroid_lat = EXCLUDED.centroid_lat,
        centroid_lng = EXCLUDED.centroid_lng,
        updated_at = NOW()
    `;
    loaded++;
    if (loaded % 20 === 0) {
      console.log(`  ... loaded ${loaded}/${data.features.length}`);
    }
  }

  // Update listing counts for each neighborhood
  console.log('🔄 Updating listing counts...');
  await sql`
    UPDATE neighborhoods n SET listing_count = (
      SELECT COUNT(*)
      FROM properties p
      WHERE p.mlg_can_view = true
        AND p.standard_status IN ('Active', 'Active Under Contract')
        AND ST_Within(p.geog::geometry, n.geom)
    )
  `;

  console.log(`✅ Loaded ${loaded} neighborhoods with listing counts`);

  // Show summary
  const summary = await sql`
    SELECT name, slug, listing_count, centroid_lat, centroid_lng 
    FROM neighborhoods 
    ORDER BY listing_count DESC 
    LIMIT 10
  `;
  console.log('\nTop 10 neighborhoods by listing count:');
  summary.forEach((n: any) => {
    console.log(`  ${n.name} (${n.slug}): ${n.listing_count} listings`);
  });

  await sql.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
