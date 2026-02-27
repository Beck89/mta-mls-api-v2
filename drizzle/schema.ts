import { pgTable, check, integer, varchar, unique, text, timestamp, boolean, jsonb, date, index, bigserial, numeric, bigint, foreignKey, pgView } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const spatialRefSys = pgTable("spatial_ref_sys", {
	srid: integer().primaryKey().notNull(),
	authName: varchar("auth_name", { length: 256 }),
	authSrid: integer("auth_srid"),
	srtext: varchar({ length: 2048 }),
	proj4Text: varchar({ length: 2048 }),
}, (table) => [
	check("spatial_ref_sys_srid_check", sql`(srid > 0) AND (srid <= 998999)`),
]);

export const members = pgTable("members", {
	memberKey: varchar("member_key").primaryKey().notNull(),
	memberMlsId: varchar("member_mls_id"),
	originatingSystem: varchar("originating_system").notNull(),
	memberFullName: varchar("member_full_name"),
	memberEmail: varchar("member_email"),
	memberPhone: varchar("member_phone"),
	officeKey: varchar("office_key"),
	memberDesignation: text("member_designation").array(),
	photosChangeTs: timestamp("photos_change_ts", { withTimezone: true, mode: 'string' }),
	mlgCanView: boolean("mlg_can_view").default(true).notNull(),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	localFields: jsonb("local_fields"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("members_member_mls_id_unique").on(table.memberMlsId),
]);

export const offices = pgTable("offices", {
	officeKey: varchar("office_key").primaryKey().notNull(),
	officeMlsId: varchar("office_mls_id"),
	originatingSystem: varchar("originating_system").notNull(),
	officeName: varchar("office_name"),
	officePhone: varchar("office_phone"),
	officeEmail: varchar("office_email"),
	officeAddress: varchar("office_address"),
	officeCity: varchar("office_city"),
	officeState: varchar("office_state"),
	officePostalCode: varchar("office_postal_code"),
	photosChangeTs: timestamp("photos_change_ts", { withTimezone: true, mode: 'string' }),
	mlgCanView: boolean("mlg_can_view").default(true).notNull(),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	localFields: jsonb("local_fields"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("offices_office_mls_id_unique").on(table.officeMlsId),
]);

export const openHouses = pgTable("open_houses", {
	openHouseKey: varchar("open_house_key").primaryKey().notNull(),
	listingId: varchar("listing_id").notNull(),
	originatingSystem: varchar("originating_system").notNull(),
	openHouseDate: date("open_house_date"),
	openHouseStart: timestamp("open_house_start", { withTimezone: true, mode: 'string' }),
	openHouseEnd: timestamp("open_house_end", { withTimezone: true, mode: 'string' }),
	openHouseRemarks: text("open_house_remarks"),
	showingAgentKey: varchar("showing_agent_key"),
	mlgCanView: boolean("mlg_can_view").default(true).notNull(),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	localFields: jsonb("local_fields"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const lookups = pgTable("lookups", {
	lookupKey: varchar("lookup_key").primaryKey().notNull(),
	lookupName: varchar("lookup_name").notNull(),
	lookupValue: varchar("lookup_value").notNull(),
	standardLookupValue: varchar("standard_lookup_value"),
	originatingSystem: varchar("originating_system").notNull(),
	mlgCanView: boolean("mlg_can_view").default(true).notNull(),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_lookups_system_name").using("btree", table.originatingSystem.asc().nullsLast().op("text_ops"), table.lookupName.asc().nullsLast().op("text_ops")),
]);

export const rawResponses = pgTable("raw_responses", {
	listingKey: varchar("listing_key").primaryKey().notNull(),
	rawData: jsonb("raw_data").notNull(),
	originatingSystem: varchar("originating_system").notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const priceHistory = pgTable("price_history", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	listingKey: varchar("listing_key").notNull(),
	oldPrice: numeric("old_price"),
	newPrice: numeric("new_price").notNull(),
	changeType: varchar("change_type"),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_price_history_listing").using("btree", table.listingKey.asc().nullsLast().op("text_ops")),
	index("idx_price_history_recorded").using("btree", table.recordedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const propertyChangeLog = pgTable("property_change_log", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	listingKey: varchar("listing_key").notNull(),
	fieldName: varchar("field_name").notNull(),
	oldValue: text("old_value"),
	newValue: text("new_value"),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_change_log_listing_field").using("btree", table.listingKey.asc().nullsLast().op("text_ops"), table.fieldName.asc().nullsLast().op("text_ops")),
	index("idx_change_log_recorded").using("btree", table.recordedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const statusHistory = pgTable("status_history", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	listingKey: varchar("listing_key").notNull(),
	oldStatus: varchar("old_status"),
	newStatus: varchar("new_status").notNull(),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_status_history_listing").using("btree", table.listingKey.asc().nullsLast().op("text_ops")),
	index("idx_status_history_recorded").using("btree", table.recordedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const mediaDownloads = pgTable("media_downloads", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	runId: bigint("run_id", { mode: "number" }),
	mediaKey: varchar("media_key").notNull(),
	listingKey: varchar("listing_key").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
	downloadTimeMs: integer("download_time_ms"),
	r2UploadTimeMs: integer("r2_upload_time_ms"),
	status: varchar().notNull(),
	errorMessage: text("error_message"),
	downloadedAt: timestamp("downloaded_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_media_downloads_at").using("btree", table.downloadedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_media_downloads_run").using("btree", table.runId.asc().nullsLast().op("int8_ops")),
]);

export const replicationRequests = pgTable("replication_requests", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	runId: bigint("run_id", { mode: "number" }).notNull(),
	requestUrl: text("request_url").notNull(),
	httpStatus: integer("http_status"),
	responseTimeMs: integer("response_time_ms"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	responseBytes: bigint("response_bytes", { mode: "number" }),
	recordsReturned: integer("records_returned"),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).notNull(),
	errorMessage: text("error_message"),
}, (table) => [
	index("idx_repl_requests_at").using("btree", table.requestedAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_repl_requests_run").using("btree", table.runId.asc().nullsLast().op("int8_ops")),
]);

export const replicationRuns = pgTable("replication_runs", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	resourceType: varchar("resource_type").notNull(),
	runMode: varchar("run_mode").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	status: varchar().notNull(),
	errorMessage: text("error_message"),
	hwmStart: timestamp("hwm_start", { withTimezone: true, mode: 'string' }),
	hwmEnd: timestamp("hwm_end", { withTimezone: true, mode: 'string' }),
	totalRecordsReceived: integer("total_records_received").default(0),
	recordsInserted: integer("records_inserted").default(0),
	recordsUpdated: integer("records_updated").default(0),
	recordsDeleted: integer("records_deleted").default(0),
	mediaDownloaded: integer("media_downloaded").default(0),
	mediaDeleted: integer("media_deleted").default(0),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	mediaBytesDownloaded: bigint("media_bytes_downloaded", { mode: "number" }).default(0),
	apiRequestsMade: integer("api_requests_made").default(0),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	apiBytesDownloaded: bigint("api_bytes_downloaded", { mode: "number" }).default(0),
	avgResponseTimeMs: integer("avg_response_time_ms"),
	httpErrors: jsonb("http_errors"),
});

export const media = pgTable("media", {
	mediaKey: varchar("media_key").primaryKey().notNull(),
	listingKey: varchar("listing_key").notNull(),
	resourceType: varchar("resource_type").notNull(),
	mediaUrlSource: varchar("media_url_source"),
	r2ObjectKey: varchar("r2_object_key").notNull(),
	publicUrl: varchar("public_url"),
	mediaModTs: timestamp("media_mod_ts", { withTimezone: true, mode: 'string' }),
	mediaOrder: integer("media_order"),
	mediaCategory: varchar("media_category"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
	contentType: varchar("content_type"),
	status: varchar().default('pending_download').notNull(),
	retryCount: integer("retry_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_media_listing_order").using("btree", table.listingKey.asc().nullsLast().op("int4_ops"), table.mediaOrder.asc().nullsLast().op("int4_ops")),
	index("idx_media_resource_type").using("btree", table.resourceType.asc().nullsLast().op("text_ops")),
	index("idx_media_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const rooms = pgTable("rooms", {
	roomKey: varchar("room_key").primaryKey().notNull(),
	listingKey: varchar("listing_key").notNull(),
	roomType: varchar("room_type"),
	roomDimensions: varchar("room_dimensions"),
	roomFeatures: text("room_features").array(),
}, (table) => [
	foreignKey({
			columns: [table.listingKey],
			foreignColumns: [properties.listingKey],
			name: "rooms_listing_key_properties_listing_key_fk"
		}).onDelete("cascade"),
]);

export const unitTypes = pgTable("unit_types", {
	unitTypeKey: varchar("unit_type_key").primaryKey().notNull(),
	listingKey: varchar("listing_key").notNull(),
	unitTypeType: varchar("unit_type_type"),
	unitTypeBeds: integer("unit_type_beds"),
	unitTypeBaths: numeric("unit_type_baths"),
	unitTypeRent: numeric("unit_type_rent"),
}, (table) => [
	foreignKey({
			columns: [table.listingKey],
			foreignColumns: [properties.listingKey],
			name: "unit_types_listing_key_properties_listing_key_fk"
		}).onDelete("cascade"),
]);

export const properties = pgTable("properties", {
	listingKey: varchar("listing_key").primaryKey().notNull(),
	listingId: varchar("listing_id"),
	listingIdDisplay: varchar("listing_id_display"),
	originatingSystem: varchar("originating_system").notNull(),
	listPrice: numeric("list_price"),
	originalListPrice: numeric("original_list_price"),
	previousListPrice: numeric("previous_list_price"),
	standardStatus: varchar("standard_status"),
	mlsStatus: varchar("mls_status"),
	propertyType: varchar("property_type"),
	propertySubType: varchar("property_sub_type"),
	bedroomsTotal: numeric("bedrooms_total"),
	bathroomsTotal: numeric("bathrooms_total"),
	bathroomsFull: numeric("bathrooms_full"),
	bathroomsHalf: numeric("bathrooms_half"),
	livingArea: numeric("living_area"),
	livingAreaSource: varchar("living_area_source"),
	lotSizeAcres: numeric("lot_size_acres"),
	lotSizeSqft: numeric("lot_size_sqft"),
	yearBuilt: integer("year_built"),
	yearBuiltSource: varchar("year_built_source"),
	stories: numeric(),
	garageSpaces: numeric("garage_spaces"),
	parkingTotal: numeric("parking_total"),
	fireplacesTotal: numeric("fireplaces_total"),
	newConstructionYn: boolean("new_construction_yn"),
	poolPrivateYn: boolean("pool_private_yn"),
	waterfrontYn: boolean("waterfront_yn"),
	horseYn: boolean("horse_yn"),
	associationYn: boolean("association_yn"),
	// TODO: failed to parse database type 'geography'
	geog: unknown("geog"),
	latitude: numeric(),
	longitude: numeric(),
	streetNumber: varchar("street_number"),
	streetName: varchar("street_name"),
	streetSuffix: varchar("street_suffix"),
	unparsedAddress: varchar("unparsed_address"),
	city: varchar(),
	stateOrProvince: varchar("state_or_province"),
	postalCode: varchar("postal_code"),
	countyOrParish: varchar("county_or_parish"),
	country: varchar(),
	directions: text(),
	subdivisionName: varchar("subdivision_name"),
	mlsAreaMajor: varchar("mls_area_major"),
	listAgentKey: varchar("list_agent_key"),
	listAgentMlsId: varchar("list_agent_mls_id"),
	listAgentFullName: varchar("list_agent_full_name"),
	listAgentEmail: varchar("list_agent_email"),
	listAgentPhone: varchar("list_agent_phone"),
	listOfficeKey: varchar("list_office_key"),
	listOfficeMlsId: varchar("list_office_mls_id"),
	listOfficeName: varchar("list_office_name"),
	listOfficePhone: varchar("list_office_phone"),
	buyerOfficeKey: varchar("buyer_office_key"),
	listingContractDate: date("listing_contract_date"),
	publicRemarks: text("public_remarks"),
	syndicationRemarks: text("syndication_remarks"),
	virtualTourUrl: varchar("virtual_tour_url"),
	internetDisplayYn: boolean("internet_display_yn"),
	internetValuationYn: boolean("internet_valuation_yn"),
	elementarySchool: varchar("elementary_school"),
	middleSchool: varchar("middle_school"),
	highSchool: varchar("high_school"),
	taxAssessedValue: numeric("tax_assessed_value"),
	taxYear: integer("tax_year"),
	taxLegalDesc: text("tax_legal_desc"),
	parcelNumber: varchar("parcel_number"),
	buyerAgencyComp: varchar("buyer_agency_comp"),
	buyerAgencyCompType: varchar("buyer_agency_comp_type"),
	subAgencyComp: varchar("sub_agency_comp"),
	subAgencyCompType: varchar("sub_agency_comp_type"),
	mlgCanView: boolean("mlg_can_view").default(true).notNull(),
	mlgCanUse: text("mlg_can_use").array(),
	modificationTs: timestamp("modification_ts", { withTimezone: true, mode: 'string' }).notNull(),
	originatingModTs: timestamp("originating_mod_ts", { withTimezone: true, mode: 'string' }),
	photosChangeTs: timestamp("photos_change_ts", { withTimezone: true, mode: 'string' }),
	photosCount: integer("photos_count"),
	majorChangeTs: timestamp("major_change_ts", { withTimezone: true, mode: 'string' }),
	majorChangeType: varchar("major_change_type"),
	originalEntryTs: timestamp("original_entry_ts", { withTimezone: true, mode: 'string' }),
	appliances: text().array(),
	architecturalStyle: text("architectural_style").array(),
	basement: text().array(),
	constructionMaterials: text("construction_materials").array(),
	cooling: text().array(),
	heating: text().array(),
	exteriorFeatures: text("exterior_features").array(),
	interiorFeatures: text("interior_features").array(),
	flooring: text().array(),
	roof: text().array(),
	sewer: text().array(),
	waterSource: text("water_source").array(),
	utilities: text().array(),
	lotFeatures: text("lot_features").array(),
	parkingFeatures: text("parking_features").array(),
	poolFeatures: text("pool_features").array(),
	fencing: text().array(),
	communityFeatures: text("community_features").array(),
	securityFeatures: text("security_features").array(),
	levels: text().array(),
	view: text().array(),
	foundationDetails: text("foundation_details").array(),
	patioPorchFeatures: text("patio_porch_features").array(),
	waterfrontFeatures: text("waterfront_features").array(),
	windowFeatures: text("window_features").array(),
	greenEnergy: text("green_energy").array(),
	horseAmenities: text("horse_amenities").array(),
	specialConditions: text("special_conditions").array(),
	disclosures: text().array(),
	propertyCondition: text("property_condition").array(),
	syndicateTo: text("syndicate_to").array(),
	localFields: jsonb("local_fields"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_properties_city").using("btree", table.city.asc().nullsLast().op("text_ops")),
	index("idx_properties_geog").using("gist", table.geog.asc().nullsLast().op("gist_geography_ops")),
	index("idx_properties_list_price").using("btree", table.listPrice.asc().nullsLast().op("numeric_ops")),
	index("idx_properties_mlg_can_use").using("gin", table.mlgCanUse.asc().nullsLast().op("array_ops")),
	index("idx_properties_modification_ts").using("btree", table.modificationTs.asc().nullsLast().op("timestamptz_ops")),
	index("idx_properties_postal_code").using("btree", table.postalCode.asc().nullsLast().op("text_ops")),
	index("idx_properties_property_type").using("btree", table.propertyType.asc().nullsLast().op("text_ops")),
	index("idx_properties_standard_status").using("btree", table.standardStatus.asc().nullsLast().op("text_ops")),
	index("idx_properties_status_type_price").using("btree", table.standardStatus.asc().nullsLast().op("text_ops"), table.propertyType.asc().nullsLast().op("numeric_ops"), table.listPrice.asc().nullsLast().op("text_ops")),
	index("idx_properties_subdivision").using("btree", table.subdivisionName.asc().nullsLast().op("text_ops")),
	unique("properties_listing_id_unique").on(table.listingId),
]);
export const geographyColumns = pgView("geography_columns", {	// TODO: failed to parse database type 'name'
	fTableCatalog: unknown("f_table_catalog"),
	// TODO: failed to parse database type 'name'
	fTableSchema: unknown("f_table_schema"),
	// TODO: failed to parse database type 'name'
	fTableName: unknown("f_table_name"),
	// TODO: failed to parse database type 'name'
	fGeographyColumn: unknown("f_geography_column"),
	coordDimension: integer("coord_dimension"),
	srid: integer(),
	type: text(),
}).as(sql`SELECT current_database() AS f_table_catalog, n.nspname AS f_table_schema, c.relname AS f_table_name, a.attname AS f_geography_column, postgis_typmod_dims(a.atttypmod) AS coord_dimension, postgis_typmod_srid(a.atttypmod) AS srid, postgis_typmod_type(a.atttypmod) AS type FROM pg_class c, pg_attribute a, pg_type t, pg_namespace n WHERE t.typname = 'geography'::name AND a.attisdropped = false AND a.atttypid = t.oid AND a.attrelid = c.oid AND c.relnamespace = n.oid AND (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND NOT pg_is_other_temp_schema(c.relnamespace) AND has_table_privilege(c.oid, 'SELECT'::text)`);

export const geometryColumns = pgView("geometry_columns", {	fTableCatalog: varchar("f_table_catalog", { length: 256 }),
	// TODO: failed to parse database type 'name'
	fTableSchema: unknown("f_table_schema"),
	// TODO: failed to parse database type 'name'
	fTableName: unknown("f_table_name"),
	// TODO: failed to parse database type 'name'
	fGeometryColumn: unknown("f_geometry_column"),
	coordDimension: integer("coord_dimension"),
	srid: integer(),
	type: varchar({ length: 30 }),
}).as(sql`SELECT current_database()::character varying(256) AS f_table_catalog, n.nspname AS f_table_schema, c.relname AS f_table_name, a.attname AS f_geometry_column, COALESCE(postgis_typmod_dims(a.atttypmod), sn.ndims, 2) AS coord_dimension, COALESCE(NULLIF(postgis_typmod_srid(a.atttypmod), 0), sr.srid, 0) AS srid, replace(replace(COALESCE(NULLIF(upper(postgis_typmod_type(a.atttypmod)), 'GEOMETRY'::text), st.type, 'GEOMETRY'::text), 'ZM'::text, ''::text), 'Z'::text, ''::text)::character varying(30) AS type FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped JOIN pg_namespace n ON c.relnamespace = n.oid JOIN pg_type t ON a.atttypid = t.oid LEFT JOIN ( SELECT s.connamespace, s.conrelid, s.conkey, (regexp_match(s.consrc, 'geometrytype\(\w+\)\s*=\s*''(\w+)'''::text, 'i'::text))[1] AS type FROM ( SELECT pg_constraint.connamespace, pg_constraint.conrelid, pg_constraint.conkey, pg_get_constraintdef(pg_constraint.oid) AS consrc FROM pg_constraint) s WHERE s.consrc ~* 'geometrytype\(\w+\)\s*=\s*''\w+'''::text) st ON st.connamespace = n.oid AND st.conrelid = c.oid AND (a.attnum = ANY (st.conkey)) LEFT JOIN ( SELECT s.connamespace, s.conrelid, s.conkey, (regexp_match(s.consrc, 'ndims\(\w+\)\s*=\s*(\d+)'::text, 'i'::text))[1]::integer AS ndims FROM ( SELECT pg_constraint.connamespace, pg_constraint.conrelid, pg_constraint.conkey, pg_get_constraintdef(pg_constraint.oid) AS consrc FROM pg_constraint) s WHERE s.consrc ~* 'ndims\(\w+\)\s*=\s*\d+'::text) sn ON sn.connamespace = n.oid AND sn.conrelid = c.oid AND (a.attnum = ANY (sn.conkey)) LEFT JOIN ( SELECT s.connamespace, s.conrelid, s.conkey, (regexp_match(s.consrc, 'srid\(\w+\)\s*=\s*(\d+)'::text, 'i'::text))[1]::integer AS srid FROM ( SELECT pg_constraint.connamespace, pg_constraint.conrelid, pg_constraint.conkey, pg_get_constraintdef(pg_constraint.oid) AS consrc FROM pg_constraint) s WHERE s.consrc ~* 'srid\(\w+\)\s*=\s*\d+'::text) sr ON sr.connamespace = n.oid AND sr.conrelid = c.oid AND (a.attnum = ANY (sr.conkey)) WHERE (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND NOT c.relname = 'raster_columns'::name AND t.typname = 'geometry'::name AND NOT pg_is_other_temp_schema(c.relnamespace) AND has_table_privilege(c.oid, 'SELECT'::text)`);