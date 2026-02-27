/**
 * GET /api/listings - Single property detail
 * GET /api/listings/batch - Batch property details
 * 
 * Supports lookup by listing_id (listing_key) or address+city.
 * Returns clean, organized JSON with calculated metrics.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/index.js';
import { env } from '../config/env.js';

// ─── Validation Schemas ─────────────────────────────────────────────────────

const detailQuerySchema = z.object({
  listing_id: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
}).refine(
  (data) => data.listing_id || (data.address && data.city),
  { message: 'Must provide either listing_id or both address and city' }
);

const batchQuerySchema = z.object({
  ids: z.string().min(1),
});

// ─── Format a property row into the V2 detail structure ─────────────────────

function formatPropertyDetail(row: any, mediaRows: any[], roomRows: any[], openHouseRows: any[], priceHistoryRows: any[]) {
  const listPrice = parseFloat(row.list_price) || 0;
  const originalPrice = parseFloat(row.original_list_price) || 0;
  const livingArea = parseFloat(row.living_area) || 0;
  const lotAcres = parseFloat(row.lot_size_acres) || 0;
  const taxAnnual = parseFloat(row.local_tax_annual || '0') || 0;
  const hoaFee = parseFloat(row.local_hoa_fee || '0') || 0;

  const pricePerSqft = livingArea > 0 ? Math.round((listPrice / livingArea) * 100) / 100 : null;
  const pricePerAcre = lotAcres > 0 ? Math.round((listPrice / lotAcres) * 100) / 100 : null;
  const priceReduction = originalPrice > listPrice ? originalPrice - listPrice : null;
  const priceReductionPct = priceReduction && originalPrice > 0
    ? Math.round((priceReduction / originalPrice) * 10000) / 100
    : null;

  const daysOnMarket = row.original_entry_ts
    ? Math.floor((Date.now() - new Date(row.original_entry_ts).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Parse local fields for MLS-specific data
  const local = row.local_fields || {};

  return {
    ids: {
      listing_key: row.listing_key,
      listing_id: row.listing_id,
      listing_id_display: row.listing_id_display,
      mls: row.originating_system,
    },
    status: {
      standard_status: row.standard_status,
      mls_status: row.mls_status,
      listing_date: row.listing_contract_date,
      days_on_market: daysOnMarket,
      last_modified: row.modification_ts,
    },
    pricing: {
      current_price: listPrice,
      original_price: originalPrice || null,
      previous_price: parseFloat(row.previous_list_price) || null,
      price_reduction: priceReduction,
      price_reduction_percentage: priceReductionPct,
      price_per_sqft: pricePerSqft,
      last_price_change: row.major_change_ts,
    },
    property_details: {
      type: row.property_sub_type,
      category: row.property_type,
      condition: row.new_construction_yn ? 'New Construction' : (row.property_condition?.[0] || null),
      year_built: row.year_built,
      architectural_style: row.architectural_style,
    },
    location: {
      address: row.unparsed_address,
      street_number: row.street_number,
      street_name: row.street_name,
      street_suffix: row.street_suffix,
      city: row.city,
      state: row.state_or_province,
      zip: row.postal_code,
      county: row.county_or_parish,
      country: row.country,
      subdivision: row.subdivision_name,
      mls_area: row.mls_area_major,
      coordinates: {
        latitude: parseFloat(row.latitude) || null,
        longitude: parseFloat(row.longitude) || null,
      },
    },
    size: {
      living_area_sqft: livingArea || null,
      lot_size_acres: lotAcres || null,
      lot_size_sqft: parseFloat(row.lot_size_sqft) || null,
      stories: row.stories,
    },
    rooms: {
      bedrooms: parseInt(row.bedrooms_total) || null,
      bathrooms_full: parseInt(row.bathrooms_full) || null,
      bathrooms_half: parseInt(row.bathrooms_half) || null,
      bathrooms_total: parseFloat(row.bathrooms_total) || null,
      garage_spaces: parseFloat(row.garage_spaces) || null,
      parking_total: parseFloat(row.parking_total) || null,
    },
    room_list: roomRows.map(r => ({
      type: r.room_type,
      dimensions: r.room_dimensions,
      features: r.room_features,
    })),
    features: {
      interior: row.interior_features || [],
      exterior: row.exterior_features || [],
      construction: row.construction_materials || [],
      roof: row.roof || [],
      foundation: row.foundation_details || [],
      flooring: row.flooring || [],
      windows: row.window_features || [],
      lot: row.lot_features || [],
      fencing: row.fencing || [],
      parking: row.parking_features || [],
      security: row.security_features || [],
      accessibility: [],
      pool: row.pool_private_yn ? (row.pool_features || []) : null,
      fireplace: (parseFloat(row.fireplaces_total) || 0) > 0,
      fireplaces_total: parseInt(row.fireplaces_total) || 0,
      view: row.view || [],
      waterfront: row.waterfront_yn || false,
      waterfront_features: row.waterfront_features || [],
      horse_property: row.horse_yn || false,
      horse_amenities: row.horse_amenities || [],
      patio_porch: row.patio_porch_features || [],
      community: row.community_features || [],
      green_energy: row.green_energy || [],
    },
    systems: {
      cooling: row.cooling || [],
      heating: row.heating || [],
      appliances: row.appliances || [],
      utilities: row.utilities || [],
      water: row.water_source || [],
      sewer: row.sewer || [],
    },
    financial: {
      hoa: {
        required: row.association_yn || false,
      },
      taxes: {
        year: row.tax_year,
        assessed_value: parseFloat(row.tax_assessed_value) || null,
        legal_description: row.tax_legal_desc,
        parcel_number: row.parcel_number,
      },
    },
    schools: {
      elementary: row.elementary_school,
      middle: row.middle_school,
      high: row.high_school,
    },
    description: row.public_remarks,
    directions: row.directions,
    disclosures: row.disclosures || [],
    listing_agent: {
      name: row.list_agent_full_name,
      email: row.list_agent_email,
      phone: row.list_agent_phone,
      mls_id: row.list_agent_mls_id,
      key: row.list_agent_key,
    },
    listing_office: {
      name: row.list_office_name,
      phone: row.list_office_phone,
      mls_id: row.list_office_mls_id,
      key: row.list_office_key,
    },
    media: {
      photo_count: row.photos_count || 0,
      photos_last_updated: row.photos_change_ts,
      virtual_tour: row.virtual_tour_url,
      photos: mediaRows.map(m => ({
        order: m.media_order,
        url: m.public_url,
        content_type: m.content_type,
      })),
    },
    syndication: {
      display_online: row.internet_display_yn,
      allow_avm: row.internet_valuation_yn,
      syndicated_to: row.syndicate_to || [],
    },
    open_houses: openHouseRows.map(oh => ({
      date: oh.open_house_date,
      start_time: oh.open_house_start,
      end_time: oh.open_house_end,
      remarks: oh.open_house_remarks,
    })),
    price_history: priceHistoryRows.map(ph => ({
      old_price: parseFloat(ph.old_price) || null,
      new_price: parseFloat(ph.new_price) || null,
      change_type: ph.change_type,
      timestamp: ph.modification_ts,
    })),
    calculated_metrics: {
      price_per_sqft: pricePerSqft,
      price_per_acre: pricePerAcre,
      days_on_market: daysOnMarket,
    },
    local_fields: local,
  };
}

// ─── Fetch full detail for a single property ────────────────────────────────

async function fetchPropertyDetail(listingKey: string) {
  const [propertyRows, mediaRows, roomRows, openHouseRows, priceHistoryRows] = await Promise.all([
    sql`
      SELECT * FROM properties 
      WHERE listing_key = ${listingKey} 
        AND mlg_can_view = true 
        AND 'IDX' = ANY(mlg_can_use)
      LIMIT 1
    `,
    sql`
      SELECT media_key, public_url, media_order, content_type
      FROM media 
      WHERE listing_key = ${listingKey} 
        AND status = 'complete' 
        AND public_url IS NOT NULL
      ORDER BY media_order ASC NULLS LAST
    `,
    sql`
      SELECT room_type, room_dimensions, room_features
      FROM rooms 
      WHERE listing_key = ${listingKey}
    `,
    sql`
      SELECT open_house_date, open_house_start, open_house_end, open_house_remarks
      FROM open_houses oh
      JOIN properties p ON oh.listing_id = p.listing_id
      WHERE p.listing_key = ${listingKey}
        AND oh.mlg_can_view = true
      ORDER BY oh.open_house_start ASC
    `,
    sql`
      SELECT old_price, new_price, change_type, modification_ts
      FROM price_history
      WHERE listing_key = ${listingKey}
      ORDER BY modification_ts DESC
    `,
  ]);

  if (propertyRows.length === 0) return null;

  return formatPropertyDetail(propertyRows[0], mediaRows, roomRows, openHouseRows, priceHistoryRows);
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

export async function detailRoutes(app: FastifyInstance) {
  // Single property detail
  app.get('/', async (request, reply) => {
    const parseResult = detailQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid parameters. Must provide either listing_id or both address and city.',
      });
    }

    const { listing_id, address, city } = parseResult.data;

    try {
      let listingKey: string | null = null;

      if (listing_id) {
        listingKey = listing_id;
      } else if (address && city) {
        // Address lookup: convert hyphens back to spaces, normalize whitespace
        const addressSearch = address.replace(/-/g, ' ').trim();
        const citySearch = city.replace(/-/g, ' ').trim();
        // Use ILIKE with % for flexible whitespace matching
        const addressPattern = '%' + addressSearch.split(/\s+/).join('%') + '%';

        const result = await sql`
          SELECT listing_key FROM properties
          WHERE unparsed_address ILIKE ${addressPattern}
            AND LOWER(city) = LOWER(${citySearch})
            AND mlg_can_view = true
            AND 'IDX' = ANY(mlg_can_use)
          ORDER BY listing_key
          LIMIT 1
        `;

        if (result.length > 0) {
          listingKey = result[0].listing_key;
        }
      }

      if (!listingKey) {
        return reply.status(404).send({ error: 'Listing not found' });
      }

      const listing = await fetchPropertyDetail(listingKey);
      if (!listing) {
        return reply.status(404).send({ error: 'Listing not found' });
      }

      return { listing };
    } catch (err: any) {
      request.log.error(err, 'Detail error');
      return reply.status(500).send({
        error: 'An error occurred while fetching listing details',
        details: env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });

  // Batch property details
  app.get('/batch', async (request, reply) => {
    const parseResult = batchQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid parameters. Must provide ids query parameter with comma-separated listing IDs.',
      });
    }

    const ids = parseResult.data.ids
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (ids.length === 0) {
      return reply.status(400).send({ error: 'No valid listing IDs provided.' });
    }

    if (ids.length > 50) {
      return reply.status(400).send({ error: 'Batch size exceeds maximum of 50 listings.' });
    }

    try {
      const listings: any[] = [];
      const found: string[] = [];
      const notFound: string[] = [];

      // Fetch all in parallel
      const results = await Promise.all(ids.map(id => fetchPropertyDetail(id)));

      for (let i = 0; i < ids.length; i++) {
        if (results[i]) {
          listings.push(results[i]);
          found.push(ids[i]);
        } else {
          notFound.push(ids[i]);
        }
      }

      return { listings, found, not_found: notFound };
    } catch (err: any) {
      request.log.error(err, 'Batch detail error');
      return reply.status(500).send({
        error: 'An error occurred while fetching batch listing details',
        details: env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
