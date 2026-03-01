/**
 * Database schema definitions for the MLS API.
 *
 * Tables owned by the Replication Worker (read-only for this API):
 *   - properties, media, members, offices, open_houses, rooms, unit_types
 *   - lookups, raw_responses, price_history, status_history, property_change_log
 *   - replication_runs, replication_requests, media_downloads
 *
 * Tables owned by this API server:
 *   - search_areas (polygon boundaries for cities, counties, zipcodes, neighborhoods)
 *   - search_suggestions (materialized view for typeahead)
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  bigserial,
  bigint,
  index,
  unique,
  serial,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Custom PostGIS Types ────────────────────────────────────────────────────

const geography = customType<{ data: string; driverParam: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
});

const geometryMultiPolygon = customType<{ data: string; driverParam: string }>({
  dataType() {
    return 'geometry(MultiPolygon, 4326)';
  },
});

// ─── Properties (owned by Replication Worker — read-only) ────────────────────

export const properties = pgTable('properties', {
  listingKey: varchar('listing_key').primaryKey().notNull(),
  listingId: varchar('listing_id'),
  listingIdDisplay: varchar('listing_id_display'),
  originatingSystem: varchar('originating_system').notNull(),

  // Pricing
  listPrice: numeric('list_price'),
  originalListPrice: numeric('original_list_price'),
  previousListPrice: numeric('previous_list_price'),

  // Status
  standardStatus: varchar('standard_status'),
  mlsStatus: varchar('mls_status'),

  // Property classification
  propertyType: varchar('property_type'),
  propertySubType: varchar('property_sub_type'),

  // Rooms & sizes
  bedroomsTotal: numeric('bedrooms_total'),
  bathroomsTotal: numeric('bathrooms_total'),
  bathroomsFull: numeric('bathrooms_full'),
  bathroomsHalf: numeric('bathrooms_half'),
  livingArea: numeric('living_area'),
  livingAreaSource: varchar('living_area_source'),
  lotSizeAcres: numeric('lot_size_acres'),
  lotSizeSqft: numeric('lot_size_sqft'),
  yearBuilt: integer('year_built'),
  yearBuiltSource: varchar('year_built_source'),
  stories: numeric('stories'),

  // Parking
  garageSpaces: numeric('garage_spaces'),
  parkingTotal: numeric('parking_total'),

  // Features (booleans)
  fireplacesTotal: numeric('fireplaces_total'),
  newConstructionYn: boolean('new_construction_yn'),
  poolPrivateYn: boolean('pool_private_yn'),
  waterfrontYn: boolean('waterfront_yn'),
  horseYn: boolean('horse_yn'),
  associationYn: boolean('association_yn'),

  // Association/HOA details
  associationFee: numeric('association_fee'),
  associationFeeFrequency: varchar('association_fee_frequency'),
  associationName: varchar('association_name'),
  associationFeeIncludes: text('association_fee_includes').array(),
  associationFee2: numeric('association_fee2'),
  associationFee2Frequency: varchar('association_fee2_frequency'),

  // Geography
  geog: geography('geog'),
  latitude: numeric('latitude'),
  longitude: numeric('longitude'),

  // Address
  streetNumber: varchar('street_number'),
  streetName: varchar('street_name'),
  streetSuffix: varchar('street_suffix'),
  unparsedAddress: varchar('unparsed_address'),
  city: varchar('city'),
  stateOrProvince: varchar('state_or_province'),
  postalCode: varchar('postal_code'),
  countyOrParish: varchar('county_or_parish'),
  country: varchar('country'),
  directions: text('directions'),
  subdivisionName: varchar('subdivision_name'),
  mlsAreaMajor: varchar('mls_area_major'),

  // Agent & Office
  listAgentKey: varchar('list_agent_key'),
  listAgentMlsId: varchar('list_agent_mls_id'),
  listAgentFullName: varchar('list_agent_full_name'),
  listAgentEmail: varchar('list_agent_email'),
  listAgentPhone: varchar('list_agent_phone'),
  listOfficeKey: varchar('list_office_key'),
  listOfficeMlsId: varchar('list_office_mls_id'),
  listOfficeName: varchar('list_office_name'),
  listOfficePhone: varchar('list_office_phone'),
  buyerOfficeKey: varchar('buyer_office_key'),

  // Dates
  listingContractDate: date('listing_contract_date'),

  // Remarks
  publicRemarks: text('public_remarks'),
  syndicationRemarks: text('syndication_remarks'),
  virtualTourUrl: varchar('virtual_tour_url'),

  // Display permissions
  internetDisplayYn: boolean('internet_display_yn'),
  internetValuationYn: boolean('internet_valuation_yn'),

  // Schools
  elementarySchool: varchar('elementary_school'),
  middleSchool: varchar('middle_school'),
  highSchool: varchar('high_school'),

  // Tax
  taxAssessedValue: numeric('tax_assessed_value'),
  taxYear: integer('tax_year'),
  taxAnnualAmount: numeric('tax_annual_amount'),
  taxLegalDesc: text('tax_legal_desc'),
  parcelNumber: varchar('parcel_number'),

  // Compensation
  buyerAgencyComp: varchar('buyer_agency_comp'),
  buyerAgencyCompType: varchar('buyer_agency_comp_type'),
  subAgencyComp: varchar('sub_agency_comp'),
  subAgencyCompType: varchar('sub_agency_comp_type'),

  // MLS Grid compliance
  mlgCanView: boolean('mlg_can_view').default(true).notNull(),
  mlgCanUse: text('mlg_can_use').array(),

  // Timestamps
  modificationTs: timestamp('modification_ts', { withTimezone: true, mode: 'string' }).notNull(),
  originatingModTs: timestamp('originating_mod_ts', { withTimezone: true, mode: 'string' }),
  photosChangeTs: timestamp('photos_change_ts', { withTimezone: true, mode: 'string' }),
  photosCount: integer('photos_count'),
  majorChangeTs: timestamp('major_change_ts', { withTimezone: true, mode: 'string' }),
  majorChangeType: varchar('major_change_type'),
  originalEntryTs: timestamp('original_entry_ts', { withTimezone: true, mode: 'string' }),

  // Feature arrays
  appliances: text('appliances').array(),
  architecturalStyle: text('architectural_style').array(),
  basement: text('basement').array(),
  constructionMaterials: text('construction_materials').array(),
  cooling: text('cooling').array(),
  heating: text('heating').array(),
  exteriorFeatures: text('exterior_features').array(),
  interiorFeatures: text('interior_features').array(),
  flooring: text('flooring').array(),
  roof: text('roof').array(),
  sewer: text('sewer').array(),
  waterSource: text('water_source').array(),
  utilities: text('utilities').array(),
  lotFeatures: text('lot_features').array(),
  parkingFeatures: text('parking_features').array(),
  poolFeatures: text('pool_features').array(),
  fencing: text('fencing').array(),
  communityFeatures: text('community_features').array(),
  securityFeatures: text('security_features').array(),
  levels: text('levels').array(),
  view: text('view').array(),
  foundationDetails: text('foundation_details').array(),
  patioPorchFeatures: text('patio_porch_features').array(),
  waterfrontFeatures: text('waterfront_features').array(),
  windowFeatures: text('window_features').array(),
  greenEnergy: text('green_energy').array(),
  horseAmenities: text('horse_amenities').array(),
  specialConditions: text('special_conditions').array(),
  disclosures: text('disclosures').array(),
  propertyCondition: text('property_condition').array(),
  syndicateTo: text('syndicate_to').array(),

  // Local MLS-specific fields
  localFields: jsonb('local_fields'),

  // Record timestamps
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
}, (table) => [
  index('idx_properties_city').using('btree', table.city),
  index('idx_properties_list_price').using('btree', table.listPrice),
  index('idx_properties_property_type').using('btree', table.propertyType),
  index('idx_properties_standard_status').using('btree', table.standardStatus),
  index('idx_properties_status_type_price').using('btree', table.standardStatus, table.propertyType, table.listPrice),
  index('idx_properties_postal_code').using('btree', table.postalCode),
  index('idx_properties_subdivision').using('btree', table.subdivisionName),
  index('idx_properties_modification_ts').using('btree', table.modificationTs),
  unique('properties_listing_id_unique').on(table.listingId),
]);

// ─── Media (owned by Replication Worker — read-only) ─────────────────────────

export const media = pgTable('media', {
  mediaKey: varchar('media_key').primaryKey().notNull(),
  listingKey: varchar('listing_key').notNull(),
  resourceType: varchar('resource_type').notNull(),
  mediaUrlSource: varchar('media_url_source'),
  r2ObjectKey: varchar('r2_object_key').notNull(),
  publicUrl: varchar('public_url'),
  mediaModTs: timestamp('media_mod_ts', { withTimezone: true, mode: 'string' }),
  mediaOrder: integer('media_order'),
  mediaCategory: varchar('media_category'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  contentType: varchar('content_type'),
  status: varchar('status').default('pending_download').notNull(),
  retryCount: integer('retry_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_media_listing_order').using('btree', table.listingKey, table.mediaOrder),
  index('idx_media_resource_type').using('btree', table.resourceType),
  index('idx_media_status').using('btree', table.status),
]);

// ─── Members (owned by Replication Worker — read-only) ───────────────────────

export const members = pgTable('members', {
  memberKey: varchar('member_key').primaryKey().notNull(),
  memberMlsId: varchar('member_mls_id'),
  originatingSystem: varchar('originating_system').notNull(),
  memberFullName: varchar('member_full_name'),
  memberEmail: varchar('member_email'),
  memberPhone: varchar('member_phone'),
  officeKey: varchar('office_key'),
  memberDesignation: text('member_designation').array(),
  photosChangeTs: timestamp('photos_change_ts', { withTimezone: true, mode: 'string' }),
  mlgCanView: boolean('mlg_can_view').default(true).notNull(),
  modificationTs: timestamp('modification_ts', { withTimezone: true, mode: 'string' }).notNull(),
  localFields: jsonb('local_fields'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

// ─── Offices (owned by Replication Worker — read-only) ───────────────────────

export const offices = pgTable('offices', {
  officeKey: varchar('office_key').primaryKey().notNull(),
  officeMlsId: varchar('office_mls_id'),
  originatingSystem: varchar('originating_system').notNull(),
  officeName: varchar('office_name'),
  officePhone: varchar('office_phone'),
  officeEmail: varchar('office_email'),
  officeAddress: varchar('office_address'),
  officeCity: varchar('office_city'),
  officeState: varchar('office_state'),
  officePostalCode: varchar('office_postal_code'),
  photosChangeTs: timestamp('photos_change_ts', { withTimezone: true, mode: 'string' }),
  mlgCanView: boolean('mlg_can_view').default(true).notNull(),
  modificationTs: timestamp('modification_ts', { withTimezone: true, mode: 'string' }).notNull(),
  localFields: jsonb('local_fields'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

// ─── Open Houses (owned by Replication Worker — read-only) ───────────────────

export const openHouses = pgTable('open_houses', {
  openHouseKey: varchar('open_house_key').primaryKey().notNull(),
  listingId: varchar('listing_id').notNull(),
  originatingSystem: varchar('originating_system').notNull(),
  openHouseDate: date('open_house_date'),
  openHouseStart: timestamp('open_house_start', { withTimezone: true, mode: 'string' }),
  openHouseEnd: timestamp('open_house_end', { withTimezone: true, mode: 'string' }),
  openHouseRemarks: text('open_house_remarks'),
  showingAgentKey: varchar('showing_agent_key'),
  mlgCanView: boolean('mlg_can_view').default(true).notNull(),
  modificationTs: timestamp('modification_ts', { withTimezone: true, mode: 'string' }).notNull(),
  localFields: jsonb('local_fields'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

// ─── Rooms (owned by Replication Worker — read-only) ─────────────────────────

export const rooms = pgTable('rooms', {
  roomKey: varchar('room_key').primaryKey().notNull(),
  listingKey: varchar('listing_key').notNull(),
  roomType: varchar('room_type'),
  roomDimensions: varchar('room_dimensions'),
  roomFeatures: text('room_features').array(),
});

// ─── Unit Types (owned by Replication Worker — read-only) ────────────────────

export const unitTypes = pgTable('unit_types', {
  unitTypeKey: varchar('unit_type_key').primaryKey().notNull(),
  listingKey: varchar('listing_key').notNull(),
  unitTypeType: varchar('unit_type_type'),
  unitTypeBeds: integer('unit_type_beds'),
  unitTypeBaths: numeric('unit_type_baths'),
  unitTypeRent: numeric('unit_type_rent'),
});

// ─── Price History (owned by Replication Worker — read-only) ─────────────────

export const priceHistory = pgTable('price_history', {
  id: bigserial({ mode: 'bigint' }).primaryKey().notNull(),
  listingKey: varchar('listing_key').notNull(),
  oldPrice: numeric('old_price'),
  newPrice: numeric('new_price').notNull(),
  changeType: varchar('change_type'),
  modificationTs: timestamp('modification_ts', { withTimezone: true, mode: 'string' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_price_history_listing').using('btree', table.listingKey),
]);

// ─── Status History (owned by Replication Worker — read-only) ────────────────

export const statusHistory = pgTable('status_history', {
  id: bigserial({ mode: 'bigint' }).primaryKey().notNull(),
  listingKey: varchar('listing_key').notNull(),
  oldStatus: varchar('old_status'),
  newStatus: varchar('new_status').notNull(),
  modificationTs: timestamp('modification_ts', { withTimezone: true, mode: 'string' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_status_history_listing').using('btree', table.listingKey),
]);

// ─── Search Areas (owned by API server) ──────────────────────────────────────
// Stores polygon boundaries for named geographic areas used in search.
// type: 'city' | 'county' | 'zipcode' | 'neighborhood'

export const searchAreas = pgTable('search_areas', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  slug: varchar('slug').notNull(),
  type: varchar('type').notNull().default('neighborhood'), // 'city' | 'county' | 'zipcode' | 'neighborhood' | 'school_district'
  source: varchar('source'),
  sqMiles: numeric('sq_miles'),
  geom: geometryMultiPolygon('geom'),
  centroidLat: numeric('centroid_lat'),
  centroidLng: numeric('centroid_lng'),
  listingCount: integer('listing_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
  index('idx_search_areas_slug').using('btree', table.slug),
  index('idx_search_areas_type').using('btree', table.type),
  index('idx_search_areas_type_listing_count').using('btree', table.type, table.listingCount),
  unique('search_areas_type_slug_unique').on(table.type, table.slug),
]);

// ─── Search Suggestions (owned by API server) ───────────────────────────────

export const searchSuggestions = pgTable('search_suggestions', {
  id: serial('id').primaryKey(),
  label: varchar('label').notNull(),           // Display text shown in the dropdown
  matchText: varchar('match_text'),             // Text used for trigram matching (street address only for addresses)
  type: varchar('type').notNull(), // 'address' | 'city' | 'zip' | 'county' | 'subdivision' | 'neighborhood' | 'school_district'
  searchValue: varchar('search_value'),
  searchParam: varchar('search_param'), // query param name: 'city' | 'zip_code' | 'county' | 'neighborhood' | 'keywords'
  hasPolygon: boolean('has_polygon').default(false), // true = polygon-backed (can fetch GeoJSON boundary)
  latitude: numeric('latitude'),
  longitude: numeric('longitude'),
  listingCount: integer('listing_count'),
  priority: integer('priority').default(0),
}, (table) => [
  index('idx_suggestions_type').using('btree', table.type),
  index('idx_suggestions_label_trgm').using('gin', table.label),
  index('idx_suggestions_match_text_trgm').using('gin', table.matchText),
  // NOTE: Additional indexes created in migrate.ts (not expressible in Drizzle):
  //   idx_suggestions_coalesce_trgm  — GIN gin_trgm_ops on COALESCE(match_text, label)
  //   idx_suggestions_type_priority  — btree (type, priority DESC, listing_count DESC)
]);

// ─── Relations ───────────────────────────────────────────────────────────────

export const propertiesRelations = relations(properties, ({ many }) => ({
  rooms: many(rooms),
  unitTypes: many(unitTypes),
}));

export const roomsRelations = relations(rooms, ({ one }) => ({
  property: one(properties, {
    fields: [rooms.listingKey],
    references: [properties.listingKey],
  }),
}));

export const unitTypesRelations = relations(unitTypes, ({ one }) => ({
  property: one(properties, {
    fields: [unitTypes.listingKey],
    references: [properties.listingKey],
  }),
}));
