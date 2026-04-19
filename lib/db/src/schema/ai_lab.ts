import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * Prompt-pack purchases for the AI Lab. Each row is one purchase. We deduct
 * `promptsRemaining` per test run; when it hits 0 the pack is exhausted.
 */
export const aiLabPacksTable = pgTable("ai_lab_packs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  promptsTotal: integer("prompts_total").notNull(),
  promptsRemaining: integer("prompts_remaining").notNull(),
  amountPaidCents: integer("amount_paid_cents").notNull().default(0),
  stripeSessionId: text("stripe_session_id"),
  status: text("status").notNull().default("pending"), // pending | active | exhausted
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Each AI Lab run — one or more model responses to a single prompt.
 * `mode` is "single" (auto-pick best model) or "compare" (run side-by-side).
 */
export const aiLabRunsTable = pgTable("ai_lab_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: text("project_id"),
  prompt: text("prompt").notNull(),
  mode: text("mode").notNull().default("single"),
  appType: text("app_type"),
  models: jsonb("models").notNull().default([]),
  responses: jsonb("responses").notNull().default([]),
  promptsConsumed: integer("prompts_consumed").notNull().default(1),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiLabPack = typeof aiLabPacksTable.$inferSelect;
export type AiLabRun  = typeof aiLabRunsTable.$inferSelect;
