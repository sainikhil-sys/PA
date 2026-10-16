import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { verifyApiToken } from "@/lib/db/queries/tokens";
import { looksLikeToken } from "@/lib/security/tokens";

export type PaAuthExtra = { userId: string; tokenId: string; tokenName: string };

/**
 * Validates the bearer token on EVERY MCP request. Works for both manual
 * tokens (pa_mcp_) and OAuth access tokens (pa_oat_); both are stored hashed.
 */
export async function verifyMcpToken(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!looksLikeToken(bearer) || bearer.startsWith("pa_ort_")) return undefined;
  const row = await verifyApiToken(bearer);
  if (!row) return undefined;
  const extra: PaAuthExtra = { userId: row.userId, tokenId: row.id, tokenName: row.name };
  return {
    token: bearer,
    clientId: row.oauthClientId ?? `manual:${row.id}`,
    scopes: row.scopes,
    expiresAt: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : undefined,
    extra,
  };
}

export function authExtra(auth: AuthInfo | undefined): PaAuthExtra | null {
  const e = auth?.extra as Partial<PaAuthExtra> | undefined;
  return e?.userId && e.tokenId ? (e as PaAuthExtra) : null;
}
