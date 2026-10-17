import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth/session";
import { appUrl, isProd } from "@/lib/env";
import { authorizeUrl, OAUTH_PROVIDERS, oauthConfigured } from "@/lib/integrations/oauth";
import { pkceChallengeS256 } from "@/lib/mcp/oauth-core";
import { randomToken } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

/** Starts OAuth for LinkedIn / Canva (state + PKCE kept in short-lived httpOnly cookies). */
export async function GET(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const user = await getOwner();
  if (!user) return Response.redirect(`${appUrl()}/login`, 302);
  if (!OAUTH_PROVIDERS[provider]) return Response.redirect(`${appUrl()}/integrations?error=unknown`, 302);
  if (!oauthConfigured(provider)) return Response.redirect(`${appUrl()}/integrations?error=${provider}_not_configured`, 302);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const jar = await cookies();
  const opts = { httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: `/api/integrations/${provider}`, maxAge: 600 };
  jar.set("pa_oauth_state", state, opts);
  jar.set("pa_oauth_verifier", verifier, opts);
  return Response.redirect(authorizeUrl(provider, state, pkceChallengeS256(verifier)), 302);
}
