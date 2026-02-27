/**
 * GET /health
 * 
 * Simple health check for load balancers and monitoring.
 * Verifies database connectivity.
 */

import { FastifyInstance } from 'fastify';
import { sql } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (request, reply) => {
    try {
      // Verify database connection
      const result = await sql`SELECT 1 as ok`;
      
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: result[0]?.ok === 1 ? 'connected' : 'error',
      };
    } catch (err: any) {
      return reply.status(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: err.message,
      });
    }
  });
}
