import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "./lib/nanoid.js";

const ADMIN_USERNAME = process.env["ADMIN_USERNAME"] || "nexuselite_admin";
const ADMIN_EMAIL = process.env["ADMIN_EMAIL"] || "admin@nexuselite.app";
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"];

if (!ADMIN_PASSWORD) {
  console.error("❌ ADMIN_PASSWORD env var is required to seed admin account");
  process.exit(1);
}

async function seedAdmin() {
  console.log(`🔧 Seeding admin account: ${ADMIN_USERNAME}`);

  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.username, ADMIN_USERNAME),
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  if (existing) {
    await db.update(usersTable).set({
      passwordHash,
      isAdmin: true,
      isVip: false,
      plan: "vip",
      email: ADMIN_EMAIL,
      updatedAt: new Date(),
    }).where(eq(usersTable.username, ADMIN_USERNAME));
    console.log(`✅ Admin account updated: ${ADMIN_USERNAME}`);
  } else {
    await db.insert(usersTable).values({
      id: nanoid(),
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      passwordHash,
      plan: "vip",
      isAdmin: true,
      isVip: false,
    });
    console.log(`✅ Admin account created: ${ADMIN_USERNAME}`);
  }

  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("❌ Error seeding admin:", err);
  process.exit(1);
});
