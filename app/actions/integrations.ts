"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { createTask } from "@/lib/db/queries/tasks";
import { decrypt, encrypt } from "@/lib/security/crypto";
import { ProviderError, validateCreds } from "@/lib/integrations/providers";
import { ensureSource } from "@/lib/knowledge/ingest";
import { syncKnowledgeSource } from "@/lib/knowledge/sync";
import { enqueue } from "@/lib/jobs/queue";

/** Validate a read-only token against the provider before storing it (encrypted). */
async function validate(provider: "notion" | "slack" | "github", token: string): Promise<string> {
  const signal = AbortSignal.timeout(10_000);
  if (provider === "notion") {
    const r = await fetch("https://api.notion.com/v1/users/me", { headers: { authorization: `Bearer ${token}`, "notion-version": "2022-06-28" }, signal });
    if (!r.ok) throw new UserFacingError("Notion didn't accept that token.");
    const d = (await r.json()) as { name?: string; bot?: { workspace_name?: string } };
    return d.bot?.workspace_name ?? d.name ?? "Notion";
  }
  if (provider === "slack") {
    const r = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: { authorization: `Bearer ${token}` }, signal });
    const d = (await r.json()) as { ok: boolean; team?: string; error?: string };
    if (!d.ok) throw new UserFacingError(`Slack didn't accept that token (${d.error ?? "error"}).`);
    return d.team ?? "Slack";
  }
  const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, "user-agent": "PA", accept: "application/vnd.github+json" }, signal });
  if (!r.ok) throw new UserFacingError("GitHub didn't accept that token.");
  const d = (await r.json()) as { login?: string };
  return d.login ?? "GitHub";
}

/** Token providers whose data PA syncs automatically (source name shown on the Knowledge page). */
const AUTO_SOURCES: Record<string, string> = {
  asana: "Asana tasks",
  linear: "Linear issues",
  hubspot: "HubSpot contacts",
  stripe: "Stripe revenue",
  zoom: "Zoom meetings",
  youtube: "YouTube channel",
  figma: "Figma files",
};

export const connectWithToken = ownerAction(
  z.object({
    provider: z.enum(["notion", "slack", "github", "asana", "linear", "hubspot", "stripe", "zoom", "youtube", "figma"]),
    token: z.string().trim().max(500).optional(),
    fields: z.record(z.string().max(60), z.string().trim().max(500)).optional(),
  }),
  async ({ provider, token, fields }, user) => {
    let label: string;
    let stored: string;
    if (provider === "notion" || provider === "slack" || provider === "github") {
      const t = token ?? fields?.token ?? "";
      if (t.length < 10) throw new UserFacingError("Paste the full token.");
      label = await validate(provider, t);
      stored = t;
    } else {
      const creds = { ...fields, ...(token ? { token } : {}) };
      if (Object.values(creds).some((v) => !v)) throw new UserFacingError("Fill in every field.");
      try {
        label = await validateCreds(provider, creds);
      } catch (err) {
        throw new UserFacingError(err instanceof ProviderError ? err.message : "Couldn't reach the provider. Check the credentials.");
      }
      stored = JSON.stringify(creds);
    }
    const values = { status: "connected", accountLabel: label.slice(0, 120), accessTokenEnc: encrypt(stored), lastError: null };
    await db()
      .insert(schema.integrations)
      .values({ userId: user.id, provider, ...values })
      .onConflictDoUpdate({ target: [schema.integrations.userId, schema.integrations.provider], set: values });
    await logActivity({ userId: user.id, actor: "me", tool: "integration.connected", inputSummary: provider, outcome: "success" });
    if (AUTO_SOURCES[provider]) {
      const source = await ensureSource(user.id, provider, AUTO_SOURCES[provider]!);
      await db().update(schema.knowledgeSources).set({ included: true, status: "idle", lastError: null }).where(eq(schema.knowledgeSources.id, source.id));
      await enqueue(user.id, "knowledge_sync", { sourceId: source.id }, { dedupeKey: `ksync:${source.id}` });
    }
    revalidatePath("/integrations");
    revalidatePath("/knowledge");
    return { label };
  },
);

/** "Sync now" from the integration panel (first sync also runs right after connecting). */
export const syncIntegrationNow = ownerAction(z.object({ provider: z.string().min(2).max(40) }), async ({ provider }, user) => {
  const source = await db().query.knowledgeSources.findFirst({ where: and(eq(schema.knowledgeSources.userId, user.id), eq(schema.knowledgeSources.type, provider)) });
  if (!source) throw new UserFacingError("Nothing to sync for this integration yet.");
  try {
    await syncKnowledgeSource(user.id, source.id);
  } catch (err) {
    throw new UserFacingError(err instanceof Error ? err.message.slice(0, 160) : "Sync failed.");
  }
  revalidatePath("/integrations");
  revalidatePath("/knowledge");
  revalidatePath("/tasks");
  const fresh = await db().query.knowledgeSources.findFirst({ where: eq(schema.knowledgeSources.id, source.id) });
  return { items: fresh?.itemCount ?? 0 };
});

/** Destructive (confirm in UI): forget tokens. For Google, also revoke the grant at Google. */
export const disconnectIntegration = ownerAction(z.object({ provider: z.string().min(2).max(40) }), async ({ provider }, user) => {
  const row = await db().query.integrations.findFirst({ where: and(eq(schema.integrations.userId, user.id), eq(schema.integrations.provider, provider)) });
  if (!row) return;
  if (provider === "google" && (row.refreshTokenEnc || row.accessTokenEnc)) {
    const token = decrypt((row.refreshTokenEnc ?? row.accessTokenEnc)!);
    await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(8000) }).catch(() => null);
  }
  await db()
    .update(schema.integrations)
    .set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null })
    .where(eq(schema.integrations.id, row.id));
  await logActivity({ userId: user.id, actor: "me", tool: "integration.disconnected", inputSummary: provider, outcome: "success" });
  revalidatePath("/integrations");
});

export const requestIntegration = ownerAction(z.object({ name: z.string().trim().min(2).max(80) }), async ({ name }, user) => {
  await createTask(user.id, { title: `Integration request: ${name}`, createdBy: "me", tags: ["integration"] });
});
