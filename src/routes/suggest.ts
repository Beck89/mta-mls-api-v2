/**
 * GET /api/suggest
 * 
 * Typeahead/autocomplete suggestions using pg_trgm for fast fuzzy matching.
 * Searches across addresses, cities, ZIP codes, subdivisions, and neighborhoods.
 * Returns results grouped by type with category headers.
 *
 * Performance optimizations:
 *   - GIN gin_trgm_ops index on COALESCE(match_text, label) for operator-accelerated matching
 *   - UNION ALL structure to let each branch use the index independently
 *   - Per-type slot reservation ensures result diversity (cities don't get buried by subdivisions)
 *   - LRU in-memory cache (search_suggestions is a pre-materialized table)
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';

// ─── LRU Cache ───────────────────────────────────────────────────────────────
// search_suggestions is a materialized table that only changes on refresh,
// so caching is safe. TTL acts as a safety net in case refresh doesn't clear.

interface CacheEntry {
  data: any;
  ts: number;
}

const CACHE_MAX_SIZE = 2000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Map preserves insertion order — we evict from the front (oldest)
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): any | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // Move to end (most recently used)
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function cacheSet(key: string, data: any): void {
  // Evict oldest entries if at capacity
  if (cache.size >= CACHE_MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, ts: Date.now() });
}

/** Call after refreshSuggestions() to invalidate the cache */
export function clearSuggestCache(): void {
  cache.clear();
}

// ─── Per-type slot reservation ───────────────────────────────────────────────
// Guarantee each type gets at least RESERVED_PER_TYPE slots so that high-priority
// types (cities, neighborhoods) aren't buried by a flood of subdivisions/addresses.
const RESERVED_PER_TYPE = 3;

// ─── Address-like query detection ────────────────────────────────────────────
// Queries starting with a number + space (e.g. "210 Lavaca", "1500 S Congress")
// are almost certainly address searches. For these queries we suppress area-type
// results (cities, counties, subdivisions, etc.) that only matched via fuzzy
// trigram similarity — they must have an exact prefix or word-boundary match.
const ADDRESS_LIKE_RE = /^\d+\s/;

// ─── Route ───────────────────────────────────────────────────────────────────

const suggestQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
  types: z.string().optional(), // comma-separated: 'city,zip,subdivision,neighborhood,address,school_district,county'
});

export async function suggestRoutes(app: FastifyInstance) {
  app.get('/suggest', async (request, reply) => {
    const parseResult = suggestQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Query parameter "q" is required',
      });
    }

    const { q, limit, types } = parseResult.data;

    // ─── Cache lookup ──────────────────────────────────────────────────
    const cacheKey = `${q}|${limit}|${types ?? ''}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      reply.header('Cache-Control', 'public, max-age=60');
      return cached;
    }

    try {
      const typeList = types?.split(',').map(t => t.trim()).filter(Boolean);

      let results;

      // Numeric queries (ZIP codes like "78749") should use prefix-only matching,
      // not trigram fuzzy matching — otherwise "78749" also returns "78748", "78746", etc.
      const isNumericQuery = /^\d+$/.test(q);

      // Address-like queries ("210 Lavaca", "1500 S Congress") — suppress fuzzy
      // area-type matches so cities/counties/subdivisions don't pollute results.
      const isAddressQuery = ADDRESS_LIKE_RE.test(q);

      if (q.length < 3 || isNumericQuery) {
        // ─── Short query or ZIP code: prefix match with per-type diversity ─
        results = await sql`
          WITH raw_matches AS (
            SELECT
              id, label, match_text, type, search_value, search_param,
              has_polygon, latitude, longitude, listing_count, priority,
              1.0 as score
            FROM search_suggestions
            WHERE (
              COALESCE(match_text, label) ILIKE ${q + '%'}
              OR label ILIKE ${q + '%'}
            )
              ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}
          ),
          ranked AS (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY type
                ORDER BY
                  CASE WHEN COALESCE(match_text, label) ILIKE ${q + '%'} THEN 0 ELSE 1 END,
                  priority DESC,
                  listing_count DESC NULLS LAST
              ) as type_rank
            FROM raw_matches
          )
          -- Reserved slots first (top N per type), then fill remaining by overall relevance
          SELECT
            id, label, type, search_value, search_param,
            has_polygon, latitude, longitude, listing_count, priority,
            score, type_rank
          FROM ranked
          ORDER BY
            CASE WHEN type_rank <= ${RESERVED_PER_TYPE} THEN 0 ELSE 1 END,
            priority DESC,
            CASE WHEN COALESCE(match_text, label) ILIKE ${q + '%'} THEN 0 ELSE 1 END,
            listing_count DESC NULLS LAST
          LIMIT ${limit}
        `;
      } else {
        // ─── Longer query: trigram similarity with per-type diversity ───
        // Uses UNION ALL so each branch can independently use the GIN index.
        //   Branch 1: exact prefix matches (highest relevance)
        //   Branch 2: trigram similarity via % and <%> operators
        //   Branch 3: word-boundary prefix match (ILIKE '% query%')
        // Then ROW_NUMBER() OVER (PARTITION BY type) ensures diversity.
        //
        // Address-like queries ("210 Lavaca"): Branch 2 is restricted to
        // address type only — area types (city, county, subdivision, etc.)
        // must match via prefix (Branch 1) or word-boundary (Branch 3).
        // Slot reservation is also conditional: types with only fuzzy matches
        // don't get reserved slots when the query looks like an address.
        results = await sql`
          WITH matches AS (
            -- Branch 1: Exact prefix matches (fastest, most relevant)
            SELECT
              id, label, type, search_value, search_param,
              has_polygon, latitude, longitude, listing_count, priority,
              1.0 as score,
              0 as rank_group
            FROM search_suggestions
            WHERE COALESCE(match_text, label) ILIKE ${q + '%'}
              ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}

            UNION ALL

            -- Branch 2: Trigram similarity (GIN index-accelerated via % operator)
            -- When query is address-like, restrict to address type only so that
            -- fuzzy matches on "Lavaca" don't pull in "Port Lavaca" city, etc.
            SELECT
              id, label, type, search_value, search_param,
              has_polygon, latitude, longitude, listing_count, priority,
              GREATEST(
                similarity(COALESCE(match_text, label), ${q}),
                word_similarity(${q}, COALESCE(match_text, label))
              ) as score,
              1 as rank_group
            FROM search_suggestions
            WHERE (
              COALESCE(match_text, label) % ${q}
              OR ${q} <% COALESCE(match_text, label)
            )
              AND NOT (COALESCE(match_text, label) ILIKE ${q + '%'})
              ${isAddressQuery ? sql`AND type NOT IN ('city', 'county', 'zip', 'subdivision', 'neighborhood', 'school_district')` : sql``}
              ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}

            UNION ALL

            -- Branch 3: Word-boundary prefix (catches "210 Lavaca" when typing "Lavaca")
            SELECT
              id, label, type, search_value, search_param,
              has_polygon, latitude, longitude, listing_count, priority,
              0.5 as score,
              2 as rank_group
            FROM search_suggestions
            WHERE COALESCE(match_text, label) ILIKE ${'% ' + q + '%'}
              AND NOT (COALESCE(match_text, label) ILIKE ${q + '%'})
              AND NOT (COALESCE(match_text, label) % ${q})
              AND NOT (${q} <% COALESCE(match_text, label))
              ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}
          ),
          deduped AS (
            SELECT DISTINCT ON (id) *
            FROM matches
            ORDER BY id, rank_group, score DESC
          ),
          -- Track whether each type has at least one prefix/word-boundary match
          -- (rank_group 0 or 2). Types with only fuzzy matches (rank_group 1)
          -- should not get reserved slots when the query is address-like.
          type_has_prefix AS (
            SELECT DISTINCT type
            FROM deduped
            WHERE rank_group IN (0, 2)
          ),
          ranked AS (
            SELECT d.*,
              ROW_NUMBER() OVER (
                PARTITION BY d.type
                ORDER BY d.rank_group, d.score DESC, d.listing_count DESC NULLS LAST
              ) as type_rank,
              (tp.type IS NOT NULL) as has_prefix_match
            FROM deduped d
            LEFT JOIN type_has_prefix tp ON tp.type = d.type
          )
          -- Reserved slots only for types that earned them (have a prefix match).
          -- Types with only fuzzy matches compete purely on score.
          SELECT
            id, label, type, search_value, search_param,
            has_polygon, latitude, longitude, listing_count, priority,
            score, rank_group, type_rank
          FROM ranked
          ORDER BY
            CASE WHEN type_rank <= ${RESERVED_PER_TYPE} AND has_prefix_match THEN 0 ELSE 1 END,
            rank_group,
            score DESC,
            priority DESC,
            listing_count DESC NULLS LAST
          LIMIT ${limit}
        `;
      }

      // ─── Format response ─────────────────────────────────────────────
      const formatSuggestion = (row: any) => ({
        label: row.label,
        type: row.type,
        search_value: row.search_value,
        search_param: row.search_param ?? null,
        has_polygon: row.has_polygon ?? false,
        listing_count: row.listing_count,
        location: row.latitude && row.longitude ? {
          lat: parseFloat(row.latitude),
          lng: parseFloat(row.longitude),
        } : null,
      });

      const grouped: Record<string, any[]> = {};
      for (const row of results) {
        if (!grouped[row.type]) {
          grouped[row.type] = [];
        }
        grouped[row.type].push(formatSuggestion(row));
      }

      const suggestions = results.map((row: any) => formatSuggestion(row));

      const response = {
        suggestions,
        grouped,
        query: q,
      };

      // ─── Cache the result ────────────────────────────────────────────
      cacheSet(cacheKey, response);
      reply.header('X-Cache', 'MISS');
      reply.header('Cache-Control', 'public, max-age=60');

      return response;
    } catch (err: any) {
      request.log.error(err, 'Suggest error');
      return reply.status(500).send({
        error: 'An error occurred while fetching suggestions',
      });
    }
  });
}
