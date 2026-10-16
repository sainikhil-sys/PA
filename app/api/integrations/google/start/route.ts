import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth/session";
import { appUrl, isProd } from "@/lib/env";
import { googleAuthUrl } from "@/lib/integrations/google";
import { randomToken } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

/** Starts the Google OAuth consent flow (Gmail read + drafts, Calendar read, Drive read). */
export async function GET(req: Request) {
  const user = await getOwner();
  if (!user) return Response.redirect(`${appUrl()}/login`, 302);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${appUrl()}/integrations?error=google_not_configured`, 302);
  }
  const returnTo = new URL(req.url).searchParams.get("returnTo");
  const state = randomToken(24);
  const jar = await cookies();
  jar.set("pa_google_state", state, { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    jar.set("pa_google_return", returnTo, { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
  }
  return Response.redirect(googleAuthUrl(state), 302);
}
