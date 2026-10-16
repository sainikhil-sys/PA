import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/lib/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __paDb?: DB };

/**
 * Supabase Postgres (with pgvector). Lazily created so builds never need DATABASE_URL.
 *
 * DATABASE_URL must be Supabase's **transaction pooler** URL (port 6543): prepared
 * statements are disabled (required by the pooler) and the per-instance pool is
 * kept small for serverless. Migrations use DATABASE_URL_UNPOOLED instead.
 */
export function db(): DB {
  if (!g.__paDb) {
    const url = requireEnv("DATABASE_URL");
    const client = postgres(url, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    });
    g.__paDb = drizzle(client, { schema });
  }
  return g.__paDb;
}

/** `db().execute()` returns rows as an array with postgres-js; kept as a helper for clarity. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export { schema };
