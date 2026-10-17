// Local UI work with test-mode sign-in (fixed code 424242, nothing emailed).
// Uses the separate E2E test database when E2E_DATABASE_URL is set. Otherwise it uses the
// real database but locks sign-in to ONE local test account, so no real account can be
// entered with the fixed code.
import { spawn, spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const TEST_EMAIL = "dev@cowork.test";
const e2e = process.env.E2E_DATABASE_URL;
const real = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].filter(Boolean);
if (e2e && real.includes(e2e)) {
  console.error("E2E_DATABASE_URL must be a separate Supabase project, not your real DATABASE_URL.");
  process.exit(1);
}
const db = e2e ? { DATABASE_URL: e2e, DATABASE_URL_UNPOOLED: process.env.E2E_DATABASE_URL_UNPOOLED || e2e } : {};
console.log(e2e ? "[dev-test] using the E2E test database" : `[dev-test] using the real database; sign-in limited to ${TEST_EMAIL}`);
const env = {
  ...process.env,
  ...db,
  OTP_TEST_MODE: "true",
  SIGNUP_MODE: "allowlist",
  ALLOWED_EMAILS: TEST_EMAIL,
  ADMIN_EMAILS: TEST_EMAIL,
  APP_URL: "http://localhost:3200",
  NEXT_DIST_DIR: ".next-devtest",
};
if (e2e) {
  const migrate = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "inherit" });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);
}
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--turbopack", "-p", "3200"], { env, stdio: "inherit" });
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
