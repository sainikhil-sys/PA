import { createHash } from "node:crypto";
import { z } from "zod";
import { ALL_SCOPES, parseScopes, type Scope } from "@/lib/security/scopes";

/** Pure OAuth 2.1 helpers (no I/O) so they can be unit tested. */

export const ACCESS_TOKEN_TTL_S = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 30; // 30 days, rotated on use
export const AUTH_CODE_TTL_S = 60 * 5;

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  // RFC 7636: 43-128 chars from the unreserved set.
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return pkceChallengeS256(verifier) === challenge;
}

/** Default: only Claude's callback hosts (plus loopback for Claude Code / dev) may receive codes. */
export function allowedRedirectHosts(raw = process.env.MCP_OAUTH_ALLOWED_REDIRECT_HOSTS): string[] {
  return (raw ?? "claude.ai,claude.com,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedRedirectUri(uri: string, hosts = allowedRedirectHosts()): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return false;
  return hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

export function metadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ALL_SCOPES,
    client_id_metadata_document_supported: true,
  };
}

export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(100).default("MCP client"),
  redirect_uris: z.array(z.string().url().max(500)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().max(500).optional(),
});

export const authorizeParamsSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(500),
  redirect_uri: z.string().url().max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "invalid code_challenge"),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().url().max(500).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeParamsSchema>;

/** Requested scopes intersected with supported ones. Empty means all Cowork scopes (still subject to consent). */
export function resolveRequestedScopes(scope: string | undefined): Scope[] {
  const s = parseScopes(scope);
  return s.length ? s : ALL_SCOPES;
}

export const tokenRequestSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(10).max(200),
    redirect_uri: z.string().url().max(500),
    client_id: z.string().min(1).max(500),
    code_verifier: z.string().min(43).max(128),
    resource: z.string().url().max(500).optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(10).max(200),
    client_id: z.string().min(1).max(500),
    scope: z.string().max(500).optional(),
    resource: z.string().url().max(500).optional(),
  }),
]);

export function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
  );
}
