// Starts a production server for the Playwright smoke run against a SEPARATE
// Supabase test database. The test DB is migrated and reset (all PA rows removed)
// before each run, so it must never be your real database: this script refuses
// to run if the e2e URLs match DATABASE_URL / DATABASE_URL_UNPOOLED.
import { spawn, spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const appUrl = process.env.E2E_DATABASE_URL;
const directUrl = process.env.E2E_DATABASE_URL_UNPOOLED || appUrl;
if (!appUrl) {
  console.error("Set E2E_DATABASE_URL (and E2E_DATABASE_URL_UNPOOLED) to a separate Supabase project for end-to-end tests.");
  process.exit(1);
}
const real = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].filter(Boolean);
if (real.includes(appUrl) || real.includes(directUrl)) {
  console.error("Refusing to run: the e2e database URL is the same as your real DATABASE_URL. Use a separate test project.");
  process.exit(1);
}

const migrate = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: appUrl, DATABASE_URL_UNPOOLED: directUrl }, stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// Reset the TEST database: every user-scoped table cascades from users.
const postgres = (await import("postgres")).default;
const sql = postgres(directUrl, { max: 1, ssl: "require", onnotice: () => {} });
await sql`truncate table users, oauth_clients, otp_codes restart identity cascade`;
await sql.end();

const port = process.env.PORT ?? "3100";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], {
  env: { ...process.env, DATABASE_URL: appUrl, DATABASE_URL_UNPOOLED: directUrl },
  stdio: "inherit",
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
