/**
 * GET /api/neighborhoods - List all neighborhoods
 * GET /api/neighborhoods/:slug - Get neighborhood detail with polygon
 * 
 * Provides neighborhood data for map overlays and search filters.
 */

import { FastifyInstance } from 'fastify';
import { sql } from '../db/index.js';

export async function neighborhoodRoutes(app: FastifyInstance) {
  // List all neighborhoods (lightweight, no polygon geometry)
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
        FROM neighborhoods
        ORDER BY name ASC
      `;

      return {
        neighborhoods: results.map((n: any) => ({
          id: n.id,
          name: n.name,
          slug: n.slug,
          source: n.source,
          sq_miles: parseFloat(n.sq_miles) || null,
          center: {
            lat: parseFloat(n.centroid_lat) || null,
            lng: parseFloat(n.centroid_lng) || null,
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

  // Get single neighborhood with GeoJSON polygon
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
        FROM neighborhoods
        WHERE slug = ${slug}
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
          sq_miles: parseFloat(n.sq_miles) || null,
          center: {
            lat: parseFloat(n.centroid_lat) || null,
            lng: parseFloat(n.centroid_lng) || null,
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
