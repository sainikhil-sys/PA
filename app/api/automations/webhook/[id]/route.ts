import { and, eq } from "drizzle-orm";
import { queueRun } from "@/lib/automations/events";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/db/queries/settings";
import { processJobs } from "@/lib/jobs/handlers";
import { safeEqual, sha256 } from "@/lib/security/crypto";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { clientIp, errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook trigger. Requires `x-pa-webhook-secret`. The payload is treated as
 * untrusted: only a short content-free summary is kept on the run.
 * Idempotency: send `x-idempotency-key` to make retries safe.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit("webhook", clientIp(req));
  if (!rl.success) return rateLimitResponse(rl);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(404, "not_found");
  const secret = req.headers.get("x-pa-webhook-secret") ?? "";
  const a = await db().query.automations.findFirst({ where: and(eq(schema.automations.id, id), eq(schema.automations.enabled, true)) });
  if (!a || a.trigger.type !== "webhook" || !a.webhookSecretHash || !secret || !safeEqual(sha256(secret), a.webhookSecretHash)) {
    return errorJson(401, "unauthorized");
  }
  if ((await getSettings(a.userId)).automationsPaused) return Response.json({ accepted: false, reason: "paused" }, { status: 202 });
  const raw = (await req.text()).slice(0, 10_000);
  const key = req.headers.get("x-idempotency-key")?.slice(0, 100) ?? sha256(raw).slice(0, 32);
  const runId = await queueRun(a, `webhook:${key}`, { type: "webhook", payloadSummary: `${raw.length} bytes` }, false);
  if (runId) await processJobs({ budgetMs: 40_000, types: ["run_automation"], batchSize: 1 });
  return Response.json({ accepted: Boolean(runId), duplicate: !runId, runId }, { status: 202 });
}
