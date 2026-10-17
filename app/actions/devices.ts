"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { z } from "zod";
import { ownerAction } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { appUrl } from "@/lib/env";
import { sendPush } from "@/lib/push";
import { randomToken, sha256 } from "@/lib/security/crypto";

function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${browser}`;
}

/** Save this browser's push subscription (after the user allowed notifications). */
export const savePushSubscription = ownerAction(
  z.object({
    endpoint: z.string().url().max(1000).startsWith("https://"),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  }),
  async (input, user) => {
    const ua = (await headers()).get("user-agent") ?? "";
    await db()
      .insert(schema.pushSubscriptions)
      .values({ userId: user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, label: deviceLabel(ua) })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, label: deviceLabel(ua) } });
    await logActivity({ userId: user.id, actor: "me", tool: "devices.push_enabled", inputSummary: deviceLabel(ua), outcome: "success" });
  },
);

export const removeDevice = ownerAction(z.object({ id: z.string().uuid() }), async ({ id }, user) => {
  await db().delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.id, id), eq(schema.pushSubscriptions.userId, user.id)));
});

export const sendTestPush = ownerAction(z.object({}), async (_i, user) => {
  const n = await sendPush(user.id, { title: "Cowork is connected", body: "Notifications will show up on this device.", href: "/", tag: "test" });
  if (!n) throw new Error("No paired device received it. Enable notifications on the device first.");
  return { devices: n };
});

/** QR code that signs a phone in to THIS account: single use, valid 10 minutes. */
export const createPairCode = ownerAction(z.object({}), async (_i, user) => {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await db().insert(schema.pairTokens).values({ userId: user.id, tokenHash: sha256(token), expiresAt });
  const url = `${appUrl()}/pair/${token}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0a0a0a", light: "#ffffff" } });
  await logActivity({ userId: user.id, actor: "me", tool: "devices.pair_code", outcome: "success" });
  return { svg, url, expiresAt: expiresAt.toISOString() };
});
