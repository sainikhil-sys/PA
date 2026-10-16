// Applies Drizzle migrations. Uses the DIRECT (unpooled) URL for Postgres,
// or an embedded PGlite database when DATABASE_URL starts with "pglite:".
import "dotenv/config";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) before migrating.");
  process.exit(1);
}
const migrationsFolder = new URL("../lib/db/migrations", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

if (url.startsWith("pglite:")) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const loc = url.slice("pglite:".length);
  const client = new PGlite(loc === "memory" ? undefined : loc, { extensions: { vector } });
  await migrate(drizzle(client), { migrationsFolder });
  await client.close();
} else {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder });
  await client.end();
}
console.log("Migrations applied.");
