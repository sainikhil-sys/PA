import "server-only";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Scope } from "@/lib/security/scopes";
import { generateToken, hashToken } from "@/lib/security/tokens";

/** Create a manual MCP token. The raw token is returned ONCE and never stored. */
export async function createApiToken(userId: string, input: { name: string; scopes: Scope[]; expiresInDays: number | null }) {
  const { token, hash, prefix } = generateToken("mcp");
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const [row] = await db()
    .insert(schema.apiTokens)
    .values({ userId, name: input.name, tokenHash: hash, prefix, scopes: input.scopes, expiresAt, kind: "manual" })
    .returning();
  return { token, record: row! };
}

export async function listApiTokens(userId: string) {
  return db()
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      prefix: schema.apiTokens.prefix,
      kind: schema.apiTokens.kind,
      oauthClientId: schema.apiTokens.oauthClientId,
      scopes: schema.apiTokens.scopes,
      expiresAt: schema.apiTokens.expiresAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      revokedAt: schema.apiTokens.revokedAt,
      createdAt: schema.apiTokens.createdAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .orderBy(desc(schema.apiTokens.createdAt))
    .limit(100);
}

export async function revokeApiToken(userId: string, id: string) {
  const [row] = await db()
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, userId), isNull(schema.apiTokens.revokedAt)))
    .returning({ id: schema.apiTokens.id, oauthClientId: schema.apiTokens.oauthClientId });
  // Revoking an OAuth access token also revokes that client's refresh tokens.
  if (row?.oauthClientId) {
    await db()
      .update(schema.oauthRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.oauthRefreshTokens.userId, userId), eq(schema.oauthRefreshTokens.clientId, row.oauthClientId)));
  }
  return Boolean(row);
}

/** Validate a bearer token: exists, not revoked, not expired. Updates last-used (throttled). */
export async function verifyApiToken(raw: string) {
  const now = new Date();
  const [row] = await db()
    .select()
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.tokenHash, hashToken(raw)),
        isNull(schema.apiTokens.revokedAt),
        or(isNull(schema.apiTokens.expiresAt), gt(schema.apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db().update(schema.apiTokens).set({ lastUsedAt: now }).where(eq(schema.apiTokens.id, row.id));
  }
  return row;
}

/** Connection status for the Connect Claude page. */
export async function connectionStatus(userId: string) {
  const tokens = await listApiTokens(userId);
  const active = tokens.filter((t) => !t.revokedAt && (!t.expiresAt || t.expiresAt > new Date()));
  const lastUsed = active.map((t) => t.lastUsedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  return { activeTokens: active.length, lastUsedAt: lastUsed ?? null };
}
