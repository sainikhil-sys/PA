import { randomToken, sha256 } from "./crypto";

/**
 * Token format: pa_<kind>_<random>. Only the SHA-256 hash is stored.
 * High-entropy random tokens make a fast hash appropriate (no password stretching needed).
 */
export type TokenKind = "mcp" | "oat" | "ort";

export function generateToken(kind: TokenKind = "mcp"): { token: string; hash: string; prefix: string } {
  const token = `pa_${kind}_${randomToken(32)}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 14) };
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function looksLikeToken(value: string | undefined | null): value is string {
  return typeof value === "string" && /^pa_(mcp|oat|ort)_[A-Za-z0-9_-]{32,}$/.test(value);
}

export function extractBearer(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}
