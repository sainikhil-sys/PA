// Applies Drizzle migrations to Supabase Postgres.
// Uses DATABASE_URL_UNPOOLED (direct connection or SESSION pooler, port 5432) —
// migrations must not run through the transaction pooler (port 6543).
import { config } from "dotenv";

// .env.local (development) wins over .env, matching Next.js precedence.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

// Supabase's session pooler is the same host as the transaction pooler, on port 5432.
const derived = process.env.DATABASE_URL && /pooler\.supabase\.com:6543\//.test(process.env.DATABASE_URL) ? process.env.DATABASE_URL.replace(":6543/", ":5432/") : undefined;
const url = process.env.DATABASE_URL_UNPOOLED || derived || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (Supabase transaction pooler) in .env.local before migrating.");
  process.exit(1);
}
try {
  new URL(url);
} catch {
  console.error("The database URL in .env.local isn't a valid URL. Paste the full Supabase connection string, replace [YOUR-PASSWORD] (without the brackets), and URL-encode special characters in the password.");
  process.exit(1);
}
if (/:6543\//.test(url)) {
  console.warn("Warning: this looks like the transaction pooler (port 6543). Use the direct or session-pooler URL (port 5432) for migrations.");
}
const migrationsFolder = new URL("../lib/db/migrations", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const postgres = (await import("postgres")).default;
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const client = postgres(url, { max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require", onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
