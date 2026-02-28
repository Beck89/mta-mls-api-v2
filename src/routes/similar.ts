/**
 * GET /api/listings/similar
 *
 * Returns properties similar to a given subject listing, ranked by a
 * weighted composite similarity score that considers:
 *
 *   - Geographic proximity  (30%)  — PostGIS ST_Distance on geog column
 *   - Price similarity      (25%)  — relative difference from subject price
 *   - Size similarity       (20%)  — relative difference in living area
 *   - Bedroom/bath match    (15%)  — exact or near-match scoring
 *   - Year built similarity (10%)  — age proximity within 20-year window
 *
 * Bonus modifiers:
 *   - Same subdivision      (+5%)
 *   - Matching pool          (+2%)
 *   - Matching waterfront    (+2%)
 *
 * Pre-filters use spatial index (ST_DWithin) and price range to keep the
 * candidate pool small before scoring. If fewer than the requested limit
 * are found within the initial radius, the search automatically widens.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';
import { env } from '../config/env.js';
import { calcDaysOnMarket } from '../utils/dates.js';

// ─── Validation Schema ──────────────────────────────────────────────────────

const similarQuerySchema = z.object({
  listing_id: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  radius_miles: z.coerce.number().min(1).max(100).default(10),
  include_pending: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  price_tolerance: z.coerce.number().min(0.1).max(1.0).default(0.5),  // 0.5 = ±50%
});

// ─── Constants ──────────────────────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;
const MIN_RESULTS = 4;           // Auto-widen radius if fewer than this
const WIDEN_MULTIPLIER = 2.5;    // How much to expand radius on retry
const MAX_WIDEN_RADIUS = 50;     // Never search beyond 50 miles

// ─── Scoring weights ────────────────────────────────────────────────────────

const WEIGHTS = {
  geo: 0.30,
  price: 0.25,
  size: 0.20,
  rooms: 0.15,
  age: 0.10,
};

// ─── Bonus modifiers ────────────────────────────────────────────────────────

const BONUS = {
  same_subdivision: 0.05,
  matching_pool: 0.02,
  matching_waterfront: 0.02,
};

// ─── Build the similarity query ─────────────────────────────────────────────
// NOTE: Weight and bonus constants are inlined via sql.unsafe() to avoid
// PostgreSQL parameter type inference issues in CASE expressions (PG infers
// integer from `ELSE 0` branches and rejects float parameters like 0.05).

function buildSimilarityQuery(
  subjectKey: string,
  limit: number,
  radiusMiles: number,
  includePending: boolean,
  priceTolerance: number,
) {
  const radiusMeters = radiusMiles * METERS_PER_MILE;
  const priceMultLow = 1.0 - priceTolerance;
  const priceMultHigh = 1.0 + priceTolerance;

  // Inline numeric constants as SQL literals (safe — these are compile-time constants, not user input)
  const W_GEO = sql.unsafe(String(WEIGHTS.geo));
  const W_PRICE = sql.unsafe(String(WEIGHTS.price));
  const W_SIZE = sql.unsafe(String(WEIGHTS.size));
  const W_ROOMS_HALF = sql.unsafe(String(WEIGHTS.rooms / 2));
  const W_AGE = sql.unsafe(String(WEIGHTS.age));
  const B_SUBDIV = sql.unsafe(String(BONUS.same_subdivision));
  const B_POOL = sql.unsafe(String(BONUS.matching_pool));
  const B_WATER = sql.unsafe(String(BONUS.matching_waterfront));
  const PRICE_TOL = sql.unsafe(String(priceTolerance));
  const RADIUS_M = sql.unsafe(String(radiusMeters));
  const MILES_CONV = sql.unsafe(String(METERS_PER_MILE));
  const PRICE_LO = sql.unsafe(String(priceMultLow));
  const PRICE_HI = sql.unsafe(String(priceMultHigh));

  // Status filter: Active always, optionally Pending
  const statusFilter = includePending
    ? sql`p.standard_status IN ('Active', 'Pending')`
    : sql`p.standard_status = 'Active'`;

  return sql`
    WITH subject AS (
      SELECT *
      FROM properties
      WHERE listing_key = ${subjectKey}
        AND mlg_can_view = true
        AND 'IDX' = ANY(mlg_can_use)
      LIMIT 1
    )
    SELECT
      p.listing_key,
      p.listing_id,
      p.listing_id_display,
      p.standard_status,
      p.list_price,
      p.original_list_price,
      p.bedrooms_total,
      p.bathrooms_total,
      p.living_area,
      p.lot_size_acres,
      p.year_built,
      p.stories,
      p.garage_spaces,
      p.pool_private_yn,
      p.waterfront_yn,
      p.new_construction_yn,
      p.property_type,
      p.property_sub_type,
      p.unparsed_address,
      p.street_name,
      p.city,
      p.state_or_province,
      p.postal_code,
      p.county_or_parish,
      p.subdivision_name,
      p.list_office_name,
      p.latitude,
      p.longitude,
      p.photos_count,
      p.original_entry_ts,
      p.major_change_type,

      -- Distance in miles
      ROUND((ST_Distance(p.geog, s.geog) / ${MILES_CONV})::numeric, 2) AS distance_miles,

      -- ── Geographic proximity score (0–1) ──────────────────────────
      -- 0 miles → 1.0, radius_miles → 0.0
      GREATEST(0.0, 1.0 - (ST_Distance(p.geog, s.geog) / ${RADIUS_M}))
        * ${W_GEO} AS geo_score,

      -- ── Price similarity score (0–1) ──────────────────────────────
      -- 0% diff → 1.0, priceTolerance*100 %+ diff → 0.0
      GREATEST(0.0, 1.0 - ABS(p.list_price::float - s.list_price::float)
        / NULLIF(s.list_price::float * ${PRICE_TOL}, 0))
        * ${W_PRICE} AS price_score,

      -- ── Size similarity score (0–1) ───────────────────────────────
      -- 0% diff → 1.0, 50%+ diff → 0.0
      CASE WHEN s.living_area IS NOT NULL AND s.living_area::float > 0
           THEN GREATEST(0.0, 1.0 - ABS(COALESCE(p.living_area::float, 0) - s.living_area::float)
                  / NULLIF(s.living_area::float * 0.5, 0)) * ${W_SIZE}
           ELSE 0.0
      END AS size_score,

      -- ── Bedroom/bath match score (0–1) ────────────────────────────
      (CASE WHEN s.bedrooms_total IS NOT NULL THEN
            CASE WHEN p.bedrooms_total = s.bedrooms_total THEN 1.0
                 WHEN ABS(COALESCE(p.bedrooms_total::int, 0) - s.bedrooms_total::int) = 1 THEN 0.5
                 ELSE 0.0 END
           ELSE 0.5 END * ${W_ROOMS_HALF}
      +
       CASE WHEN s.bathrooms_total IS NOT NULL THEN
            CASE WHEN p.bathrooms_total = s.bathrooms_total THEN 1.0
                 WHEN ABS(COALESCE(p.bathrooms_total::float, 0) - s.bathrooms_total::float) <= 1 THEN 0.5
                 ELSE 0.0 END
           ELSE 0.5 END * ${W_ROOMS_HALF}
      ) AS room_score,

      -- ── Year built similarity score (0–1) ─────────────────────────
      -- 0 years diff → 1.0, 20+ years diff → 0.0
      CASE WHEN s.year_built IS NOT NULL AND p.year_built IS NOT NULL
           THEN GREATEST(0.0, 1.0 - ABS(p.year_built - s.year_built)::float / 20.0) * ${W_AGE}
           ELSE 0.0
      END AS age_score,

      -- ── Bonus: same subdivision ────────────────────────────────────
      CASE WHEN s.subdivision_name IS NOT NULL
            AND p.subdivision_name IS NOT NULL
            AND LOWER(p.subdivision_name) = LOWER(s.subdivision_name)
           THEN ${B_SUBDIV}
           ELSE 0.0
      END AS subdivision_bonus,

      -- ── Bonus: matching pool ──────────────────────────────────────
      CASE WHEN s.pool_private_yn = true AND p.pool_private_yn = true
           THEN ${B_POOL}
           WHEN s.pool_private_yn IS NOT TRUE AND p.pool_private_yn IS NOT TRUE
           THEN ${B_POOL}
           ELSE 0.0
      END AS pool_bonus,

      -- ── Bonus: matching waterfront ────────────────────────────────
      CASE WHEN s.waterfront_yn = true AND p.waterfront_yn = true
           THEN ${B_WATER}
           WHEN s.waterfront_yn IS NOT TRUE AND p.waterfront_yn IS NOT TRUE
           THEN ${B_WATER}
           ELSE 0.0
      END AS waterfront_bonus,

      -- ── Embedded photos (top 3) ───────────────────────────────────
      (SELECT COALESCE(json_agg(sub ORDER BY sub.media_order ASC NULLS LAST), '[]'::json)
       FROM (SELECT media_order, public_url
             FROM media
             WHERE listing_key = p.listing_key
               AND status = 'complete'
               AND public_url IS NOT NULL
             ORDER BY media_order ASC NULLS LAST
             LIMIT 3) sub
      ) AS photo_urls_json

    FROM properties p, subject s
    WHERE p.listing_key != s.listing_key
      AND p.mlg_can_view = true
      AND 'IDX' = ANY(p.mlg_can_use)
      AND ${statusFilter}
      AND p.property_type = s.property_type
      -- Spatial pre-filter: uses geog GIST index
      AND ST_DWithin(p.geog, s.geog, ${RADIUS_M})
      -- Price pre-filter: uses list_price btree index
      AND p.list_price BETWEEN s.list_price * ${PRICE_LO} AND s.list_price * ${PRICE_HI}
      -- Must have coordinates for distance calculation
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
    ORDER BY (
      GREATEST(0.0, 1.0 - (ST_Distance(p.geog, s.geog) / ${RADIUS_M})) * ${W_GEO}
      + GREATEST(0.0, 1.0 - ABS(p.list_price::float - s.list_price::float)
          / NULLIF(s.list_price::float * ${PRICE_TOL}, 0)) * ${W_PRICE}
      + CASE WHEN s.living_area IS NOT NULL AND s.living_area::float > 0
             THEN GREATEST(0.0, 1.0 - ABS(COALESCE(p.living_area::float, 0) - s.living_area::float)
                    / NULLIF(s.living_area::float * 0.5, 0)) * ${W_SIZE}
             ELSE 0.0 END
      + (CASE WHEN s.bedrooms_total IS NOT NULL THEN
              CASE WHEN p.bedrooms_total = s.bedrooms_total THEN 1.0
                   WHEN ABS(COALESCE(p.bedrooms_total::int, 0) - s.bedrooms_total::int) = 1 THEN 0.5
                   ELSE 0.0 END
             ELSE 0.5 END * ${W_ROOMS_HALF}
        + CASE WHEN s.bathrooms_total IS NOT NULL THEN
              CASE WHEN p.bathrooms_total = s.bathrooms_total THEN 1.0
                   WHEN ABS(COALESCE(p.bathrooms_total::float, 0) - s.bathrooms_total::float) <= 1 THEN 0.5
                   ELSE 0.0 END
             ELSE 0.5 END * ${W_ROOMS_HALF})
      + CASE WHEN s.year_built IS NOT NULL AND p.year_built IS NOT NULL
             THEN GREATEST(0.0, 1.0 - ABS(p.year_built - s.year_built)::float / 20.0) * ${W_AGE}
             ELSE 0.0 END
      + CASE WHEN s.subdivision_name IS NOT NULL AND p.subdivision_name IS NOT NULL
              AND LOWER(p.subdivision_name) = LOWER(s.subdivision_name)
             THEN ${B_SUBDIV} ELSE 0.0 END
      + CASE WHEN s.pool_private_yn = true AND p.pool_private_yn = true
             THEN ${B_POOL}
             WHEN s.pool_private_yn IS NOT TRUE AND p.pool_private_yn IS NOT TRUE
             THEN ${B_POOL}
             ELSE 0.0 END
      + CASE WHEN s.waterfront_yn = true AND p.waterfront_yn = true
             THEN ${B_WATER}
             WHEN s.waterfront_yn IS NOT TRUE AND p.waterfront_yn IS NOT TRUE
             THEN ${B_WATER}
             ELSE 0.0 END
    ) DESC
    LIMIT ${limit}
  `;
}

// ─── Format a similar listing result ────────────────────────────────────────

function formatSimilarResult(row: any) {
  const listPrice = parseFloat(row.list_price) || 0;
  const originalPrice = parseFloat(row.original_list_price) || 0;
  const livingArea = parseFloat(row.living_area) || 0;

  // Composite similarity score (sum of all component scores + bonuses)
  const similarityScore = Math.round((
    (parseFloat(row.geo_score) || 0) +
    (parseFloat(row.price_score) || 0) +
    (parseFloat(row.size_score) || 0) +
    (parseFloat(row.room_score) || 0) +
    (parseFloat(row.age_score) || 0) +
    (parseFloat(row.subdivision_bonus) || 0) +
    (parseFloat(row.pool_bonus) || 0) +
    (parseFloat(row.waterfront_bonus) || 0)
  ) * 1000) / 1000;

  // Parse embedded photo JSON
  let photoUrls: any[] = [];
  if (row.photo_urls_json) {
    try {
      const parsed = typeof row.photo_urls_json === 'string'
        ? JSON.parse(row.photo_urls_json)
        : row.photo_urls_json;
      if (Array.isArray(parsed)) {
        photoUrls = parsed.map((p: any) => ({ order: p.media_order, url: p.public_url }));
      }
    } catch {
      // fallback to empty
    }
  }

  return {
    listing_id: row.listing_id_display || row.listing_id,
    similarity_score: similarityScore,
    distance_miles: parseFloat(row.distance_miles) || 0,
    score_breakdown: {
      geographic: Math.round((parseFloat(row.geo_score) || 0) * 1000) / 1000,
      price: Math.round((parseFloat(row.price_score) || 0) * 1000) / 1000,
      size: Math.round((parseFloat(row.size_score) || 0) * 1000) / 1000,
      rooms: Math.round((parseFloat(row.room_score) || 0) * 1000) / 1000,
      age: Math.round((parseFloat(row.age_score) || 0) * 1000) / 1000,
      subdivision_bonus: Math.round((parseFloat(row.subdivision_bonus) || 0) * 1000) / 1000,
      pool_bonus: Math.round((parseFloat(row.pool_bonus) || 0) * 1000) / 1000,
      waterfront_bonus: Math.round((parseFloat(row.waterfront_bonus) || 0) * 1000) / 1000,
    },
    standard_status: row.standard_status,
    list_price: listPrice,
    price_per_sqft: livingArea > 0 ? Math.round((listPrice / livingArea) * 100) / 100 : null,
    price_reduced: listPrice < originalPrice && originalPrice > 0,
    bedrooms_total: parseFloat(row.bedrooms_total) || null,
    bathrooms_total: parseFloat(row.bathrooms_total) || null,
    living_area: livingArea || null,
    lot_size_acres: parseFloat(row.lot_size_acres) || null,
    year_built: row.year_built,
    stories: parseFloat(row.stories) || null,
    garage_spaces: parseFloat(row.garage_spaces) || 0,
    pool_private: row.pool_private_yn || false,
    waterfront: row.waterfront_yn || false,
    new_construction: row.new_construction_yn || false,
    property_type: row.property_type,
    property_sub_type: row.property_sub_type,
    unparsed_address: row.unparsed_address,
    city: row.city,
    state_or_province: row.state_or_province,
    postal_code: row.postal_code,
    subdivision_name: row.subdivision_name,
    days_on_market: calcDaysOnMarket(row.original_entry_ts),
    _geo: row.latitude && row.longitude ? {
      lat: parseFloat(row.latitude),
      lng: parseFloat(row.longitude),
    } : null,
    photo_count: row.photos_count || 0,
    photo_urls: photoUrls,
  };
}

// ─── Format subject property summary ────────────────────────────────────────

function formatSubjectSummary(row: any) {
  return {
    listing_id: row.listing_id_display || row.listing_id,
    listing_key: row.listing_key,
    standard_status: row.standard_status,
    list_price: parseFloat(row.list_price) || 0,
    bedrooms_total: parseFloat(row.bedrooms_total) || null,
    bathrooms_total: parseFloat(row.bathrooms_total) || null,
    living_area: parseFloat(row.living_area) || null,
    lot_size_acres: parseFloat(row.lot_size_acres) || null,
    year_built: row.year_built,
    property_type: row.property_type,
    property_sub_type: row.property_sub_type,
    unparsed_address: row.unparsed_address,
    city: row.city,
    state_or_province: row.state_or_province,
    postal_code: row.postal_code,
    subdivision_name: row.subdivision_name,
    pool_private: row.pool_private_yn || false,
    waterfront: row.waterfront_yn || false,
    _geo: row.latitude && row.longitude ? {
      lat: parseFloat(row.latitude),
      lng: parseFloat(row.longitude),
    } : null,
  };
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function similarRoutes(app: FastifyInstance) {
  app.get('/similar', async (request, reply) => {
    const parseResult = similarQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters. Must provide listing_id.',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const { listing_id, limit, radius_miles, include_pending, price_tolerance } = parseResult.data;

    try {
      const t0 = performance.now();

      // ─── Resolve listing_id → listing_key ──────────────────────────
      let listingKey: string | null = null;

      const resolved = await sql`
        SELECT listing_key FROM properties
        WHERE listing_id_display = ${listing_id}
          AND mlg_can_view = true
          AND 'IDX' = ANY(mlg_can_use)
        LIMIT 1
      `;

      if (resolved.length > 0) {
        listingKey = resolved[0].listing_key;
      } else {
        // Fallback: try as listing_key directly
        listingKey = listing_id;
      }

      // ─── Fetch subject property ────────────────────────────────────
      const subjectRows = await sql`
        SELECT * FROM properties
        WHERE listing_key = ${listingKey}
          AND mlg_can_view = true
          AND 'IDX' = ANY(mlg_can_use)
        LIMIT 1
      `;

      if (subjectRows.length === 0) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Listing "${listing_id}" not found`,
          },
        });
      }

      const subject = subjectRows[0];

      // Verify subject has coordinates (required for spatial similarity)
      if (!subject.latitude || !subject.longitude) {
        return reply.status(422).send({
          error: {
            code: 'NO_COORDINATES',
            message: 'Subject listing has no geographic coordinates; cannot compute similar homes.',
          },
        });
      }

      // ─── Run similarity query ──────────────────────────────────────
      let results = await buildSimilarityQuery(
        listingKey!,
        limit,
        radius_miles,
        include_pending === true,
        price_tolerance,
      );

      let actualRadius = radius_miles;

      // ─── Auto-widen if too few results ─────────────────────────────
      if (results.length < MIN_RESULTS && radius_miles * WIDEN_MULTIPLIER <= MAX_WIDEN_RADIUS) {
        const widenedRadius = Math.min(radius_miles * WIDEN_MULTIPLIER, MAX_WIDEN_RADIUS);
        const widenedTolerance = Math.min(price_tolerance * 1.5, 1.0); // Also relax price band

        results = await buildSimilarityQuery(
          listingKey!,
          limit,
          widenedRadius,
          include_pending === true,
          widenedTolerance,
        );
        actualRadius = widenedRadius;
      }

      const t1 = performance.now();

      // ─── Format response ───────────────────────────────────────────
      const similar = results.map(formatSimilarResult);

      const t2 = performance.now();

      // ─── Server-Timing header ──────────────────────────────────────
      reply.header('Server-Timing',
        `db;dur=${(t1 - t0).toFixed(0)}, format;dur=${(t2 - t1).toFixed(0)}, total;dur=${(t2 - t0).toFixed(0)}`
      );

      return {
        subject: formatSubjectSummary(subject),
        similar,
        metadata: {
          total_candidates: similar.length,
          returned: similar.length,
          radius_miles: actualRadius,
          radius_widened: actualRadius !== radius_miles,
          price_tolerance,
          weights: WEIGHTS,
          bonuses: BONUS,
        },
      };
    } catch (err: any) {
      request.log.error(err, 'Similar homes error');
      return reply.status(500).send({
        error: {
          code: 'SIMILAR_ERROR',
          message: 'An error occurred while finding similar homes',
          details: env.NODE_ENV === 'development' ? err.message : undefined,
        },
      });
    }
  });
}
