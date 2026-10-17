import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { isPairCode, normalizePairCode } from "@/lib/phone";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().max(20), name: z.string().trim().min(1).max(60), model: z.string().trim().max(80).optional() });

/**
 * The Android app exchanges a one-time pairing code (shown in Cowork → Phone) for a long-lived
 * device token. Codes are single use and expire after 10 minutes.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit("auth", `phone-pair:${ip}`)).success) return Response.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const code = normalizePairCode(parsed.data.code);
  if (!isPairCode(code)) return Response.json({ error: "That code isn't valid." }, { status: 400 });

  const [row] = await db()
    .update(schema.phonePairCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.phonePairCodes.codeHash, sha256(code)), isNull(schema.phonePairCodes.usedAt), gt(schema.phonePairCodes.expiresAt, new Date())))
    .returning({ userId: schema.phonePairCodes.userId });
  if (!row) return Response.json({ error: "That code is wrong or expired. Get a new one in Cowork → Phone." }, { status: 400 });
  const user = await db().query.users.findFirst({ where: eq(schema.users.id, row.userId), columns: { id: true, name: true, email: true, disabledAt: true } });
  if (!user || user.disabledAt) return Response.json({ error: "This account can't link a phone." }, { status: 403 });

  const token = randomToken(32);
  const [device] = await db()
    .insert(schema.phoneDevices)
    .values({ userId: user.id, name: parsed.data.name, model: parsed.data.model ?? null, tokenHash: sha256(token), lastSeenAt: new Date() })
    .returning({ id: schema.phoneDevices.id });
  await logActivity({ userId: user.id, actor: "me", tool: "phone.linked", inputSummary: parsed.data.name, outcome: "success" });
  return Response.json({ token, deviceId: device!.id, account: user.name ?? user.email }, { headers: { "cache-control": "no-store" } });
}
