import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;

/**
 * Smoke flow against `next start` on an embedded PGlite DB.
 * Requires `pnpm build` first. OTP_TEST_MODE uses a fixed code and is refused on Vercel production.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: { baseURL: BASE, trace: "retain-on-failure" },
  // PW_CHANNEL=msedge (or chrome) reuses an installed browser instead of downloading one.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      APP_URL: BASE,
      AUTH_SECRET: "e2e-only-secret-not-for-production-use-000000",
      ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      ALLOWED_EMAILS: "owner@example.com",
      OTP_TEST_MODE: "true",
      CRON_SECRET: "e2e-cron-secret-0000000000",
      AI_BASE_URL: `${BASE}/api/dev/mock-ai/v1`,
      AI_API_KEY: "mock",
      FAST_MODEL: "mock-fast",
      SMART_MODEL: "mock-smart",
    },
  },
});
