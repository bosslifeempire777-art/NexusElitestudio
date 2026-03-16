import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const buildLogsTable = pgTable("build_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  agentName: text("agent_name").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertBuildLogSchema = createInsertSchema(buildLogsTable).omit({ timestamp: true });
export type InsertBuildLog = z.infer<typeof insertBuildLogSchema>;
export type BuildLog = typeof buildLogsTable.$inferSelect;
