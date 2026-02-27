import { relations } from "drizzle-orm/relations";
import { properties, rooms, unitTypes } from "./schema";

export const roomsRelations = relations(rooms, ({one}) => ({
	property: one(properties, {
		fields: [rooms.listingKey],
		references: [properties.listingKey]
	}),
}));

export const propertiesRelations = relations(properties, ({many}) => ({
	rooms: many(rooms),
	unitTypes: many(unitTypes),
}));

export const unitTypesRelations = relations(unitTypes, ({one}) => ({
	property: one(properties, {
		fields: [unitTypes.listingKey],
		references: [properties.listingKey]
	}),
}));