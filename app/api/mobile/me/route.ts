import { deleteAccountData } from "@/lib/auth/delete-account";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { pendingProposalCount } from "@/lib/agent/proposals";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { listNotifications } from "@/lib/db/queries/notifications";
import { getSettings, updateSettings } from "@/lib/db/queries/settings";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** The signed-in account for the Android app: profile, agent name and the counts behind its badges. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const u = g.user;
  const [s, pending, notes] = await Promise.all([getSettings(u.id), pendingProposalCount(u.id), listNotifications(u.id, 1)]);
  return Response.json(
    {
      email: u.email,
      name: u.name,
      timezone: s.timezone,
      agentName: s.agent.name,
      onboarded: Boolean(u.onboardedAt),
      pendingApprovals: pending,
      unreadNotifications: notes.unread,
    },
    { headers: noStore },
  );
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().max(64).refine(validTimezone, "Unknown time zone").optional(),
  onboarded: z.literal(true).optional(),
});

/** First-run setup in the app: your name, the phone's time zone, done. */
export async function PATCH(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = patch.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Please check your input.");
  const { name, timezone, onboarded } = parsed.data;
  if (name !== undefined || onboarded) {
    await db()
      .update(schema.users)
      .set({ ...(name !== undefined ? { name } : {}), ...(onboarded && !g.user.onboardedAt ? { onboardedAt: new Date() } : {}) })
      .where(eq(schema.users.id, g.user.id));
  }
  if (timezone) await updateSettings(g.user.id, { timezone });
  return Response.json({ ok: true }, { headers: noStore });
}

/** Deletes the account and everything in it (same as Settings > Privacy on the web). Irreversible. */
export async function DELETE(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ confirm: z.literal("DELETE") }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Type DELETE to confirm.");
  await logActivity({ userId: g.user.id, actor: "me", tool: "account.deleted", inputSummary: "Android app", outcome: "success" });
  // Sessions, devices, tasks, mail, notes… all cascade from the user row.
  await deleteAccountData(g.user.id);
  return Response.json({ ok: true }, { headers: noStore });
}
