import { buildServer } from './server.js';
import { env } from './config/env.js';

async function start() {
  const app = buildServer();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 MLS API v2 running on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
