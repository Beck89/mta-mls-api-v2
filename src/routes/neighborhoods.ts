/**
 * Geographic area routes — polygon boundaries for search and map overlays.
 * 
 * GET /api/areas                    - List all areas (filterable by type)
 * GET /api/areas/:type/:slug        - Get single area with GeoJSON polygon
 * 
 * Backward-compatible aliases:
 * GET /api/neighborhoods            - List neighborhoods (type=neighborhood)
 * GET /api/neighborhoods/:slug      - Get single neighborhood with GeoJSON polygon
 * 
 * Supported types: city | county | zipcode | neighborhood | school_district
 */

import { FastifyInstance } from 'fastify';
import { sql } from '../db/index.js';

const VALID_TYPES = ['city', 'county', 'zipcode', 'neighborhood', 'school_district'] as const;
type AreaType = typeof VALID_TYPES[number];

function isValidType(t: string): t is AreaType {
  return VALID_TYPES.includes(t as AreaType);
}

export async function neighborhoodRoutes(app: FastifyInstance) {

  // ─── GET /api/areas ────────────────────────────────────────────────────────
  // List all areas, optionally filtered by type. Lightweight — no polygon geometry.
  app.get('/areas', async (request, reply) => {
    const { type, min_listings } = request.query as {
      type?: string;
      min_listings?: string;
    };

    const minListings = min_listings ? parseInt(min_listings, 10) : 0;

    try {
      let results;

      if (type) {
        if (!isValidType(type)) {
          return reply.status(400).send({
            error: `Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`,
          });
        }
        results = await sql`
          SELECT 
            id,
            name,
            slug,
            type,
            source,
            sq_miles,
            centroid_lat,
            centroid_lng,
            listing_count
          FROM search_areas
          WHERE type = ${type}
            AND listing_count >= ${minListings}
          ORDER BY listing_count DESC, name ASC
        `;
      } else {
        results = await sql`
          SELECT 
            id,
            name,
            slug,
            type,
            source,
            sq_miles,
            centroid_lat,
            centroid_lng,
            listing_count
          FROM search_areas
          WHERE listing_count >= ${minListings}
          ORDER BY type ASC, listing_count DESC, name ASC
        `;
      }

      return {
        areas: results.map((a: any) => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
          type: a.type,
          source: a.source,
          sq_miles: a.sq_miles ? parseFloat(a.sq_miles) : null,
          center: {
            lat: a.centroid_lat ? parseFloat(a.centroid_lat) : null,
            lng: a.centroid_lng ? parseFloat(a.centroid_lng) : null,
          },
          listing_count: a.listing_count,
        })),
        total: results.length,
      };
    } catch (err: any) {
      request.log.error(err, 'Areas list error');
      return reply.status(500).send({
        error: 'An error occurred while fetching areas',
      });
    }
  });

  // ─── GET /api/areas/:type/:slug ────────────────────────────────────────────
  // Get a single area with its GeoJSON polygon geometry.
  app.get('/areas/:type/:slug', async (request, reply) => {
    const { type, slug } = request.params as { type: string; slug: string };

    if (!isValidType(type)) {
      return reply.status(400).send({
        error: `Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    try {
      const results = await sql`
        SELECT 
          id,
          name,
          slug,
          type,
          source,
          sq_miles,
          centroid_lat,
          centroid_lng,
          listing_count,
          ST_AsGeoJSON(geom)::json as geojson
        FROM search_areas
        WHERE type = ${type}
          AND slug = ${slug}
        LIMIT 1
      `;

      if (results.length === 0) {
        return reply.status(404).send({ error: `${type} "${slug}" not found` });
      }

      const a = results[0];

      return {
        area: {
          id: a.id,
          name: a.name,
          slug: a.slug,
          type: a.type,
          source: a.source,
          sq_miles: a.sq_miles ? parseFloat(a.sq_miles) : null,
          center: {
            lat: a.centroid_lat ? parseFloat(a.centroid_lat) : null,
            lng: a.centroid_lng ? parseFloat(a.centroid_lng) : null,
          },
          listing_count: a.listing_count,
          geometry: a.geojson,
        },
      };
    } catch (err: any) {
      request.log.error(err, 'Area detail error');
      return reply.status(500).send({
        error: 'An error occurred while fetching area details',
      });
    }
  });

  // ─── GET /api/neighborhoods (backward-compatible alias) ────────────────────
  // Lists only neighborhoods. Equivalent to GET /api/areas?type=neighborhood
  app.get('/neighborhoods', async (request, reply) => {
    try {
      const results = await sql`
        SELECT 
          id,
          name,
          slug,
          source,
          sq_miles,
          centroid_lat,
          centroid_lng,
          listing_count
        FROM search_areas
        WHERE type = 'neighborhood'
        ORDER BY name ASC
      `;

      return {
        neighborhoods: results.map((n: any) => ({
          id: n.id,
          name: n.name,
          slug: n.slug,
          source: n.source,
          sq_miles: n.sq_miles ? parseFloat(n.sq_miles) : null,
          center: {
            lat: n.centroid_lat ? parseFloat(n.centroid_lat) : null,
            lng: n.centroid_lng ? parseFloat(n.centroid_lng) : null,
          },
          listing_count: n.listing_count,
        })),
        total: results.length,
      };
    } catch (err: any) {
      request.log.error(err, 'Neighborhoods list error');
      return reply.status(500).send({
        error: 'An error occurred while fetching neighborhoods',
      });
    }
  });

  // ─── GET /api/neighborhoods/:slug (backward-compatible alias) ──────────────
  // Get a single neighborhood with GeoJSON polygon. Equivalent to GET /api/areas/neighborhood/:slug
  app.get('/neighborhoods/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      const results = await sql`
        SELECT 
          id,
          name,
          slug,
          source,
          sq_miles,
          centroid_lat,
          centroid_lng,
          listing_count,
          ST_AsGeoJSON(geom)::json as geojson
        FROM search_areas
        WHERE type = 'neighborhood'
          AND slug = ${slug}
        LIMIT 1
      `;

      if (results.length === 0) {
        return reply.status(404).send({ error: 'Neighborhood not found' });
      }

      const n = results[0];

      return {
        neighborhood: {
          id: n.id,
          name: n.name,
          slug: n.slug,
          source: n.source,
          sq_miles: n.sq_miles ? parseFloat(n.sq_miles) : null,
          center: {
            lat: n.centroid_lat ? parseFloat(n.centroid_lat) : null,
            lng: n.centroid_lng ? parseFloat(n.centroid_lng) : null,
          },
          listing_count: n.listing_count,
          geometry: n.geojson,
        },
      };
    } catch (err: any) {
      request.log.error(err, 'Neighborhood detail error');
      return reply.status(500).send({
        error: 'An error occurred while fetching neighborhood details',
      });
    }
  });
}
