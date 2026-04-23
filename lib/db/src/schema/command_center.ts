import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/**
 * Custom AI agents created by admins inside the Command Center.
 * Each row is a fully user-defined agent with its own model and prompt.
 */
export const customAgentsTable = pgTable("custom_agents", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  description:  text("description").notNull().default(""),
  icon:         text("icon").notNull().default("🤖"),
  category:     text("category").notNull().default("custom"),
  model:        text("model").notNull(),                  // openrouter model slug e.g. "anthropic/claude-3.5-sonnet"
  systemPrompt: text("system_prompt").notNull(),
  capabilities: jsonb("capabilities").notNull().default([]).$type<string[]>(),
  isActive:     boolean("is_active").notNull().default(true),
  createdBy:    text("created_by").notNull(),              // userId
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Maps a built-in agent (from AGENT_REGISTRY) to a specific OpenRouter model.
 * If a row is missing for an agent, the system uses its default model.
 */
export const agentModelAssignmentsTable = pgTable("agent_model_assignments", {
  agentId:   text("agent_id").primaryKey(),                // matches AGENT_REGISTRY[].id
  model:     text("model").notNull(),                       // openrouter model slug
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Audit log of every shell command executed via the Command Center console.
 * Lets the admin review what was run, when, and what the output was.
 */
export const consoleHistoryTable = pgTable("console_history", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull(),
  command:   text("command").notNull(),
  exitCode:  text("exit_code"),                             // string for "timeout"/"killed"/numeric
  stdout:    text("stdout").notNull().default(""),
  stderr:    text("stderr").notNull().default(""),
  durationMs: text("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomAgent          = typeof customAgentsTable.$inferSelect;
export type AgentModelAssignment = typeof agentModelAssignmentsTable.$inferSelect;
export type ConsoleHistory       = typeof consoleHistoryTable.$inferSelect;
