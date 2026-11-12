import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { pendingProposalCount } from "@/lib/agent/proposals";
import { apiGuard } from "@/lib/auth/api";
import { isAdmin } from "@/lib/auth/policy";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { listNotifications } from "@/lib/db/queries/notifications";
import { getSettings, updateSettings } from "@/lib/db/queries/settings";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** Rows the owner has in a table (profile numbers; only things Cowork really tracks). */
async function countOf(table: typeof schema.conversations | typeof schema.notes | typeof schema.memories, userId: string) {
  const [row] = await db().select({ n: count() }).from(table).where(eq(table.userId, userId));
  return row?.n ?? 0;
}

/** Documents the owner uploaded (not synced mail or mirrored notes). */
async function uploadedDocuments(userId: string) {
  const [row] = await db()
    .select({ n: count() })
    .from(schema.knowledgeItems)
    .innerJoin(schema.knowledgeSources, eq(schema.knowledgeSources.id, schema.knowledgeItems.sourceId))
    .where(and(eq(schema.knowledgeItems.userId, userId), eq(schema.knowledgeSources.type, "upload")));
  return row?.n ?? 0;
}

/** The signed-in account for the Android app: profile, agent name and the counts behind its badges. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const u = g.user;
  const [s, pending, notes, chats, noteCount, memories, documents] = await Promise.all([
    getSettings(u.id),
    pendingProposalCount(u.id),
    listNotifications(u.id, 1),
    countOf(schema.conversations, u.id),
    countOf(schema.notes, u.id),
    countOf(schema.memories, u.id),
    uploadedDocuments(u.id),
  ]);
  return Response.json(
    {
      email: u.email,
      name: u.name,
      bio: u.bio ?? null,
      avatarUrl: u.avatarUrl ?? null,
      memberSince: u.createdAt.toISOString(),
      stats: { chats, notes: noteCount, documents, memories },
      timezone: s.timezone,
      agentName: s.agent.name,
      onboarded: Boolean(u.onboardedAt),
      /** Decided here from ADMIN_EMAILS; the app only shows the console entry. The console itself re-checks on every request. */
      isAdmin: isAdmin(u.email),
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
  name: z.string().trim().min(1, "Enter your name.").max(80).optional(),
  bio: z.string().trim().max(280, "Keep your bio under 280 characters.").optional(),
  timezone: z.string().max(64).refine(validTimezone, "Unknown time zone").optional(),
  onboarded: z.literal(true).optional(),
});

/** Profile edits from the app: name, bio, the phone's time zone, and finishing first-run setup. */
export async function PATCH(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = patch.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Please check your input.");
  const { name, bio, timezone, onboarded } = parsed.data;
  if (name !== undefined || bio !== undefined || onboarded) {
    await db()
      .update(schema.users)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(bio !== undefined ? { bio: bio || null } : {}),
        ...(onboarded && !g.user.onboardedAt ? { onboardedAt: new Date() } : {}),
      })
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
  await db().delete(schema.users).where(eq(schema.users.id, g.user.id));
  return Response.json({ ok: true }, { headers: noStore });
}
