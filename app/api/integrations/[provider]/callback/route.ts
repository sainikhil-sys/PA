import { cookies } from "next/headers";
import { getOwner } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/queries/activity";
import { appUrl } from "@/lib/env";
import { completeOAuth, OAUTH_PROVIDERS } from "@/lib/integrations/oauth";
import { errMessage, log } from "@/lib/log";
import { safeEqual } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const user = await getOwner();
  if (!user) return Response.redirect(`${appUrl()}/login`, 302);
  if (!OAUTH_PROVIDERS[provider]) return Response.redirect(`${appUrl()}/integrations?error=unknown`, 302);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("pa_oauth_state")?.value;
  const verifier = jar.get("pa_oauth_verifier")?.value ?? null;
  jar.delete("pa_oauth_state");
  jar.delete("pa_oauth_verifier");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!expected || !state || !safeEqual(expected, state)) return Response.redirect(`${appUrl()}/integrations?error=state`, 302);
  if (!code) return Response.redirect(`${appUrl()}/integrations?error=denied`, 302);
  try {
    await completeOAuth(user.id, provider, code, OAUTH_PROVIDERS[provider]!.pkce ? verifier : null);
    await logActivity({ userId: user.id, actor: "me", tool: "integration.connected", inputSummary: provider, outcome: "success" });
    return Response.redirect(`${appUrl()}/integrations?connected=${provider}`, 302);
  } catch (err) {
    log.error("oauth.connect_failed", { provider, error: errMessage(err) });
    return Response.redirect(`${appUrl()}/integrations?error=${provider}`, 302);
  }
}
