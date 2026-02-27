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
        // Prefix match for very short queries
        results = await sql`
          SELECT 
            id,
            label,
            type,
            search_value,
            latitude,
            longitude,
            listing_count,
            priority,
            1.0 as score
          FROM search_suggestions
          WHERE label ILIKE ${q + '%'}
            ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}
          ORDER BY priority DESC, listing_count DESC NULLS LAST
          LIMIT ${limit}
        `;
      } else {
        // Trigram similarity for longer queries — combines similarity score with prefix bonus
        results = await sql`
          SELECT 
            id,
            label,
            type,
            search_value,
            latitude,
            longitude,
            listing_count,
            priority,
            GREATEST(
              similarity(label, ${q}),
              word_similarity(${q}, label)
            ) as score
          FROM search_suggestions
          WHERE (
            similarity(label, ${q}) > 0.1
            OR word_similarity(${q}, label) > 0.2
            OR label ILIKE ${q + '%'}
            OR label ILIKE ${'% ' + q + '%'}
          )
            ${typeList && typeList.length > 0 ? sql`AND type = ANY(${typeList})` : sql``}
          ORDER BY 
            -- Exact prefix matches first
            CASE WHEN label ILIKE ${q + '%'} THEN 0 ELSE 1 END,
            -- Then by priority (cities > neighborhoods > zips > subdivisions > addresses)
            priority DESC,
            -- Then by similarity score
            score DESC,
            -- Then by listing count
            listing_count DESC NULLS LAST
          LIMIT ${limit}
        `;
      }

      // Group results by type
      const grouped: Record<string, any[]> = {};
      for (const row of results) {
        if (!grouped[row.type]) {
          grouped[row.type] = [];
        }
        grouped[row.type].push({
          label: row.label,
          type: row.type,
          search_value: row.search_value,
          listing_count: row.listing_count,
          location: row.latitude && row.longitude ? {
            lat: parseFloat(row.latitude),
            lng: parseFloat(row.longitude),
          } : null,
        });
      }

      // Flatten into ordered array with type grouping preserved
      const suggestions = results.map((row: any) => ({
        label: row.label,
        type: row.type,
        search_value: row.search_value,
        listing_count: row.listing_count,
        location: row.latitude && row.longitude ? {
          lat: parseFloat(row.latitude),
          lng: parseFloat(row.longitude),
        } : null,
      }));

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
