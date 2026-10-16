import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { randomToken, sha256 } from "@/lib/security/crypto";
import type { Scope } from "@/lib/security/scopes";
import { generateToken, hashToken } from "@/lib/security/tokens";
import {
  ACCESS_TOKEN_TTL_S,
  AUTH_CODE_TTL_S,
  isAllowedRedirectUri,
  REFRESH_TOKEN_TTL_S,
  registrationSchema,
  verifyPkce,
} from "./oauth-core";

export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type OAuthClient = { clientId: string; clientName: string; redirectUris: string[] };

/** Dynamic Client Registration (RFC 7591). Redirect URIs must be on the allowlist. */
export async function registerClient(body: unknown): Promise<OAuthClient> {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError("invalid_client_metadata", parsed.error.issues[0]?.message ?? "Invalid metadata");
  const bad = parsed.data.redirect_uris.find((u) => !isAllowedRedirectUri(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", "Redirect URI host is not allowed for this server");
  const clientId = `pa_client_${randomToken(16)}`;
  await db().insert(schema.oauthClients).values({
    clientId,
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
    registration: "dynamic",
  });
  return { clientId, clientName: parsed.data.client_name, redirectUris: parsed.data.redirect_uris };
}

const cimdSchema = z.object({
  client_id: z.string().url(),
  client_name: z.string().max(100).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
});

/** Client ID Metadata Document: client_id is an HTTPS URL serving the client's metadata. */
async function fetchCimd(clientId: string): Promise<OAuthClient> {
  const url = new URL(clientId);
  if (url.protocol !== "https:" || /^(\d+\.){3}\d+$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new OAuthError("invalid_client", "Client metadata URL must be HTTPS with a hostname");
  }
  // Only fetch metadata from hosts we would redirect to anyway (prevents SSRF to arbitrary hosts).
  if (!isAllowedRedirectUri(`https://${url.hostname}/`)) throw new OAuthError("invalid_client", "Client host not allowed");
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
  if (!res.ok) throw new OAuthError("invalid_client", "Could not fetch client metadata");
  const text = await res.text();
  if (text.length > 64_000) throw new OAuthError("invalid_client", "Client metadata too large");
  const doc = cimdSchema.safeParse(JSON.parse(text));
  if (!doc.success || doc.data.client_id !== clientId) throw new OAuthError("invalid_client", "Invalid client metadata document");
  return { clientId, clientName: doc.data.client_name ?? url.hostname, redirectUris: doc.data.redirect_uris };
}

export async function resolveClient(clientId: string): Promise<OAuthClient> {
  const row = await db().query.oauthClients.findFirst({ where: eq(schema.oauthClients.clientId, clientId) });
  if (row) return { clientId: row.clientId, clientName: row.clientName, redirectUris: row.redirectUris };
  if (/^https:\/\//.test(clientId)) {
    const client = await fetchCimd(clientId);
    await db()
      .insert(schema.oauthClients)
      .values({ clientId, clientName: client.clientName, redirectUris: client.redirectUris, registration: "cimd" })
      .onConflictDoNothing();
    return client;
  }
  throw new OAuthError("invalid_client", "Unknown client");
}

export function assertRedirect(client: OAuthClient, redirectUri: string) {
  if (!client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri does not match the registered client");
  }
}

export async function createAuthCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: Scope[];
  resource?: string;
}) {
  const code = randomToken(32);
  await db()
    .insert(schema.oauthCodes)
    .values({ ...input, codeHash: sha256(code), resource: input.resource ?? null, expiresAt: new Date(Date.now() + AUTH_CODE_TTL_S * 1000) });
  return code;
}

async function issueTokens(userId: string, client: OAuthClient, scopes: string[], resource: string | null) {
  // One active access token per client: older ones are revoked on refresh/re-consent.
  await db()
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.userId, userId), eq(schema.apiTokens.oauthClientId, client.clientId), isNull(schema.apiTokens.revokedAt)));

  const access = generateToken("oat");
  await db().insert(schema.apiTokens).values({
    userId,
    name: `${client.clientName} (OAuth)`,
    tokenHash: access.hash,
    prefix: access.prefix,
    kind: "oauth",
    oauthClientId: client.clientId,
    scopes,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000),
  });
  const refresh = generateToken("ort");
  await db().insert(schema.oauthRefreshTokens).values({
    userId,
    tokenHash: refresh.hash,
    clientId: client.clientId,
    scopes,
    resource,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_S * 1000),
  });
  return {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refresh.token,
    scope: scopes.join(" "),
  };
}

export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }) {
  const now = new Date();
  // Mark used atomically: a code can be redeemed exactly once.
  const [row] = await db()
    .update(schema.oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.oauthCodes.codeHash, sha256(input.code)), isNull(schema.oauthCodes.usedAt), gt(schema.oauthCodes.expiresAt, now)))
    .returning();
  if (!row) throw new OAuthError("invalid_grant", "Authorization code is invalid or expired");
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) {
    throw new OAuthError("invalid_grant", "Code was issued to a different client or redirect URI");
  }
  if (!verifyPkce(input.codeVerifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
  const client = await resolveClient(row.clientId);
  const tokens = await issueTokens(row.userId, client, row.scopes, row.resource);
  await logActivity({ userId: row.userId, actor: "claude", tool: "oauth.token", inputSummary: client.clientName, outcome: "success" });
  return tokens;
}

/** Refresh token rotation: the presented token is revoked and a new pair issued. */
export async function refreshTokens(input: { refreshToken: string; clientId: string }) {
  const now = new Date();
  const [row] = await db()
    .update(schema.oauthRefreshTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.oauthRefreshTokens.tokenHash, hashToken(input.refreshToken)),
        isNull(schema.oauthRefreshTokens.revokedAt),
        gt(schema.oauthRefreshTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row || row.clientId !== input.clientId) throw new OAuthError("invalid_grant", "Refresh token is invalid or expired");
  const client = await resolveClient(row.clientId);
  return issueTokens(row.userId, client, row.scopes, row.resource);
}

export async function revokeToken(token: string) {
  const h = hashToken(token);
  await db().update(schema.apiTokens).set({ revokedAt: new Date() }).where(eq(schema.apiTokens.tokenHash, h));
  await db().update(schema.oauthRefreshTokens).set({ revokedAt: new Date() }).where(eq(schema.oauthRefreshTokens.tokenHash, h));
}
