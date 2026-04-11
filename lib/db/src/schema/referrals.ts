import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const referralStatusEnum = pgEnum("referral_status", ["pending", "converted"]);

export const referralsTable = pgTable("referrals", {
  id:          text("id").primaryKey(),
  referrerId:  text("referrer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  referredId:  text("referred_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  status:      referralStatusEnum("status").notNull().default("pending"),
  planAtConversion: text("plan_at_conversion"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  convertedAt: timestamp("converted_at"),
});

export const creditTransactionsTable = pgTable("credit_transactions", {
  id:          text("id").primaryKey(),
  userId:      text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount:      integer("amount").notNull(),
  type:        text("type").notNull(),
  description: text("description").notNull(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type Referral = typeof referralsTable.$inferSelect;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
