import { z } from "zod";
import { requestOtp } from "@/lib/auth/otp";
import { clientIp, fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Android sign-in, step 1: email a 6-digit code. Same policy and rate limits as the web sign-in. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Enter a valid email address.");
  const res = await requestOtp(parsed.data.email, clientIp(req));
  return Response.json(res, { status: res.ok ? 200 : 400, headers: noStore });
}
