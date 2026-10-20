import { z } from "zod";
import { verifyOtp } from "@/lib/auth/otp";
import { clientIp, fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().regex(/^\d{6}$/) });

/**
 * Android sign-in, step 2: exchange the code for a session token. The app keeps it in
 * Keystore-encrypted storage and sends it as a bearer token. It shows up in Settings > Sessions
 * like any browser session and can be revoked there.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Enter the 6-digit code from your email.");
  const res = await verifyOtp(parsed.data.email, parsed.data.code, clientIp(req), { cookie: false });
  if (!res.ok || !res.sessionToken) return fail(401, res.message);
  return Response.json({ ok: true, token: res.sessionToken, isNew: Boolean(res.isNew) }, { headers: noStore });
}
