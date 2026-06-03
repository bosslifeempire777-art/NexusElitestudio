import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const easWebhookTable = pgTable("eas_webhooks", {
  id:           text("id").primaryKey(),
  projectId:    text("project_id").notNull(),
  url:          text("url").notNull(),
  secret:       text("secret"),
  events:       jsonb("events").notNull().default(["BUILD"]),
  active:       boolean("active").notNull().default(true),
  easWebhookId: text("eas_webhook_id"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type EasWebhook = typeof easWebhookTable.$inferSelect;
export type InsertEasWebhook = typeof easWebhookTable.$inferInsert;
