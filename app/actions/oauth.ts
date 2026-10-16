"use server";

import { z } from "zod";
import { getOwner } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/queries/activity";
import { appUrl } from "@/lib/env";
import { assertRedirect, createAuthCode, OAuthError, resolveClient } from "@/lib/mcp/oauth";
import { authorizeParamsSchema } from "@/lib/mcp/oauth-core";
import { parseScopes } from "@/lib/security/scopes";

/**
 * Consent decision. Returns the redirect URL; the client navigates there
 * (avoids CSP form-action limits on cross-origin redirects).
 */
export async function decideConsent(input: { params: Record<string, string>; approve: boolean; scopes: string[] }): Promise<{ ok: true; redirect: string } | { ok: false; error: string }> {
  const user = await getOwner();
  if (!user) return { ok: false, error: "Please sign in again." };
  const parsed = authorizeParamsSchema.safeParse(input.params);
  if (!parsed.success) return { ok: false, error: "This authorization request is invalid." };
  const p = parsed.data;
  try {
    const client = await resolveClient(p.client_id);
    assertRedirect(client, p.redirect_uri);
    const url = new URL(p.redirect_uri);
    if (p.state) url.searchParams.set("state", p.state);
    url.searchParams.set("iss", appUrl());
    if (!input.approve) {
      url.searchParams.set("error", "access_denied");
      await logActivity({ userId: user.id, actor: "me", tool: "oauth.denied", inputSummary: client.clientName, outcome: "denied" });
      return { ok: true, redirect: url.toString() };
    }
    const scopes = parseScopes(z.array(z.string()).max(10).parse(input.scopes));
    if (!scopes.length) return { ok: false, error: "Choose at least one permission." };
    const code = await createAuthCode({ userId: user.id, clientId: client.clientId, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, scopes, resource: p.resource });
    url.searchParams.set("code", code);
    await logActivity({ userId: user.id, actor: "me", tool: "oauth.approved", inputSummary: `${client.clientName}: ${scopes.join(" ")}`, outcome: "success" });
    return { ok: true, redirect: url.toString() };
  } catch (err) {
    return { ok: false, error: err instanceof OAuthError ? err.message : "Authorization failed." };
  }
}
