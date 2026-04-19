import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const usageRecordsTable = pgTable("usage_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: text("project_id"),
  kind: text("kind").notNull(),
  units: integer("units").notNull().default(1),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  model: text("model"),
  description: text("description"),
  paid: integer("paid").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const overageCreditsTable = pgTable("overage_credits", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  builds: integer("builds").notNull().default(0),
  buildsUsed: integer("builds_used").notNull().default(0),
  amountPaidCents: integer("amount_paid_cents").notNull().default(0),
  stripeSessionId: text("stripe_session_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UsageRecord = typeof usageRecordsTable.$inferSelect;
export type OverageCredit = typeof overageCreditsTable.$inferSelect;
