import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import * as schema from './schema.js';

// Connection pool for queries (read-heavy)
// The prepare: false option is not needed — postgres.js uses prepared statements
// which are faster for repeated queries like typeahead.
const queryClient = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  // Set pg_trgm thresholds on every new connection so the % and <%> operators
  // use our desired similarity cutoffs (default is 0.3 which is too strict).
  onnotice: () => {}, // suppress NOTICE messages
  connection: {
    'pg_trgm.similarity_threshold': '0.1',
    'pg_trgm.word_similarity_threshold': '0.2',
  },
});

export const db = drizzle(queryClient, { schema });

// Raw SQL client for PostGIS queries that Drizzle can't express
export const sql = queryClient;

export type Database = typeof db;
