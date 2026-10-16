"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { createTask } from "@/lib/db/queries/tasks";
import { decrypt, encrypt } from "@/lib/security/crypto";

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

export const connectWithToken = ownerAction(
  z.object({ provider: z.enum(["notion", "slack", "github"]), token: z.string().trim().min(10).max(500) }),
  async ({ provider, token }, user) => {
    const label = await validate(provider, token);
    const values = { status: "connected", accountLabel: label.slice(0, 120), accessTokenEnc: encrypt(token), lastError: null };
    await db()
      .insert(schema.integrations)
      .values({ userId: user.id, provider, ...values })
      .onConflictDoUpdate({ target: [schema.integrations.userId, schema.integrations.provider], set: values });
    await logActivity({ userId: user.id, actor: "me", tool: "integration.connected", inputSummary: provider, outcome: "success" });
    revalidatePath("/integrations");
    revalidatePath("/knowledge");
    return { label };
  },
);

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
