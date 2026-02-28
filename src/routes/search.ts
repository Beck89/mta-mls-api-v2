/**
 * GET /api/listings/search
 *
 * Primary property search with advanced filtering, sorting, pagination,
 * bounding box, GeoJSON polygon, and named neighborhood/ZIP polygon support.
 *
 * Supports split-response mode: when `include_map_pins=true`, returns a
 * lightweight `map_pins` array (all matching listings with minimal fields)
 * alongside the normal paginated `data` array. This enables the frontend to
 * render ALL map markers while paginating the card list independently.
 *
 * Metadata includes bounds for map centering/zooming.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';
import { env } from '../config/env.js';
import { calcDaysOnMarket } from '../utils/dates.js';

// ─── Validation Schema ──────────────────────────────────────────────────────

const searchQuerySchema = z.object({
  // Pagination
  page: z.coerce.number().int().min(1).default(1),
  items_per_page: z.union([z.literal('all'), z.coerce.number().int().min(1).max(10000)]).default(20),

  // Sorting
  sort_by: z.enum([
    'list_date', 'list_price', 'living_area', 'price_per_sqft',
    'status', 'bedrooms_total', 'bathrooms_total',
  ]).default('list_date'),
  sort_direction: z.enum(['asc', 'desc']).default('desc'),

  // Geographic - bounding box
  min_latitude: z.coerce.number().min(-90).max(90).optional(),
  max_latitude: z.coerce.number().min(-90).max(90).optional(),
  min_longitude: z.coerce.number().min(-180).max(180).optional(),
  max_longitude: z.coerce.number().min(-180).max(180).optional(),

  // Geographic - GeoJSON polygon (stringified JSON)
  polygon: z.string().optional(),

  // Geographic - named area
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  zip_code: z.string().optional(),
  county: z.string().optional(),

  // School district filter — polygon-backed spatial filter (ST_Within)
  school_district: z.string().optional(),

  // Property characteristics
  property_type: z.string().optional(),
  property_sub_type: z.string().optional(),
  min_price: z.coerce.number().int().min(0).optional(),
  max_price: z.coerce.number().int().min(0).optional(),
  min_bedrooms: z.coerce.number().int().min(0).optional(),
  max_bedrooms: z.coerce.number().int().min(0).optional(),
  min_bathrooms: z.coerce.number().min(0).optional(),
  max_bathrooms: z.coerce.number().min(0).optional(),
  min_sqft: z.coerce.number().int().min(0).optional(),
  max_sqft: z.coerce.number().int().min(0).optional(),
  min_lot_size: z.coerce.number().min(0).optional(),
  max_lot_size: z.coerce.number().min(0).optional(),
  min_year_built: z.coerce.number().int().min(1800).optional(),
  max_year_built: z.coerce.number().int().max(2100).optional(),
  min_price_per_sqft: z.coerce.number().min(0).optional(),
  max_price_per_sqft: z.coerce.number().min(0).optional(),

  // Amenities
  pool: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  garage: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  min_garage_spaces: z.coerce.number().int().min(0).optional(),
  max_garage_spaces: z.coerce.number().int().min(0).optional(),
  min_parking_spaces: z.coerce.number().int().min(0).optional(),
  max_parking_spaces: z.coerce.number().int().min(0).optional(),
  waterfront: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  fireplace: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  new_construction: z.enum(['true', 'false']).transform(v => v === 'true').optional(),

  // Status & timing
  status: z.string().optional(),
  days_on_market: z.coerce.number().int().min(0).optional(),
  price_reduction: z.enum([
    'any', 'last_day', 'last_3_days', 'last_7_days', 'last_14_days',
    'last_30_days', 'over_1_month', 'over_2_months', 'over_3_months',
  ]).optional(),
  open_house: z.enum(['this_weekend', 'next_weekend', 'all']).optional(),

  // Text search
  keywords: z.string().optional(),

  // Map pins — lightweight pin data for all matching listings
  include_map_pins: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
});

// ─── Map pins configuration ─────────────────────────────────────────────────

const MAP_PINS_LIMIT = 5000;

// ─── Cached total listings count ────────────────────────────────────────────
// This value changes only when listings are added/removed, so we cache it
// in-memory with a 5-minute TTL to avoid a full table scan on every request.

let cachedTotalCount: { value: number; expiresAt: number } | null = null;
const TOTAL_COUNT_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getTotalListingsCount(): Promise<number> {
  if (cachedTotalCount && Date.now() < cachedTotalCount.expiresAt) {
    return cachedTotalCount.value;
  }
  const result = await sql`
    SELECT COUNT(*)::int as total FROM properties
    WHERE mlg_can_view = true AND 'IDX' = ANY(mlg_can_use)
  `;
  cachedTotalCount = { value: result[0].total, expiresAt: Date.now() + TOTAL_COUNT_TTL_MS };
  return cachedTotalCount.value;
}

// ─── Status mapping ─────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, string[]> = {
  active: ['Active'],
  pending: ['Pending'],
  active_under_contract: ['Active Under Contract'],
  sold: ['Closed'],
};

function mapStatuses(statusParam: string): string[] {
  const requested = statusParam.split(',').map(s => s.trim().toLowerCase());
  const mapped: string[] = [];
  for (const s of requested) {
    if (STATUS_MAP[s]) {
      mapped.push(...STATUS_MAP[s]);
    } else {
      mapped.push(s.charAt(0).toUpperCase() + s.slice(1));
    }
  }
  return mapped;
}

// ─── Build dynamic filter fragments ─────────────────────────────────────────

type SqlFragment = ReturnType<typeof sql>;

function buildFilters(params: z.infer<typeof searchQuerySchema>): SqlFragment[] {
  const filters: SqlFragment[] = [
    sql`p.mlg_can_view = true`,
    sql`'IDX' = ANY(p.mlg_can_use)`,
  ];

  // Status
  if (params.status) {
    const statuses = mapStatuses(params.status);
    filters.push(sql`p.standard_status IN ${sql(statuses)}`);
  }

  // Bounding box
  if (params.min_latitude !== undefined && params.max_latitude !== undefined &&
      params.min_longitude !== undefined && params.max_longitude !== undefined) {
    filters.push(
      sql`ST_Within(p.geog::geometry, ST_MakeEnvelope(${params.min_longitude}, ${params.min_latitude}, ${params.max_longitude}, ${params.max_latitude}, 4326))`
    );
  }

  // GeoJSON polygon
  if (params.polygon) {
    try {
      const geojson = JSON.parse(params.polygon);
      const geojsonStr = JSON.stringify(geojson);
      filters.push(
        sql`ST_Within(p.geog::geometry, ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326))`
      );
    } catch {
      // handled by caller
    }
  }

  // ─── Area filters (union / OR logic across all area types) ───────────────
  // When multiple area types are specified (e.g., zip_code + neighborhood + county),
  // listings matching ANY of the selected areas are returned (union, not intersection).
  // Within a single parameter, comma-separated values are also unioned.
  //
  // Each area type contributes one OR branch:
  //   - neighborhood / county: always polygon-backed (ST_Within)
  //   - city / zip: polygon-backed if slug exists in search_areas, text fallback otherwise
  //
  // All active area conditions are collected and combined into a single OR expression.
  const areaConditions: ReturnType<typeof sql>[] = [];

  if (params.neighborhood) {
    const slugs = params.neighborhood.split(',').map(s => s.trim()).filter(Boolean);
    areaConditions.push(
      sql`ST_Within(p.geog::geometry, (
        SELECT ST_Union(geom) FROM search_areas
        WHERE type = 'neighborhood' AND slug = ANY(${slugs})
      ))`
    );
  }

  if (params.city) {
    const values = params.city.split(',').map(c => c.trim()).filter(Boolean);
    areaConditions.push(
      sql`(
        ST_Within(p.geog::geometry, (
          SELECT ST_Union(geom) FROM search_areas
          WHERE type = 'city' AND slug = ANY(${values})
        ))
        OR (
          NOT EXISTS (SELECT 1 FROM search_areas WHERE type = 'city' AND slug = ANY(${values}))
          AND LOWER(p.city) = ANY(${values.map((v: string) => v.toLowerCase())})
        )
      )`
    );
  }

  if (params.zip_code) {
    const values = params.zip_code.split(',').map(z => z.trim()).filter(Boolean);
    areaConditions.push(
      sql`(
        ST_Within(p.geog::geometry, (
          SELECT ST_Union(geom) FROM search_areas
          WHERE type = 'zipcode' AND slug = ANY(${values})
        ))
        OR (
          NOT EXISTS (SELECT 1 FROM search_areas WHERE type = 'zipcode' AND slug = ANY(${values}))
          AND p.postal_code = ANY(${values})
        )
      )`
    );
  }

  if (params.county) {
    const slugs = params.county.split(',').map(s => s.trim()).filter(Boolean);
    areaConditions.push(
      sql`ST_Within(p.geog::geometry, (
        SELECT ST_Union(geom) FROM search_areas
        WHERE type = 'county' AND slug = ANY(${slugs})
      ))`
    );
  }

  if (params.school_district) {
    const slugs = params.school_district.split(',').map(s => s.trim()).filter(Boolean);
    areaConditions.push(
      sql`ST_Within(p.geog::geometry, (
        SELECT ST_Union(geom) FROM search_areas
        WHERE type = 'school_district' AND slug = ANY(${slugs})
      ))`
    );
  }

  // Combine all area conditions with OR (union) — a listing matches if it's in ANY selected area
  if (areaConditions.length === 1) {
    filters.push(areaConditions[0]);
  } else if (areaConditions.length > 1) {
    const combined = areaConditions.reduce((acc, cond) => sql`${acc} OR ${cond}`);
    filters.push(sql`(${combined})`);
  }

  // Property type
  if (params.property_type) {
    const types = params.property_type.split(',').map(t => t.trim());
    filters.push(sql`p.property_type IN ${sql(types)}`);
  }

  // Property sub type
  if (params.property_sub_type && params.property_sub_type !== 'all') {
    const subTypes = params.property_sub_type.split(',').map(t => t.trim());
    filters.push(sql`p.property_sub_type IN ${sql(subTypes)}`);
  }

  // Price (no ::numeric cast — columns are already numeric, cast defeats index usage)
  if (params.min_price !== undefined) filters.push(sql`p.list_price >= ${params.min_price}`);
  if (params.max_price !== undefined) filters.push(sql`p.list_price <= ${params.max_price}`);

  // Bedrooms
  if (params.min_bedrooms !== undefined) filters.push(sql`p.bedrooms_total >= ${params.min_bedrooms}`);
  if (params.max_bedrooms !== undefined) filters.push(sql`p.bedrooms_total <= ${params.max_bedrooms}`);

  // Bathrooms
  if (params.min_bathrooms !== undefined) filters.push(sql`p.bathrooms_total >= ${params.min_bathrooms}`);
  if (params.max_bathrooms !== undefined) filters.push(sql`p.bathrooms_total <= ${params.max_bathrooms}`);

  // Square footage
  if (params.min_sqft !== undefined) filters.push(sql`p.living_area >= ${params.min_sqft}`);
  if (params.max_sqft !== undefined) filters.push(sql`p.living_area <= ${params.max_sqft}`);

  // Lot size
  if (params.min_lot_size !== undefined) filters.push(sql`p.lot_size_acres >= ${params.min_lot_size}`);
  if (params.max_lot_size !== undefined) filters.push(sql`p.lot_size_acres <= ${params.max_lot_size}`);

  // Year built
  if (params.min_year_built !== undefined) filters.push(sql`p.year_built >= ${params.min_year_built}`);
  if (params.max_year_built !== undefined) filters.push(sql`p.year_built <= ${params.max_year_built}`);

  // Price per sqft (computed expression — cast needed here for division safety)
  if (params.min_price_per_sqft !== undefined) {
    filters.push(sql`(p.list_price / NULLIF(p.living_area, 0)) >= ${params.min_price_per_sqft}`);
  }
  if (params.max_price_per_sqft !== undefined) {
    filters.push(sql`(p.list_price / NULLIF(p.living_area, 0)) <= ${params.max_price_per_sqft}`);
  }

  // Amenities
  if (params.pool === true) filters.push(sql`p.pool_private_yn = true`);
  if (params.garage === true) filters.push(sql`p.garage_spaces > 0`);
  if (params.min_garage_spaces !== undefined) filters.push(sql`p.garage_spaces >= ${params.min_garage_spaces}`);
  if (params.max_garage_spaces !== undefined) filters.push(sql`p.garage_spaces <= ${params.max_garage_spaces}`);
  if (params.min_parking_spaces !== undefined) filters.push(sql`p.parking_total >= ${params.min_parking_spaces}`);
  if (params.max_parking_spaces !== undefined) filters.push(sql`p.parking_total <= ${params.max_parking_spaces}`);
  if (params.waterfront === true) filters.push(sql`p.waterfront_yn = true`);
  if (params.fireplace === true) filters.push(sql`p.fireplaces_total > 0`);
  if (params.new_construction === true) filters.push(sql`p.new_construction_yn = true`);

  // Days on market — compare against Chicago calendar date to avoid UTC boundary issues
  if (params.days_on_market !== undefined) {
    filters.push(sql`(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - (p.original_entry_ts AT TIME ZONE 'America/Chicago')::date <= ${params.days_on_market}`);
  }

  // Price reduction
  if (params.price_reduction) {
    filters.push(sql`p.list_price < p.original_list_price`);
    if (params.price_reduction !== 'any') {
      const intervalDays: Record<string, number> = {
        last_day: 1, last_3_days: 3, last_7_days: 7,
        last_14_days: 14, last_30_days: 30,
        over_1_month: 30, over_2_months: 60, over_3_months: 90,
      };
      const days = intervalDays[params.price_reduction];
      if (days) {
        if (params.price_reduction.startsWith('over_')) {
          filters.push(sql`p.major_change_ts <= NOW() - make_interval(days => ${days})`);
        } else {
          filters.push(sql`p.major_change_ts >= NOW() - make_interval(days => ${days})`);
        }
      }
    }
  }

  // Keywords
  if (params.keywords) {
    const kw = `%${params.keywords}%`;
    filters.push(
      sql`(p.unparsed_address ILIKE ${kw} OR p.city ILIKE ${kw} OR p.subdivision_name ILIKE ${kw} OR p.public_remarks ILIKE ${kw} OR p.postal_code ILIKE ${kw})`
    );
  }

  return filters;
}

// ─── Sort mapping ───────────────────────────────────────────────────────────

function getSortFragment(sortBy: string, sortDir: string) {
  const dir = sortDir === 'asc' ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`;
  switch (sortBy) {
    case 'list_price': return sql`p.list_price ${dir}`;
    case 'living_area': return sql`p.living_area ${dir}`;
    case 'price_per_sqft': return sql`(p.list_price / NULLIF(p.living_area, 0)) ${dir}`;
    case 'status': return sql`p.standard_status ${dir}`;
    case 'bedrooms_total': return sql`p.bedrooms_total ${dir}`;
    case 'bathrooms_total': return sql`p.bathrooms_total ${dir}`;
    case 'list_date':
    default: return sql`p.original_entry_ts ${dir}`;
  }
}

// ─── Format a raw DB row into the clean search result shape ─────────────────

function formatSearchResult(row: any) {
  const listPrice = parseFloat(row.list_price) || 0;
  const originalPrice = parseFloat(row.original_list_price) || 0;
  const livingArea = parseFloat(row.living_area) || 0;

  // Parse embedded photo JSON from correlated subquery
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

  // Parse embedded open house JSON from correlated subquery
  let nextOpenHouse: any = null;
  if (row.next_open_house_json) {
    try {
      const parsed = typeof row.next_open_house_json === 'string'
        ? JSON.parse(row.next_open_house_json)
        : row.next_open_house_json;
      if (parsed && parsed.date) {
        nextOpenHouse = {
          date: parsed.date,
          start_time: parsed.start_time,
          end_time: parsed.end_time,
        };
      }
    } catch {
      // fallback to null
    }
  }

  return {
    listing_id: row.listing_id_display || row.listing_id,
    standard_status: row.standard_status,
    list_price: listPrice,
    price_per_sqft: livingArea > 0 ? Math.round((listPrice / livingArea) * 100) / 100 : null,
    price_reduced: listPrice < originalPrice && originalPrice > 0,
    price_reduction_amount: originalPrice > listPrice ? Math.round(originalPrice - listPrice) : null,
    bedrooms_total: parseFloat(row.bedrooms_total) || null,
    bathrooms_total: parseFloat(row.bathrooms_total) || null,
    living_area: livingArea || null,
    year_built: row.year_built,
    lot_size_acres: parseFloat(row.lot_size_acres) || null,
    days_on_market: calcDaysOnMarket(row.original_entry_ts),
    pool_private: row.pool_private_yn || false,
    garage_spaces: parseFloat(row.garage_spaces) || 0,
    new_construction: row.new_construction_yn || false,
    waterfront: row.waterfront_yn || false,
    property_type: row.property_type,
    property_sub_type: row.property_sub_type,
    street_name: row.street_name,
    city: row.city,
    state_or_province: row.state_or_province,
    postal_code: row.postal_code,
    county_or_parish: row.county_or_parish,
    unparsed_address: row.unparsed_address,
    subdivision_name: row.subdivision_name,
    list_office_name: row.list_office_name,
    major_change_type: row.major_change_type,
    _geo: row.latitude && row.longitude ? {
      lat: parseFloat(row.latitude),
      lng: parseFloat(row.longitude),
    } : null,
    photo_count: row.photos_count || 0,
    photo_urls: photoUrls,
    next_open_house: nextOpenHouse,
  };
}

// ─── Format a raw DB row into a lightweight map pin ─────────────────────────

function formatMapPin(row: any) {
  return {
    id: row.listing_id_display || row.listing_id || row.listing_key,
    lat: parseFloat(row.latitude),
    lng: parseFloat(row.longitude),
    price: parseFloat(row.list_price) || 0,
    status: row.standard_status,
    beds: parseFloat(row.bedrooms_total) || null,
    baths: parseFloat(row.bathrooms_total) || null,
    property_type: row.property_type,
  };
}

// ─── Map pin select fields (lightweight — no JOINs needed) ──────────────────

const MAP_PIN_FIELDS = sql`
  p.listing_id_display,
  p.listing_id,
  p.listing_key,
  p.latitude,
  p.longitude,
  p.list_price,
  p.standard_status,
  p.bedrooms_total,
  p.bathrooms_total,
  p.property_type
`;

// ─── Select fields (with embedded photo + open house subqueries) ────────────
// Photos and open houses are fetched as correlated subqueries within the main
// data query, eliminating 2 sequential DB round-trips. Each subquery hits an
// index (idx_media_listing_photos for photos, open_houses PK for OH).

const SELECT_FIELDS = sql`
  p.listing_key,
  p.listing_id,
  p.listing_id_display,
  p.standard_status,
  p.list_price,
  p.original_list_price,
  p.bedrooms_total,
  p.bathrooms_total,
  p.living_area,
  p.year_built,
  p.lot_size_acres,
  p.pool_private_yn,
  p.garage_spaces,
  p.new_construction_yn,
  p.waterfront_yn,
  p.property_type,
  p.property_sub_type,
  p.street_name,
  p.city,
  p.state_or_province,
  p.postal_code,
  p.county_or_parish,
  p.unparsed_address,
  p.subdivision_name,
  p.list_office_name,
  p.major_change_type,
  p.latitude,
  p.longitude,
  p.photos_count,
  p.original_entry_ts,
  (SELECT COALESCE(json_agg(sub ORDER BY sub.media_order ASC NULLS LAST), '[]'::json)
   FROM (SELECT media_order, public_url
         FROM media
         WHERE listing_key = p.listing_key
           AND status = 'complete'
           AND public_url IS NOT NULL
         ORDER BY media_order ASC NULLS LAST
         LIMIT 3) sub
  ) AS photo_urls_json,
  (SELECT json_build_object('date', oh.open_house_date, 'start_time', oh.open_house_start, 'end_time', oh.open_house_end)
   FROM open_houses oh
   WHERE oh.listing_id = p.listing_id
     AND oh.mlg_can_view = true
     AND oh.open_house_date >= CURRENT_DATE
   ORDER BY oh.open_house_start ASC
   LIMIT 1
  ) AS next_open_house_json
`;

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (request, reply) => {
    const parseResult = searchQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: parseResult.error.flatten().fieldErrors,
        },
      });
    }

    const params = parseResult.data;

    // Validate polygon if provided
    if (params.polygon) {
      try { JSON.parse(params.polygon); } catch {
        return reply.status(400).send({
          error: { code: 'INVALID_POLYGON', message: 'Invalid GeoJSON polygon' },
        });
      }
    }

    try {
      const t0 = performance.now();

      const filters = buildFilters(params);
      const whereClause = filters.reduce((acc, f, i) =>
        i === 0 ? f : sql`${acc} AND ${f}`
      );
      const sortFragment = getSortFragment(params.sort_by, params.sort_direction);
      const itemsPerPage = params.items_per_page === 'all' ? 10000 : params.items_per_page;
      const offset = (params.page - 1) * itemsPerPage;

      // Handle open house join
      const hasOpenHouseFilter = !!params.open_house;
      let openHouseCondition = sql``;
      if (hasOpenHouseFilter) {
        if (params.open_house === 'this_weekend') {
          openHouseCondition = sql`AND oh.open_house_date >= date_trunc('week', CURRENT_DATE) + INTERVAL '5 days'
            AND oh.open_house_date < date_trunc('week', CURRENT_DATE) + INTERVAL '8 days'
            AND oh.open_house_date >= CURRENT_DATE`;
        } else if (params.open_house === 'next_weekend') {
          openHouseCondition = sql`AND oh.open_house_date >= date_trunc('week', CURRENT_DATE) + INTERVAL '12 days'
            AND oh.open_house_date < date_trunc('week', CURRENT_DATE) + INTERVAL '15 days'
            AND oh.open_house_date >= CURRENT_DATE`;
        } else {
          openHouseCondition = sql`AND oh.open_house_date >= CURRENT_DATE`;
        }
      }

      // ─── Determine if map pins should be fetched ──────────────────
      // Map pins are returned when include_map_pins=true, but skipped
      // when open_house filter is active (requires JOIN, small result sets)
      const shouldFetchMapPins = params.include_map_pins === true && !hasOpenHouseFilter;

      // ─── Execute queries in parallel ──────────────────────────────
      // Run count, data, total, and optionally map_pins concurrently
      let countResult: any[];
      let dataResult: any[];
      let mapPinsResult: any[] = [];

      // Fetch cached total count in parallel with all other queries
      const totalCountPromise = getTotalListingsCount();

      if (hasOpenHouseFilter) {
        // Open house filter requires JOIN — run count + data in parallel
        // (map pins skipped for open house searches)
        [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(DISTINCT p.listing_key)::int as total
            FROM properties p
            INNER JOIN open_houses oh ON oh.listing_id = p.listing_id AND oh.mlg_can_view = true ${openHouseCondition}
            WHERE ${whereClause}
          `,
          sql`
            SELECT DISTINCT ON (p.listing_key) ${SELECT_FIELDS}
            FROM properties p
            INNER JOIN open_houses oh ON oh.listing_id = p.listing_id AND oh.mlg_can_view = true ${openHouseCondition}
            WHERE ${whereClause}
            ORDER BY p.listing_key
            LIMIT ${itemsPerPage}
            OFFSET ${offset}
          `,
        ]);
      } else if (shouldFetchMapPins) {
        // Standard search WITH map pins — run all 3 in parallel
        // Skip separate COUNT query: derive filtered count from map_pins result
        [dataResult, mapPinsResult] = await Promise.all([
          sql`
            SELECT ${SELECT_FIELDS}
            FROM properties p
            WHERE ${whereClause}
            ORDER BY ${sortFragment}
            LIMIT ${itemsPerPage}
            OFFSET ${offset}
          `,
          sql`
            SELECT ${MAP_PIN_FIELDS}
            FROM properties p
            WHERE ${whereClause}
              AND p.latitude IS NOT NULL
              AND p.longitude IS NOT NULL
            LIMIT ${MAP_PINS_LIMIT + 1}
          `,
        ]);
        // Derive filtered count from map pins (avoids a separate COUNT query)
        // If truncated, we need the real count; otherwise map_pins length IS the count
        if (mapPinsResult.length > MAP_PINS_LIMIT) {
          // Truncated — need exact count (run it now, overlapping with totalCount)
          countResult = await sql`
            SELECT COUNT(*)::int as total
            FROM properties p
            WHERE ${whereClause}
          `;
        } else {
          // Not truncated — map pins length is the exact filtered count
          countResult = [{ total: mapPinsResult.length }];
        }
      } else {
        // Standard search WITHOUT map pins — run count + data in parallel
        [countResult, dataResult] = await Promise.all([
          sql`
            SELECT COUNT(*)::int as total
            FROM properties p
            WHERE ${whereClause}
          `,
          sql`
            SELECT ${SELECT_FIELDS}
            FROM properties p
            WHERE ${whereClause}
            ORDER BY ${sortFragment}
            LIMIT ${itemsPerPage}
            OFFSET ${offset}
          `,
        ]);
      }

      // Await the cached total count (usually instant from cache)
      const totalListingsCount = await totalCountPromise;
      const filteredCount = countResult[0].total;
      const totalPages = Math.ceil(filteredCount / itemsPerPage);

      // ─── Process map pins ─────────────────────────────────────────
      let mapPins: any[] | undefined;
      let mapPinsTruncated = false;

      if (shouldFetchMapPins && mapPinsResult.length > 0) {
        // Check if we hit the limit (we fetched LIMIT + 1 to detect truncation)
        if (mapPinsResult.length > MAP_PINS_LIMIT) {
          mapPinsTruncated = true;
          mapPinsResult = mapPinsResult.slice(0, MAP_PINS_LIMIT);
        }
        mapPins = mapPinsResult
          .filter((row: any) => row.latitude && row.longitude)
          .map(formatMapPin);
      }

      // ─── Compute bounds ───────────────────────────────────────────
      // When map pins are available, compute bounds from ALL pins (full
      // filtered dataset). Otherwise fall back to paginated data bounds.
      let bounds = null;
      const boundsSource = mapPins && mapPins.length > 0 ? mapPins : null;

      if (boundsSource) {
        // Compute bounds from map pins (covers full filtered result set)
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (const pin of boundsSource) {
          if (!isNaN(pin.lat) && !isNaN(pin.lng)) {
            if (pin.lat < minLat) minLat = pin.lat;
            if (pin.lat > maxLat) maxLat = pin.lat;
            if (pin.lng < minLng) minLng = pin.lng;
            if (pin.lng > maxLng) maxLng = pin.lng;
          }
        }
        if (minLat <= maxLat && minLng <= maxLng) {
          bounds = {
            sw: { lat: minLat, lng: minLng },
            ne: { lat: maxLat, lng: maxLng },
          };
        }
      } else if (dataResult.length > 0) {
        // Fallback: compute bounds from paginated data
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (const row of dataResult) {
          const lat = parseFloat(row.latitude);
          const lng = parseFloat(row.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
          }
        }
        if (minLat <= maxLat && minLng <= maxLng) {
          bounds = {
            sw: { lat: minLat, lng: minLng },
            ne: { lat: maxLat, lng: maxLng },
          };
        }
      }

      // ─── Format response ─────────────────────────────────────────
      // Photos and open houses are already embedded in each row via
      // correlated subqueries in SELECT_FIELDS — no separate queries needed.
      const t1 = performance.now();

      const data = dataResult.map((row: any) => formatSearchResult(row));

      const t2 = performance.now();

      const response: any = {
        data,
        metadata: {
          total_listings_count: totalListingsCount,
          filtered_listings_count: filteredCount,
          current_page: params.page,
          total_pages: totalPages,
          items_per_page: itemsPerPage,
          sort_by: params.sort_by,
          sort_direction: params.sort_direction,
          bounds,
        },
      };

      // Include map_pins only when requested (keeps backward compatibility)
      if (shouldFetchMapPins) {
        response.map_pins = mapPins || [];
        response.metadata.map_pins_count = mapPins ? mapPins.length : 0;
        response.metadata.map_pins_truncated = mapPinsTruncated;
      }

      // ─── Server-Timing header for performance diagnostics ─────────
      const t3 = performance.now();
      reply.header('Server-Timing',
        `db;dur=${(t1 - t0).toFixed(0)}, format;dur=${(t2 - t1).toFixed(0)}, total;dur=${(t3 - t0).toFixed(0)}`
      );

      return response;
    } catch (err: any) {
      request.log.error(err, 'Search error');
      return reply.status(500).send({
        error: {
          code: 'SEARCH_ERROR',
          message: 'An error occurred while searching listings',
          details: env.NODE_ENV === 'development' ? err.message : undefined,
        },
      });
    }
  });
}
