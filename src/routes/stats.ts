/**
 * GET /api/stats
 * 
 * Public listing statistics: homes for sale, homes for rent,
 * new listings in last 30 days.
 */

import { FastifyInstance } from 'fastify';
import { sql } from '../db/index.js';

export async function statsRoutes(app: FastifyInstance) {
  app.get('/stats', async (request, reply) => {
    try {
      const [forSale, forRent, newListings] = await Promise.all([
        sql`
          SELECT COUNT(*) as cnt FROM properties
          WHERE mlg_can_view = true
            AND 'IDX' = ANY(mlg_can_use)
            AND standard_status = 'Active'
            AND property_type = 'Residential'
        `,
        sql`
          SELECT COUNT(*) as cnt FROM properties
          WHERE mlg_can_view = true
            AND 'IDX' = ANY(mlg_can_use)
            AND standard_status = 'Active'
            AND property_type = 'Residential Lease'
        `,
        sql`
          SELECT COUNT(*) as cnt FROM properties
          WHERE mlg_can_view = true
            AND 'IDX' = ANY(mlg_can_use)
            AND standard_status = 'Active'
            AND original_entry_ts >= NOW() - INTERVAL '30 days'
        `,
      ]);

      return {
        homes_for_sale: parseInt(forSale[0].cnt, 10),
        homes_for_rent: parseInt(forRent[0].cnt, 10),
        new_listings_30_days: parseInt(newListings[0].cnt, 10),
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      request.log.error(err, 'Stats error');
      return reply.status(500).send({
        error: 'An error occurred while fetching statistics',
      });
    }
  });
}
