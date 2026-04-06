import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "./lib/nanoid.js";

const ADMIN_USERNAME = process.env["ADMIN_USERNAME"] || "Bosslife_king";
const ADMIN_EMAIL    = process.env["ADMIN_EMAIL"]    || "admin@nexuselite.app";
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"];

export async function ensureAdminAccount() {
  if (!ADMIN_PASSWORD) {
    console.warn("⚠ ADMIN_PASSWORD not set — skipping admin account sync");
    return;
  }

  try {
    const existing = await db.query.usersTable.findFirst({
      where: eq(usersTable.username, ADMIN_USERNAME),
    });

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    if (existing) {
      await db.update(usersTable).set({
        passwordHash,
        isAdmin: true,
        isVip:   true,
        plan:    "vip",
        email:   ADMIN_EMAIL,
        updatedAt: new Date(),
      }).where(eq(usersTable.username, ADMIN_USERNAME));
      console.log(`✅ Admin account synced: ${ADMIN_USERNAME}`);
    } else {
      await db.insert(usersTable).values({
        id:           nanoid(),
        username:     ADMIN_USERNAME,
        email:        ADMIN_EMAIL,
        passwordHash,
        plan:         "vip",
        isAdmin:      true,
        isVip:        true,
      });
      console.log(`✅ Admin account created: ${ADMIN_USERNAME}`);
    }
  } catch (err) {
    console.error("❌ Error syncing admin account:", err);
  }
}

// Allow running directly: node seed-admin.ts
if (process.argv[1]?.includes("seed-admin")) {
  ensureAdminAccount().then(() => process.exit(0)).catch(() => process.exit(1));
}
