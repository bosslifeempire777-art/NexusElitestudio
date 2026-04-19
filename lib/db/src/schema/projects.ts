import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  status: text("status").notNull().default("building"),
  prompt: text("prompt").notNull(),
  framework: text("framework"),
  gameEngine: text("game_engine"),
  userId: text("user_id").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  deployedUrl: text("deployed_url"),
  agentLogs: jsonb("agent_logs").notNull().default([]),
  chatHistory: jsonb("chat_history").notNull().default([]),
  memory: jsonb("memory").notNull().default({}),
  generatedCode: text("generated_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
