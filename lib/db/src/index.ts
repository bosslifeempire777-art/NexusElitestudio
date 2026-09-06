import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

// Supabase (and most managed Postgres) require SSL. Allow self-signed
// certs so pooler connections work from Railway/Docker.
const needsSsl =
  /supabase\.co|amazonaws\.com|neon\.tech|railway\.app|render\.com/i.test(
    connectionString,
  ) || process.env.PGSSLMODE === "require";

export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
