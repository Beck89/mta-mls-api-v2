import { buildServer } from './server.js';
import { env } from './config/env.js';
import { startScheduler, stopScheduler } from './scheduler.js';

async function start() {
  const app = buildServer();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 MLS API v2 running on http://${env.HOST}:${env.PORT}`);

    // Start background scheduler (refresh-suggestions every 6 hours)
    startScheduler(app.log);

    // Graceful shutdown — stop scheduler before process exits
    const shutdown = async (signal: string) => {
      app.log.info(`Received ${signal}, shutting down...`);
      stopScheduler();
      await app.close();
      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
