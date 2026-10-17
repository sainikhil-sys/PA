"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { processBroadcast } from "@/lib/admin/broadcast";
import { generateObject, testProvider } from "@/lib/ai/router";
import { ownerAction } from "@/lib/auth/action";
import { isAdmin } from "@/lib/auth/policy";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { logActivity } from "@/lib/db/queries/activity";
import { enqueue } from "@/lib/jobs/queue";

/** Every admin action re-checks the role server-side; the console UI is not the guard. */
function assertAdmin(user: User) {
  if (!isAdmin(user.email)) throw new Error("Not found");
}

export const setUserDisabled = ownerAction(z.object({ userId: z.string().uuid(), disabled: z.boolean() }), async ({ userId, disabled }, user) => {
  assertAdmin(user);
  if (userId === user.id) throw new Error("You can't disable your own account");
  await db().update(schema.users).set({ disabledAt: disabled ? new Date() : null }).where(eq(schema.users.id, userId));
  if (disabled) await db().update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  await logActivity({ userId: user.id, actor: "me", tool: disabled ? "admin.user_disabled" : "admin.user_enabled", inputSummary: userId, outcome: "success" });
  revalidatePath("/console/users");
});

const draftSchema = z.object({ title: z.string().min(3).max(120), body: z.string().min(10).max(600) });

/** Turn a rough note into a short announcement (title + body). The admin edits it before sending. */
export const draftBroadcast = ownerAction(z.object({ prompt: z.string().trim().min(5).max(2000) }), async ({ prompt }, user) => {
  assertAdmin(user);
  const { value } = await generateObject({
    kind: "admin.broadcast_draft",
    userId: user.id,
    tier: "smart",
    system:
      "You write short, friendly product announcements for Cowork, an AI work assistant. Plain language, no hype, no emoji, no links. Title under 70 characters. Body 1-3 short sentences, under 400 characters. Output JSON {title, body}.",
    prompt: `Write an announcement from this note:\n${prompt}`,
    schema: draftSchema,
  });
  return value;
});

export const sendBroadcast = ownerAction(
  z.object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(600),
    href: z
      .string()
      .trim()
      .max(200)
      .regex(/^\/(?!\/)[\w\-/?=&.#]*$/, "Use an in-app path like /settings")
      .optional()
      .or(z.literal("")),
    channels: z.array(z.enum(["in_app", "push", "email"])).min(1),
    confirm: z.literal(true),
  }),
  async (input, user) => {
    assertAdmin(user);
    const [b] = await db()
      .insert(schema.broadcasts)
      .values({ createdBy: user.id, title: input.title, body: input.body, href: input.href || null, channels: input.channels })
      .returning({ id: schema.broadcasts.id });
    await logActivity({ userId: user.id, actor: "me", tool: "admin.broadcast_sent", inputSummary: `${input.channels.join("+")}: ${input.title.slice(0, 60)}`, outcome: "success" });
    // Start right away; the job queue finishes anything that doesn't fit in this request.
    after(async () => {
      const done = await processBroadcast(b!.id, 45_000).catch(() => false);
      if (!done) await enqueue(user.id, "broadcast", { broadcastId: b!.id }, { dedupeKey: `broadcast:${b!.id}:start` });
    });
    revalidatePath("/console/broadcast");
    return { id: b!.id };
  },
);

export const retryDeadJob = ownerAction(z.object({ id: z.string().uuid() }), async ({ id }, user) => {
  assertAdmin(user);
  await db().update(schema.jobs).set({ status: "pending", attempts: 0, runAt: new Date(), lastError: null }).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "failed")));
  revalidatePath("/console/system");
});

export const testServerAi = ownerAction(z.object({ name: z.string().max(40) }), async ({ name }, user) => {
  assertAdmin(user);
  return testProvider(name);
});
