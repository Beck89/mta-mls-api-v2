import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import sensible from '@fastify/sensible';
import { env } from './config/env.js';
import { searchRoutes } from './routes/search.js';
import { detailRoutes } from './routes/detail.js';
import { similarRoutes } from './routes/similar.js';
import { suggestRoutes } from './routes/suggest.js';
import { statsRoutes } from './routes/stats.js';
import { healthRoutes } from './routes/health.js';
import { neighborhoodRoutes } from './routes/neighborhoods.js';

export function buildServer() {
  const app = Fastify({
    logger: env.NODE_ENV === 'production'
      ? { level: env.LOG_LEVEL }
      : {
          level: env.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true },
          },
        },
  });

  // ─── Plugins ─────────────────────────────────────────────────────────
  app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.register(sensible);

  // Response compression (gzip/brotli) — reduces map_pins payload ~75%
  app.register(compress, { global: true });

  // ─── API Key Authentication ──────────────────────────────────────────
  // All routes except /health require a valid API key via x-api-key header
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for health check (used by load balancers)
    if (request.url === '/health') return;

    const apiKey = request.headers['x-api-key'];
    if (!apiKey || apiKey !== env.API_KEY) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing API key. Provide a valid x-api-key header.',
        },
      });
    }
  });

  // ─── Routes ──────────────────────────────────────────────────────────
  app.register(searchRoutes, { prefix: '/api/listings' });
  app.register(detailRoutes, { prefix: '/api/listings' });
  app.register(similarRoutes, { prefix: '/api/listings' });
  app.register(suggestRoutes, { prefix: '/api' });
  app.register(statsRoutes, { prefix: '/api' });
  app.register(healthRoutes);
  app.register(neighborhoodRoutes, { prefix: '/api' });

  return app;
}
