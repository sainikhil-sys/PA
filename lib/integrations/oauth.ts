import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/security/crypto";
import { ensureSource } from "@/lib/knowledge/ingest";

/** OAuth apps you register with each provider. Credentials come only from env vars. */
type OAuthProvider = {
  name: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  /** How the client authenticates at the token endpoint. */
  tokenAuth: "body" | "basic";
  profile: (token: string) => Promise<{ label: string; config: Record<string, unknown> }>;
  knowledgeSource?: string;
};

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  linkedin: {
    name: "LinkedIn",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    pkce: false,
    tokenAuth: "body",
    profile: async (token) => {
      const r = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`LinkedIn profile returned ${r.status}`);
      const d = (await r.json()) as { sub: string; name?: string };
      return { label: d.name ?? "LinkedIn", config: { sub: d.sub } };
    },
  },
  canva: {
    name: "Canva",
    clientIdEnv: "CANVA_CLIENT_ID",
    clientSecretEnv: "CANVA_CLIENT_SECRET",
    authorizeUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
    scopes: ["design:meta:read", "profile:read"],
    pkce: true,
    tokenAuth: "basic",
    profile: async (token) => {
      const r = await fetch("https://api.canva.com/rest/v1/users/me/profile", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      const d = r.ok ? ((await r.json()) as { profile?: { display_name?: string } }) : {};
      return { label: d.profile?.display_name ?? "Canva", config: {} };
    },
    knowledgeSource: "Canva designs",
  },
};

export function oauthConfigured(provider: string): boolean {
  const p = OAUTH_PROVIDERS[provider];
  return Boolean(p && process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
}

export const redirectUri = (provider: string) => `${appUrl()}/api/integrations/${provider}/callback`;

export function authorizeUrl(provider: string, state: string, challenge: string | null): string {
  const p = OAUTH_PROVIDERS[provider]!;
  const u = new URL(p.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env[p.clientIdEnv]!);
  u.searchParams.set("redirect_uri", redirectUri(provider));
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("state", state);
  if (p.pkce && challenge) {
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

async function tokenRequest(provider: string, params: Record<string, string>): Promise<TokenResponse> {
  const p = OAUTH_PROVIDERS[provider]!;
  const id = process.env[p.clientIdEnv]!;
  const secret = process.env[p.clientSecretEnv]!;
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (p.tokenAuth === "basic") headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  else {
    body.set("client_id", id);
    body.set("client_secret", secret);
  }
  const r = await fetch(p.tokenUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${p.name} token endpoint returned ${r.status}`);
  return (await r.json()) as TokenResponse;
}

export async function completeOAuth(userId: string, provider: string, code: string, verifier: string | null) {
  const p = OAUTH_PROVIDERS[provider]!;
  const t = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider), ...(verifier ? { code_verifier: verifier } : {}) });
  const prof = await p.profile(t.access_token);
  const values = {
    status: "connected",
    accountLabel: prof.label.slice(0, 120),
    scopes: (t.scope ?? p.scopes.join(" ")).split(/[ ,]+/).filter(Boolean),
    accessTokenEnc: encrypt(t.access_token),
    refreshTokenEnc: t.refresh_token ? encrypt(t.refresh_token) : null,
    accessTokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    config: prof.config,
    lastError: null,
  };
  await db().insert(schema.integrations).values({ userId, provider, ...values }).onConflictDoUpdate({ target: [schema.integrations.userId, schema.integrations.provider], set: values });
  if (p.knowledgeSource) await ensureSource(userId, provider, p.knowledgeSource);
}

/** Current access token, refreshing it first if it's about to expire. */
export async function oauthAccessToken(userId: string, provider: string): Promise<{ token: string; config: Record<string, unknown> }> {
  const row = await db().query.integrations.findFirst({ where: and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, provider)) });
  if (!row?.accessTokenEnc || row.status === "disconnected") throw new Error(`${provider} isn't connected`);
  const soon = row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() < Date.now() + 60_000;
  if (!soon) return { token: decrypt(row.accessTokenEnc), config: row.config };
  if (!row.refreshTokenEnc) {
    await db().update(schema.integrations).set({ status: "error", lastError: "Access expired. Reconnect." }).where(eq(schema.integrations.id, row.id));
    throw new Error(`${provider} access expired. Reconnect on the Integrations page.`);
  }
  const t = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: decrypt(row.refreshTokenEnc) });
  await db()
    .update(schema.integrations)
    .set({
      accessTokenEnc: encrypt(t.access_token),
      refreshTokenEnc: t.refresh_token ? encrypt(t.refresh_token) : row.refreshTokenEnc,
      accessTokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      status: "connected",
      lastError: null,
    })
    .where(eq(schema.integrations.id, row.id));
  return { token: t.access_token, config: row.config };
}
