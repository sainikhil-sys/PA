import "server-only";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { CONFIRM_TTL_MS, inputHash } from "./core";

/** Issues a one-time token for this action and this exact input, valid for 2 minutes. */
export async function issueConfirmation(userId: string, action: string, input: unknown): Promise<string> {
  const token = randomToken(24);
  // Old tokens are useless after 2 minutes; drop them so the table stays small.
  await db().delete(schema.adminConfirmations).where(lt(schema.adminConfirmations.expiresAt, new Date(Date.now() - 60 * 60_000)));
  await db()
    .insert(schema.adminConfirmations)
    .values({ userId, tokenHash: sha256(token), action, inputHash: inputHash(action, input), expiresAt: new Date(Date.now() + CONFIRM_TTL_MS) });
  return token;
}

/**
 * Uses a token once. True only for the same person, action and input, before it expires.
 * The conditional update wins exactly once, even with two concurrent commits.
 */
export async function consumeConfirmation(userId: string, action: string, input: unknown, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const used = await db()
    .update(schema.adminConfirmations)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.adminConfirmations.tokenHash, sha256(token)),
        eq(schema.adminConfirmations.userId, userId),
        eq(schema.adminConfirmations.action, action),
        eq(schema.adminConfirmations.inputHash, inputHash(action, input)),
        isNull(schema.adminConfirmations.usedAt),
        gt(schema.adminConfirmations.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.adminConfirmations.id });
  return used.length === 1;
}
