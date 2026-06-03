import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const mobileBuildTable = pgTable("mobile_builds", {
  id:           text("id").primaryKey(),
  projectId:    text("project_id").notNull(),
  easBuildId:   text("eas_build_id").notNull(),
  platform:     text("platform").notNull(),
  status:       text("status").notNull().default("in-queue"),
  profile:      text("profile").notNull().default("preview"),
  artifactUrl:  text("artifact_url"),
  repoUrl:      text("repo_url"),
  logsUrl:      text("logs_url"),
  errorMessage: text("error_message"),
  startedAt:    timestamp("started_at").notNull().defaultNow(),
  finishedAt:   timestamp("finished_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type MobileBuild = typeof mobileBuildTable.$inferSelect;
export type InsertMobileBuild = typeof mobileBuildTable.$inferInsert;
