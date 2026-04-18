import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const deploymentsTable = pgTable("deployments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  userId: text("user_id").notNull(),
  slug: text("slug").notNull().unique(),
  brandedUrl: text("branded_url").notNull(),
  provider: text("provider").notNull().default("nexus-edge"),
  providerServiceId: text("provider_service_id"),
  providerLiveUrl: text("provider_live_url"),
  status: text("status").notNull().default("live"),
  errorMessage: text("error_message"),
  buildLogs: jsonb("build_logs").notNull().default([]),
  lastDeployedAt: timestamp("last_deployed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customDomainsTable = pgTable("custom_domains", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull(),
  userId: text("user_id").notNull(),
  domain: text("domain").notNull().unique(),
  status: text("status").notNull().default("pending"),
  verificationTarget: text("verification_target"),
  verifiedAt: timestamp("verified_at"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Deployment = typeof deploymentsTable.$inferSelect;
export type CustomDomain = typeof customDomainsTable.$inferSelect;
