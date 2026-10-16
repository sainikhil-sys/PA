import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { configuredProviders } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/** Liveness + shallow readiness. Reveals no secrets or configuration values. */
export async function GET() {
  let database: "ok" | "error" | "unconfigured" = "unconfigured";
  if (process.env.DATABASE_URL) {
    try {
      await db().execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "error";
    }
  }
  return Response.json(
    { status: "ok", database, ai: configuredProviders().length > 0 ? "configured" : "unconfigured", time: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
