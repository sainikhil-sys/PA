import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __paDb?: DB };

/**
 * Lazily created so builds never need DATABASE_URL.
 *
 * - `postgres://...`  Neon/Supabase POOLED url (pgbouncer transaction mode):
 *   prepared statements off, small per-instance pool.
 * - `pglite:<dir>` or `pglite:memory`  embedded Postgres + pgvector for local
 *   dev and the Playwright smoke run. Never use on Vercel.
 */
export function db(): DB {
  if (!g.__paDb) {
    const url = requireEnv("DATABASE_URL");
    if (url.startsWith("pglite:")) {
      if (process.env.VERCEL) throw new Error("PGlite is for local development only");
      g.__paDb = createPglite(url.slice("pglite:".length));
    } else {
      const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
      g.__paDb = drizzle(client, { schema });
    }
  }
  return g.__paDb;
}

function createPglite(location: string): DB {
  // Required lazily so the WASM bundle is never loaded in production.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { vector } = require("@electric-sql/pglite-pgvector") as typeof import("@electric-sql/pglite-pgvector");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzlePglite } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const client = new PGlite(location === "memory" ? undefined : location, { extensions: { vector } });
  return drizzlePglite(client, { schema }) as unknown as DB;
}

/** Normalise `db().execute()` results across drivers (postgres-js returns rows; PGlite returns { rows }). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export { schema };
