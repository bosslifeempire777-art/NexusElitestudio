import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const recoveryEmailEventsTable = pgTable("recovery_email_events", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull(),
  planName:  text("plan_name").notNull(),
  sentAt:    timestamp("sent_at").notNull().defaultNow(),
});
