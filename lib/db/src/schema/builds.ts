import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const buildsTable = pgTable("builds", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  status: text("status").notNull().default("queued"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  logs: jsonb("logs").notNull().default([]),
  deployedUrl: text("deployed_url"),
});

export const insertBuildSchema = createInsertSchema(buildsTable).omit({ startedAt: true });
export type InsertBuild = z.infer<typeof insertBuildSchema>;
export type Build = typeof buildsTable.$inferSelect;
