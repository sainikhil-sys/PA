"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { newPairCode } from "@/lib/phone-server";
import { sha256 } from "@/lib/security/crypto";

/** One-time code to link a phone (typed or scanned in the Android app). Valid 10 minutes. */
export const createPhonePairCode = ownerAction(z.object({}), async (_i, user) => {
  const code = newPairCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await db().insert(schema.phonePairCodes).values({ userId: user.id, codeHash: sha256(code), expiresAt });
  return { code, expiresAt: expiresAt.toISOString() };
});

export const setPhonePaused = ownerAction(z.object({ id: z.string().uuid(), paused: z.boolean() }), async ({ id, paused }, user) => {
  await db().update(schema.phoneDevices).set({ paused }).where(and(eq(schema.phoneDevices.id, id), eq(schema.phoneDevices.userId, user.id)));
  revalidatePath("/phone");
});

/** Unlink: the phone's token stops working and its events are deleted. */
export const unlinkPhone = ownerAction(z.object({ id: z.string().uuid() }), async ({ id }, user) => {
  await db().update(schema.phoneDevices).set({ revokedAt: new Date() }).where(and(eq(schema.phoneDevices.id, id), eq(schema.phoneDevices.userId, user.id), isNull(schema.phoneDevices.revokedAt)));
  await db().delete(schema.phoneEvents).where(and(eq(schema.phoneEvents.deviceId, id), eq(schema.phoneEvents.userId, user.id)));
  await logActivity({ userId: user.id, actor: "me", tool: "phone.unlinked", outcome: "success" });
  revalidatePath("/phone");
});

export const clearPhoneEvents = ownerAction(z.object({}), async (_i, user) => {
  await db().delete(schema.phoneEvents).where(eq(schema.phoneEvents.userId, user.id));
  revalidatePath("/phone");
});

export const markPhoneRead = ownerAction(z.object({}), async (_i, user) => {
  await db().update(schema.phoneEvents).set({ readAt: new Date() }).where(and(eq(schema.phoneEvents.userId, user.id), isNull(schema.phoneEvents.readAt)));
});
