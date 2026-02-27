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

  // Named neighborhood (supports comma-separated slugs for multi-select)
  if (params.neighborhood) {
    const slugs = params.neighborhood.split(',').map(s => s.trim()).filter(Boolean);
    if (slugs.length === 1) {
      filters.push(
        sql`ST_Within(p.geog::geometry, (SELECT geom FROM neighborhoods WHERE slug = ${slugs[0]} LIMIT 1))`
      );
    } else {
      filters.push(
        sql`ST_Within(p.geog::geometry, (SELECT ST_Union(geom) FROM neighborhoods WHERE slug = ANY(${slugs})))`
      );
    }
  }

  // City (supports comma-separated cities for multi-select)
  if (params.city) {
    const cities = params.city.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    if (cities.length === 1) {
      filters.push(sql`LOWER(p.city) = LOWER(${cities[0]})`);
    } else {
      filters.push(sql`LOWER(p.city) IN ${sql(cities)}`);
    }
  }

  // ZIP code (supports comma-separated ZIPs for multi-select)
  if (params.zip_code) {
    const zips = params.zip_code.split(',').map(z => z.trim()).filter(Boolean);
    if (zips.length === 1) {
      filters.push(sql`p.postal_code = ${zips[0]}`);
    } else {
      filters.push(sql`p.postal_code IN ${sql(zips)}`);
    }
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

  // Price
  if (params.min_price !== undefined) filters.push(sql`p.list_price::numeric >= ${params.min_price}`);
  if (params.max_price !== undefined) filters.push(sql`p.list_price::numeric <= ${params.max_price}`);

  // Bedrooms
  if (params.min_bedrooms !== undefined) filters.push(sql`p.bedrooms_total::numeric >= ${params.min_bedrooms}`);
  if (params.max_bedrooms !== undefined) filters.push(sql`p.bedrooms_total::numeric <= ${params.max_bedrooms}`);

  // Bathrooms
  if (params.min_bathrooms !== undefined) filters.push(sql`p.bathrooms_total::numeric >= ${params.min_bathrooms}`);
  if (params.max_bathrooms !== undefined) filters.push(sql`p.bathrooms_total::numeric <= ${params.max_bathrooms}`);

  // Square footage
  if (params.min_sqft !== undefined) filters.push(sql`p.living_area::numeric >= ${params.min_sqft}`);
  if (params.max_sqft !== undefined) filters.push(sql`p.living_area::numeric <= ${params.max_sqft}`);

  // Lot size
  if (params.min_lot_size !== undefined) filters.push(sql`p.lot_size_acres::numeric >= ${params.min_lot_size}`);
  if (params.max_lot_size !== undefined) filters.push(sql`p.lot_size_acres::numeric <= ${params.max_lot_size}`);

  // Year built
  if (params.min_year_built !== undefined) filters.push(sql`p.year_built >= ${params.min_year_built}`);
  if (params.max_year_built !== undefined) filters.push(sql`p.year_built <= ${params.max_year_built}`);

  // Price per sqft
  if (params.min_price_per_sqft !== undefined) {
    filters.push(sql`(p.list_price::numeric / NULLIF(p.living_area::numeric, 0)) >= ${params.min_price_per_sqft}`);
  }
  if (params.max_price_per_sqft !== undefined) {
    filters.push(sql`(p.list_price::numeric / NULLIF(p.living_area::numeric, 0)) <= ${params.max_price_per_sqft}`);
  }

  // Amenities
  if (params.pool === true) filters.push(sql`p.pool_private_yn = true`);
  if (params.garage === true) filters.push(sql`p.garage_spaces::numeric > 0`);
  if (params.min_garage_spaces !== undefined) filters.push(sql`p.garage_spaces::numeric >= ${params.min_garage_spaces}`);
  if (params.max_garage_spaces !== undefined) filters.push(sql`p.garage_spaces::numeric <= ${params.max_garage_spaces}`);
  if (params.min_parking_spaces !== undefined) filters.push(sql`p.parking_total::numeric >= ${params.min_parking_spaces}`);
  if (params.max_parking_spaces !== undefined) filters.push(sql`p.parking_total::numeric <= ${params.max_parking_spaces}`);
  if (params.waterfront === true) filters.push(sql`p.waterfront_yn = true`);
  if (params.fireplace === true) filters.push(sql`p.fireplaces_total::numeric > 0`);
  if (params.new_construction === true) filters.push(sql`p.new_construction_yn = true`);

  // Days on market
  if (params.days_on_market !== undefined) {
    filters.push(sql`p.original_entry_ts >= NOW() - make_interval(days => ${params.days_on_market})`);
  }

  // Price reduction
  if (params.price_reduction) {
    filters.push(sql`p.list_price::numeric < p.original_list_price::numeric`);
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
    case 'list_price': return sql`p.list_price::numeric ${dir}`;
    case 'living_area': return sql`p.living_area::numeric ${dir}`;
    case 'price_per_sqft': return sql`(p.list_price::numeric / NULLIF(p.living_area::numeric, 0)) ${dir}`;
    case 'status': return sql`p.standard_status ${dir}`;
    case 'bedrooms_total': return sql`p.bedrooms_total::numeric ${dir}`;
    case 'bathrooms_total': return sql`p.bathrooms_total::numeric ${dir}`;
    case 'list_date':
    default: return sql`p.original_entry_ts ${dir}`;
  }
}

// ─── Format a raw DB row into the clean search result shape ─────────────────

function formatSearchResult(row: any, photoUrls: any[], nextOpenHouse: any | null) {
  const listPrice = parseFloat(row.list_price) || 0;
  const originalPrice = parseFloat(row.original_list_price) || 0;
  const livingArea = parseFloat(row.living_area) || 0;

  return {
    listing_key: row.listing_key,
    listing_id: row.listing_id,
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
    days_on_market: row.original_entry_ts
      ? Math.floor((Date.now() - new Date(row.original_entry_ts).getTime()) / (1000 * 60 * 60 * 24))
      : null,
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
    id: row.listing_key,
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
  p.listing_key,
  p.latitude,
  p.longitude,
  p.list_price,
  p.standard_status,
  p.bedrooms_total,
  p.bathrooms_total,
  p.property_type
`;

// ─── Select fields ──────────────────────────────────────────────────────────

const SELECT_FIELDS = sql`
  p.listing_key,
  p.listing_id,
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
  p.original_entry_ts
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

      if (hasOpenHouseFilter) {
        // Open house filter requires JOIN — run count + data sequentially
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
        [countResult, dataResult, mapPinsResult] = await Promise.all([
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
          sql`
            SELECT ${MAP_PIN_FIELDS}
            FROM properties p
            WHERE ${whereClause}
              AND p.latitude IS NOT NULL
              AND p.longitude IS NOT NULL
            LIMIT ${MAP_PINS_LIMIT + 1}
          `,
        ]);
      } else {
        // Standard search WITHOUT map pins
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

      const totalResult = await sql`
        SELECT COUNT(*)::int as total FROM properties WHERE mlg_can_view = true AND 'IDX' = ANY(mlg_can_use)
      `;

      const filteredCount = countResult[0].total;
      const totalListingsCount = totalResult[0].total;
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

      // ─── Fetch first 3 photos for each listing ───────────────────
      let photoMap: Record<string, any[]> = {};
      if (dataResult.length > 0) {
        const listingKeys = dataResult.map((r: any) => r.listing_key);
        const photoResults = await sql`
          SELECT DISTINCT ON (listing_key, media_order)
            listing_key, media_order, public_url
          FROM media
          WHERE listing_key = ANY(${listingKeys})
            AND status = 'complete'
            AND public_url IS NOT NULL
          ORDER BY listing_key, media_order ASC NULLS LAST
        `;
        for (const photo of photoResults) {
          if (!photoMap[photo.listing_key]) {
            photoMap[photo.listing_key] = [];
          }
          if (photoMap[photo.listing_key].length < 3) {
            photoMap[photo.listing_key].push({
              order: photo.media_order,
              url: photo.public_url,
            });
          }
        }
      }

      // ─── Fetch next open house for each listing ──────────────────
      let openHouseMap: Record<string, any> = {};
      if (dataResult.length > 0) {
        const listingIds = dataResult.map((r: any) => r.listing_id).filter(Boolean);
        if (listingIds.length > 0) {
          const ohResults = await sql`
            SELECT DISTINCT ON (listing_id)
              listing_id, open_house_date, open_house_start, open_house_end
            FROM open_houses
            WHERE listing_id = ANY(${listingIds})
              AND mlg_can_view = true
              AND open_house_date >= CURRENT_DATE
            ORDER BY listing_id, open_house_start ASC
          `;
          for (const oh of ohResults) {
            openHouseMap[oh.listing_id] = {
              date: oh.open_house_date,
              start_time: oh.open_house_start,
              end_time: oh.open_house_end,
            };
          }
        }
      }

      // ─── Format response ─────────────────────────────────────────
      const data = dataResult.map((row: any) =>
        formatSearchResult(
          row,
          photoMap[row.listing_key] || [],
          openHouseMap[row.listing_id] || null,
        )
      );

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
