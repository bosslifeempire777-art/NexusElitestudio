import { pgTable, text, real, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketplaceListingsTable = pgTable("marketplace_listings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  price: real("price").notNull().default(0),
  isFree: boolean("is_free").notNull().default(false),
  sellerId: text("seller_id").notNull(),
  sellerName: text("seller_name").notNull(),
  downloads: integer("downloads").notNull().default(0),
  rating: real("rating").notNull().default(0),
  thumbnailUrl: text("thumbnail_url"),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMarketplaceListingSchema = createInsertSchema(marketplaceListingsTable).omit({ createdAt: true });
export type InsertMarketplaceListing = z.infer<typeof insertMarketplaceListingSchema>;
export type MarketplaceListing = typeof marketplaceListingsTable.$inferSelect;
