import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const charactersTable = pgTable("characters", {
  id:         text("id").primaryKey(),
  name:       text("name").notNull(),
  gameStyle:  text("game_style").notNull().default("cartoon"),
  prompt:     text("prompt").notNull().default(""),
  imageUrl:   text("image_url"),
  imageData:  text("image_data"),
  imageType:  text("image_type").notNull().default("ai-generated"),
  userId:     text("user_id").notNull(),
  projectId:  text("project_id"),
  tags:       text("tags").array(),
  notes:      text("notes"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
  updatedAt:  timestamp("updated_at").notNull().defaultNow(),
});
