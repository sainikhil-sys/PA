// Starts a production server for the Playwright smoke run on a fresh embedded
// PGlite database. OTP test mode + the in-app mock AI endpoint mean no real
// secrets or external services are needed. Never use these settings in production.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const dir = ".pglite-e2e";
rmSync(dir, { recursive: true, force: true });
const env = { ...process.env, DATABASE_URL: `pglite:./${dir}` };
const mig = spawnSync(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "inherit" });
if (mig.status !== 0) process.exit(mig.status ?? 1);
const port = process.env.PORT ?? "3100";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
