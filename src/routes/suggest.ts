/**
 * GET /api/suggest
 * 
 * Typeahead/autocomplete suggestions using pg_trgm for fast fuzzy matching.
 * Searches across addresses, cities, ZIP codes, subdivisions, and neighborhoods.
 * Returns results grouped by type with category headers.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';

const suggestQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  types: z.string().optional(), // comma-separated: 'city,zip,subdivision,neighborhood,address'
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

    try {
      // Filter by types if specified
      let typeFilter = '';
      const typeList = types?.split(',').map(t => t.trim()).filter(Boolean);
      
      // Use trigram similarity for fuzzy matching
      // For short queries (< 3 chars), use prefix matching instead
      let results;

      if (q.length < 3) {
        // Prefix match for very short queries — match against match_text (street address only)
        // or label for non-address types. Falls back to label if match_text is null.
        results = await sql`
          SELECT
            id,
            label,
            type,
            search_value,
            search_param,
            has_polygon,
            latitude,
            longitude,
            listing_count,
            priority,
            1.0 as score
          FROM search_suggestions
          WHERE (
            COALESCE(match_text, label) ILIKE ${q + '%'}
            OR label ILIKE ${q + '%'}
          )
            ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}
          ORDER BY
            -- Exact prefix match on match_text first (most relevant)
            CASE WHEN COALESCE(match_text, label) ILIKE ${q + '%'} THEN 0 ELSE 1 END,
            priority DESC,
            listing_count DESC NULLS LAST
          LIMIT ${limit}
        `;
      } else {
        // Trigram similarity — match against match_text (street address only for addresses,
        // city/area name for others). This prevents city/state/ZIP from diluting address scores.
        results = await sql`
          SELECT
            id,
            label,
            type,
            search_value,
            search_param,
            has_polygon,
            latitude,
            longitude,
            listing_count,
            priority,
            GREATEST(
              similarity(COALESCE(match_text, label), ${q}),
              word_similarity(${q}, COALESCE(match_text, label))
            ) as score
          FROM search_suggestions
          WHERE (
            similarity(COALESCE(match_text, label), ${q}) > 0.1
            OR word_similarity(${q}, COALESCE(match_text, label)) > 0.2
            OR COALESCE(match_text, label) ILIKE ${q + '%'}
            OR COALESCE(match_text, label) ILIKE ${'% ' + q + '%'}
          )
            ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}
          ORDER BY
            -- Exact prefix matches on match_text first
            CASE WHEN COALESCE(match_text, label) ILIKE ${q + '%'} THEN 0 ELSE 1 END,
            -- Similarity score second — high-relevance matches beat lower-priority types
            score DESC,
            -- Priority as tiebreaker (cities > neighborhoods > zips > subdivisions > addresses)
            priority DESC,
            -- Listing count as final tiebreaker
            listing_count DESC NULLS LAST
          LIMIT ${limit}
        `;
      }

      // Helper to format a single suggestion row
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

      // Group results by type
      const grouped: Record<string, any[]> = {};
      for (const row of results) {
        if (!grouped[row.type]) {
          grouped[row.type] = [];
        }
        grouped[row.type].push(formatSuggestion(row));
      }

      // Flatten into ordered array with type grouping preserved
      const suggestions = results.map((row: any) => formatSuggestion(row));

      return {
        suggestions,
        grouped,
        query: q,
      };
    } catch (err: any) {
      request.log.error(err, 'Suggest error');
      return reply.status(500).send({
        error: 'An error occurred while fetching suggestions',
      });
    }
  });
}
