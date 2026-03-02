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
import { calcDaysOnMarket } from '../utils/dates.js';

// ─── Validation Schemas ─────────────────────────────────────────────────────

const detailQuerySchema = z.object({
  listing_id: z.string().optional(),   // MLS display ID (e.g., "1234567") — public-facing
  listing_key: z.string().optional(),  // Internal listing key — for backward compatibility
  address: z.string().optional(),
  city: z.string().optional(),
}).refine(
  (data) => data.listing_id || data.listing_key || (data.address && data.city),
  { message: 'Must provide listing_id, listing_key, or both address and city' }
);

const batchQuerySchema = z.object({
  ids: z.string().min(1),
});

// ─── Helper: compute "back on market" from status history ────────────────────

function deriveBackOnMarket(statusHistoryRows: any[]): { back_on_market: boolean; back_on_market_date: string | null } {
  // Status history is ordered DESC (newest first). Look for any transition
  // FROM a contract status (Pending, Active Under Contract) TO Active.
  const contractStatuses = ['Pending', 'Active Under Contract'];
  for (const sh of statusHistoryRows) {
    if (
      sh.new_status === 'Active' &&
      contractStatuses.includes(sh.old_status)
    ) {
      return { back_on_market: true, back_on_market_date: sh.modification_ts };
    }
  }
  return { back_on_market: false, back_on_market_date: null };
}

// ─── Helper: enrich price history with calculated fields ─────────────────────

function enrichPriceHistory(priceHistoryRows: any[]) {
  // Rows are ordered DESC (newest first). We process them to add:
  // - change_amount, change_percentage per entry
  // - days_at_previous_price (time between consecutive changes)
  // - summary stats

  const enriched = priceHistoryRows.map((ph, i) => {
    const oldPrice = parseFloat(ph.old_price) || null;
    const newPrice = parseFloat(ph.new_price) || null;
    const changeAmount = oldPrice !== null && newPrice !== null ? newPrice - oldPrice : null;
    const changePct = oldPrice && changeAmount !== null
      ? Math.round((changeAmount / oldPrice) * 10000) / 100
      : null;

    // days_at_previous_price: time between this change and the next (older) one
    let daysAtPreviousPrice: number | null = null;
    if (i < priceHistoryRows.length - 1) {
      const thisDate = new Date(ph.modification_ts);
      const olderDate = new Date(priceHistoryRows[i + 1].modification_ts);
      const diffMs = thisDate.getTime() - olderDate.getTime();
      daysAtPreviousPrice = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }

    return {
      old_price: oldPrice,
      new_price: newPrice,
      change_amount: changeAmount,
      change_percentage: changePct,
      change_type: ph.change_type,
      days_at_previous_price: daysAtPreviousPrice,
      timestamp: ph.modification_ts,
    };
  });

  // Summary stats
  const totalChanges = enriched.length;
  const firstPrice = totalChanges > 0 ? (enriched[enriched.length - 1].new_price ?? enriched[enriched.length - 1].old_price) : null;
  const latestPrice = totalChanges > 0 ? enriched[0].new_price : null;
  const totalReductionFromOriginal = firstPrice && latestPrice ? latestPrice - firstPrice : null;
  const totalReductionPct = firstPrice && totalReductionFromOriginal !== null && firstPrice > 0
    ? Math.round((totalReductionFromOriginal / firstPrice) * 10000) / 100
    : null;

  // Average days between changes
  const daysValues = enriched
    .map(e => e.days_at_previous_price)
    .filter((d): d is number => d !== null);
  const avgDaysBetweenChanges = daysValues.length > 0
    ? Math.round(daysValues.reduce((a, b) => a + b, 0) / daysValues.length)
    : null;

  return {
    summary: {
      total_changes: totalChanges,
      net_change_from_first: totalReductionFromOriginal,
      net_change_percentage: totalReductionPct,
      avg_days_between_changes: avgDaysBetweenChanges,
    },
    entries: enriched,
  };
}

// ─── Helper: enrich status history with days_in_status ───────────────────────

function enrichStatusHistory(statusHistoryRows: any[]) {
  // Rows are ordered DESC (newest first). Calculate days_in_status as the
  // time between consecutive status changes.
  return statusHistoryRows.map((sh, i) => {
    let daysInStatus: number | null = null;
    if (i === 0) {
      // Most recent status — days from this change to now
      const changeDate = new Date(sh.modification_ts);
      const now = new Date();
      daysInStatus = Math.max(0, Math.round((now.getTime() - changeDate.getTime()) / (1000 * 60 * 60 * 24)));
    } else {
      // Older statuses — days from this change to the next (newer) one
      const thisDate = new Date(sh.modification_ts);
      const newerDate = new Date(statusHistoryRows[i - 1].modification_ts);
      daysInStatus = Math.max(0, Math.round((newerDate.getTime() - thisDate.getTime()) / (1000 * 60 * 60 * 24)));
    }

    return {
      old_status: sh.old_status,
      new_status: sh.new_status,
      days_in_status: daysInStatus,
      timestamp: sh.modification_ts,
    };
  });
}

// ─── Helper: normalize HOA fee to monthly amount ─────────────────────────────

function normalizeToMonthly(fee: number, frequency: string | null): number | null {
  if (fee <= 0) return null;
  switch ((frequency || '').toLowerCase()) {
    case 'monthly': return Math.round(fee * 100) / 100;
    case 'quarterly': return Math.round((fee / 3) * 100) / 100;
    case 'semi-annually': return Math.round((fee / 6) * 100) / 100;
    case 'annually': return Math.round((fee / 12) * 100) / 100;
    default: return Math.round(fee * 100) / 100; // assume monthly if unspecified
  }
}

// ─── Helper: derive story count from levels array ────────────────────────────

function deriveStoriesFromLevels(levels: string[] | null): number | null {
  if (!levels || levels.length === 0) return null;
  const levelMap: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'multi/split': 2, 'split level': 2, 'tri-level': 3,
  };
  const first = levels[0]?.toLowerCase();
  return levelMap[first] ?? levels.length;
}

// ─── Helper: extract structured rental details from local_fields ─────────────

function extractRentalDetails(local: any): any | null {
  // Only return rental details if there's meaningful rental data
  const securityDeposit = local.ACT_SecurityDeposit;
  if (securityDeposit === undefined && !local.ACT_MinLeaseMonths && !local.ACT_MaxLeaseMonths) {
    return null;
  }

  const maxPets = parseInt(local.ACT_MaxNumofPets) || 0;
  const petDeposit = parseFloat(local.ACT_PetDeposit) || null;
  const additionalPetFee = parseFloat(local.ACT_AdditionalPetFee) || null;
  const perPet = local.ACT_PerPetYN === '1' || local.ACT_PerPetYN === true;

  return {
    security_deposit: parseFloat(securityDeposit) || null,
    lease_terms: {
      min_months: parseInt(local.ACT_MinLeaseMonths) || null,
      max_months: parseInt(local.ACT_MaxLeaseMonths) || null,
    },
    pets: {
      allowed: maxPets > 0,
      max_number: maxPets || null,
      deposit: petDeposit,
      monthly_pet_rent: additionalPetFee,
      deposit_per_pet: perPet,
    },
    smoking_allowed: local.ACT_SmokingInsideYN === '1' || local.ACT_SmokingInsideYN === true,
    housing_vouchers_accepted: local.ACT_HousingVouchersYN === '1' || local.ACT_HousingVouchersYN === true,
    laundry_location: local.ACT_LaundryLocation
      ? local.ACT_LaundryLocation.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [],
    unit_style: local.ACT_UnitStyle
      ? local.ACT_UnitStyle.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [],
    meter_description: local.ACT_MeterDescription
      ? local.ACT_MeterDescription.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [],
    complex_name: local.ACT_ComplexName || null,
    management_company: local.ACT_ManagementCompany || null,
    home_office: local.ACT_HomeOfficeYN === '1' || local.ACT_HomeOfficeYN === true || null,
    guest_accommodation: local.ACT_GuestAccommodatonDesc || null,
    num_living_areas: parseInt(local.ACT_NumLiving) || null,
    application: {
      rentspree_url: local.ACT_RentSpreeURL || null,
      online_app_url: local.ACT_OnlineAppInstructionsPublic || null,
    },
    flood_plain: local.ACT_FEMAFloodPlain || null,
  };
}

// ─── Format a property row into the V2 detail structure ─────────────────────

function formatPropertyDetail(
  row: any,
  mediaRows: any[],
  roomRows: any[],
  openHouseRows: any[],
  priceHistoryRows: any[],
  statusHistoryRows: any[],
) {
  const listPrice = parseFloat(row.list_price) || 0;
  const originalPrice = parseFloat(row.original_list_price) || 0;
  const livingArea = parseFloat(row.living_area) || 0;
  const lotAcres = parseFloat(row.lot_size_acres) || 0;

  const pricePerSqft = livingArea > 0 ? Math.round((listPrice / livingArea) * 100) / 100 : null;
  const pricePerAcre = lotAcres > 0 ? Math.round((listPrice / lotAcres) * 100) / 100 : null;
  const priceReduction = originalPrice > listPrice ? originalPrice - listPrice : null;
  const priceReductionPct = priceReduction && originalPrice > 0
    ? Math.round((priceReduction / originalPrice) * 10000) / 100
    : null;

  const daysOnMarket = calcDaysOnMarket(row.original_entry_ts);

  // Derive back-on-market flag from status history
  const backOnMarket = deriveBackOnMarket(statusHistoryRows);

  // Enrich price history with calculated fields
  const enrichedPriceHistory = enrichPriceHistory(priceHistoryRows);

  // Enrich status history with days_in_status
  const enrichedStatusHistory = enrichStatusHistory(statusHistoryRows);

  // Parse local fields for MLS-specific data
  const local = row.local_fields || {};

  // Extract structured rental details (only for lease listings)
  const isLease = (row.property_type || '').toLowerCase().includes('lease');
  const rentalDetails = isLease ? extractRentalDetails(local) : null;

  return {
    ids: {
      listing_id: row.listing_id_display || row.listing_id,
      mls: row.originating_system,
    },
    status: {
      standard_status: row.standard_status,
      mls_status: row.mls_status,
      listing_date: row.listing_contract_date,
      days_on_market: daysOnMarket,
      last_modified: row.modification_ts,
      back_on_market: backOnMarket.back_on_market,
      back_on_market_date: backOnMarket.back_on_market_date,
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
      stories: parseFloat(row.stories) || deriveStoriesFromLevels(row.levels),
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
        fee: parseFloat(row.association_fee) || null,
        fee_frequency: row.association_fee_frequency || null,
        fee_monthly: normalizeToMonthly(
          parseFloat(row.association_fee) || 0,
          row.association_fee_frequency,
        ),
        name: row.association_name || null,
        includes: row.association_fee_includes || [],
        fee2: parseFloat(row.association_fee2) || null,
        fee2_frequency: row.association_fee2_frequency || null,
      },
      taxes: {
        year: row.tax_year,
        assessed_value: parseFloat(row.tax_assessed_value) || null,
        annual_amount: parseFloat(row.tax_annual_amount) || null,
        monthly_amount: parseFloat(row.tax_annual_amount)
          ? Math.round((parseFloat(row.tax_annual_amount) / 12) * 100) / 100
          : null,
        tax_rate: (parseFloat(row.tax_annual_amount) && parseFloat(row.tax_assessed_value))
          ? Math.round((parseFloat(row.tax_annual_amount) / parseFloat(row.tax_assessed_value)) * 10000) / 100
          : null,
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
    price_history: enrichedPriceHistory,
    status_history: enrichedStatusHistory,
    calculated_metrics: {
      price_per_sqft: pricePerSqft,
      price_per_acre: pricePerAcre,
      days_on_market: daysOnMarket,
    },
    rental_details: rentalDetails,
    local_fields: local,
  };
}

// ─── Fetch full detail for a single property ────────────────────────────────

async function fetchPropertyDetail(listingKey: string) {
  const [propertyRows, mediaRows, roomRows, openHouseRows, priceHistoryRows, statusHistoryRows] = await Promise.all([
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
    sql`
      SELECT old_status, new_status, modification_ts
      FROM status_history
      WHERE listing_key = ${listingKey}
      ORDER BY modification_ts DESC
    `,
  ]);

  if (propertyRows.length === 0) return null;

  return formatPropertyDetail(propertyRows[0], mediaRows, roomRows, openHouseRows, priceHistoryRows, statusHistoryRows);
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

    const { listing_id, listing_key, address, city } = parseResult.data;

    try {
      let listingKey: string | null = null;

      if (listing_key) {
        // Direct listing_key lookup (internal/backward-compatible)
        listingKey = listing_key;
      } else if (listing_id) {
        // Resolve listing_id_display → listing_key
        const result = await sql`
          SELECT listing_key FROM properties
          WHERE listing_id_display = ${listing_id}
            AND mlg_can_view = true
            AND 'IDX' = ANY(mlg_can_use)
          LIMIT 1
        `;
        if (result.length > 0) {
          listingKey = result[0].listing_key;
        } else {
          // Fallback: try as listing_key directly (backward compatibility)
          listingKey = listing_id;
        }
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
      // ─── Resolve listing_id_display → listing_key for each ID ───────────
      // IDs may be listing_id_display values (public-facing) or listing_key
      // values (internal). Bulk-resolve display IDs first, then fall back to
      // treating unresolved ones as listing_key directly.
      const resolved = await sql`
        SELECT listing_id_display, listing_key FROM properties
        WHERE listing_id_display = ANY(${ids})
          AND mlg_can_view = true
          AND 'IDX' = ANY(mlg_can_use)
      `;

      const displayToKey = new Map<string, string>();
      for (const r of resolved) {
        displayToKey.set(r.listing_id_display, r.listing_key);
      }

      // Map each input ID to a listing_key (resolved display ID or fallback)
      const resolvedKeys = ids.map(id => displayToKey.get(id) ?? id);

      const listings: any[] = [];
      const found: string[] = [];
      const notFound: string[] = [];

      // Fetch all in parallel
      const results = await Promise.all(resolvedKeys.map(key => fetchPropertyDetail(key)));

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

  // ─── Resolve listing_key → listing_id_display ───────────────────────────────
  // Lightweight endpoint for converting internal keys to display IDs.
  // Supports single key or comma-separated batch (up to 100).
  //
  // GET /api/listings/resolve?keys=abc123
  // GET /api/listings/resolve?keys=abc123,def456,ghi789
  app.get('/resolve', async (request, reply) => {
    const { keys } = request.query as { keys?: string };

    if (!keys) {
      return reply.status(400).send({
        error: 'Query parameter "keys" is required (comma-separated listing_key values)',
      });
    }

    const keyList = keys.split(',').map(k => k.trim()).filter(Boolean);

    if (keyList.length === 0) {
      return reply.status(400).send({ error: 'No valid listing keys provided.' });
    }

    if (keyList.length > 100) {
      return reply.status(400).send({ error: 'Batch size exceeds maximum of 100 keys.' });
    }

    try {
      const results = await sql`
        SELECT listing_key, listing_id_display
        FROM properties
        WHERE listing_key = ANY(${keyList})
          AND mlg_can_view = true
      `;

      const resolved: Record<string, string | null> = {};
      for (const key of keyList) {
        const match = results.find((r: any) => r.listing_key === key);
        resolved[key] = match?.listing_id_display ?? null;
      }

      return { resolved };
    } catch (err: any) {
      request.log.error(err, 'Resolve error');
      return reply.status(500).send({
        error: 'An error occurred while resolving listing keys',
        details: env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
