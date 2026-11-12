import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";
import { mayUseApp } from "@/lib/auth/policy";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { appUrl } from "@/lib/env";
import { sha256 } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Phone pairing: the QR code shown in Settings → Devices opens this URL on the phone.
 * The token is single use and expires after 10 minutes; it signs the phone in to the
 * account that created it, then lands on Devices to turn on notifications.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const fail = () => NextResponse.redirect(`${appUrl()}/login?paired=expired`, 303);
  if (!(await rateLimit("auth", `pair:${ip}`)).success || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) return fail();

  const [row] = await db()
    .update(schema.pairTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.pairTokens.tokenHash, sha256(token)), isNull(schema.pairTokens.usedAt), gt(schema.pairTokens.expiresAt, new Date())))
    .returning({ userId: schema.pairTokens.userId });
  if (!row) return fail();
  const user = await db().query.users.findFirst({ where: eq(schema.users.id, row.userId) });
  if (!user || user.disabledAt || !(await mayUseApp(user.email, { hasAccount: true }))) return fail();

  await createSession(user.id);
  await logActivity({ userId: user.id, actor: "me", tool: "devices.paired", inputSummary: "QR code", outcome: "success" });
  return NextResponse.redirect(`${appUrl()}/settings/devices?paired=1`, 303);
}
