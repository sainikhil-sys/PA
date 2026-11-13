import "server-only";
import { createHmac, createPrivateKey, createPublicKey, diffieHellman, timingSafeEqual, type KeyObject } from "node:crypto";
import { and, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { SocialError } from "@/lib/social/service";
import { displayNames, FALLBACK_NAME, isUniqueViolation } from "@/lib/spaces/connect";

/**
 * Connect key registry. A phone registers its Connect public key (X25519, from the app's Noise
 * identity) so people who know you can recognise it when you meet offline.
 *
 * Proof that a person holds the private half of the key they register, so nobody can claim someone
 * else's public key (keys are public: anyone you met offline knows yours). The server has a static
 * X25519 key derived from ENCRYPTION_KEY (or AUTH_SECRET). The app computes
 *   shared = X25519(connectPrivateKey, serverPublicKey)
 *   proof  = HMAC-SHA256(key = shared, message = "cowork-connect-key-v1|<account id>|<public key hex>")
 * and the server recomputes it with its private key. Binding the account id stops a proof being
 * reused by another account. No secret leaves the phone.
 *
 * Lookups return a key's owner only to people who share a (non-anonymous) Space with them, or are
 * their friends, and never when either has blocked the other.
 */
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
export const KEY_HEX = /^[0-9a-f]{64}$/;
export const PROOF_HEX = /^[0-9a-f]{64}$/;
export const MAX_KEYS = 5;
export const MAX_RESOLVE = 100;

let server: { privateKey: KeyObject; publicHex: string } | null | undefined;

function serverKey() {
  if (server !== undefined) return server;
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    server = null;
    return server;
  }
  const raw = createHmac("sha256", secret).update("cowork-connect-key-proof-v1").digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  server = { privateKey, publicHex: Buffer.from(spki).subarray(-32).toString("hex") };
  return server;
}

/** For tests: forget the cached server key so a changed secret takes effect. */
export function resetServerKeyForTests() {
  server = undefined;
}

/** Hex X25519 public key the app proves against, or null when the server has no secret configured. */
export function serverPublicKeyHex(): string | null {
  return serverKey()?.publicHex ?? null;
}

export function proofMessage(userId: string, publicKeyHex: string): string {
  return `cowork-connect-key-v1|${userId}|${publicKeyHex}`;
}

export function verifyKeyProof(userId: string, publicKeyHex: string, proofHex: string): boolean {
  const s = serverKey();
  if (!s || !KEY_HEX.test(publicKeyHex) || !PROOF_HEX.test(proofHex)) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_X25519, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    const shared = diffieHellman({ privateKey: s.privateKey, publicKey });
    // A low-order public key gives an all-zero secret that anyone could "prove".
    if (shared.every((b) => b === 0)) return false;
    const expected = createHmac("sha256", shared).update(proofMessage(userId, publicKeyHex)).digest();
    return timingSafeEqual(expected, Buffer.from(proofHex, "hex"));
  } catch {
    return false;
  }
}

const k = schema.connectKeys;

/** Your registered keys, plus what the app needs to prove a new one (account id and server key). */
export async function myKeys(user: User) {
  const items = await db().select({ publicKey: k.publicKey, label: k.label, createdAt: k.createdAt }).from(k).where(eq(k.userId, user.id)).orderBy(desc(k.createdAt));
  return { account: user.id, serverKey: serverPublicKeyHex(), items: items.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })) };
}

/** Registers this phone's key. Already yours: fine. Someone else's: refused. */
export async function registerKey(user: User, input: { publicKey: string; proof: string; label: string }) {
  if (!serverPublicKeyHex()) throw new SocialError(503, "Key registration isn't set up on this server yet.");
  if (!verifyKeyProof(user.id, input.publicKey, input.proof)) throw new SocialError(400, "This phone couldn't prove it holds that key.");
  const [existing] = await db().select({ userId: k.userId }).from(k).where(eq(k.publicKey, input.publicKey)).limit(1);
  if (existing) {
    if (existing.userId === user.id) return { ok: true };
    throw new SocialError(409, "This key is registered to another account.");
  }
  const [n] = await db().select({ n: count() }).from(k).where(eq(k.userId, user.id));
  if (Number(n?.n ?? 0) >= MAX_KEYS) throw new SocialError(422, `You can register up to ${MAX_KEYS} phones. Remove one first.`);
  try {
    await db().insert(k).values({ userId: user.id, publicKey: input.publicKey, label: input.label });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SocialError(409, "This key is registered to another account.");
    throw err;
  }
  return { ok: true };
}

export async function removeKey(user: User, publicKey: string) {
  await db()
    .delete(k)
    .where(and(eq(k.userId, user.id), eq(k.publicKey, publicKey)));
  return { ok: true };
}

export type Relations = { spaceMates: Set<string>; friends: Set<string>; blocked: Set<string> };

/**
 * Who may be recognised: yourself, and people who share a Space with you or are your friends,
 * unless either of you blocked the other. Pure, so the rule is tested on its own.
 */
export function mayRecognise(viewerId: string, ownerId: string, rel: Relations): boolean {
  if (ownerId === viewerId) return true;
  if (rel.blocked.has(ownerId)) return false;
  return rel.spaceMates.has(ownerId) || rel.friends.has(ownerId);
}

/** How the viewer relates to these people: shared active Space membership, friendship, blocks. */
async function relationsWith(viewerId: string, others: string[]): Promise<Relations> {
  if (!others.length) return { spaceMates: new Set(), friends: new Set(), blocked: new Set() };
  const me = alias(schema.spaceMembers, "me");
  const them = alias(schema.spaceMembers, "them");
  const s = schema.spaces;
  const f = schema.friendships;
  const b = schema.userBlocks;
  const [mates, friends, blocks] = await Promise.all([
    // Anonymous Spaces never count: recognising someone would reveal who is behind a pseudonym.
    db()
      .selectDistinct({ userId: them.userId })
      .from(me)
      .innerJoin(them, eq(them.spaceId, me.spaceId))
      .innerJoin(s, eq(s.id, me.spaceId))
      .where(and(eq(me.userId, viewerId), eq(me.status, "active"), eq(them.status, "active"), inArray(them.userId, others), eq(s.anonymous, false), ne(s.status, "removed"))),
    db()
      .select({ low: f.userLow, high: f.userHigh })
      .from(f)
      .where(and(eq(f.status, "accepted"), or(and(eq(f.userLow, viewerId), inArray(f.userHigh, others)), and(eq(f.userHigh, viewerId), inArray(f.userLow, others))))),
    db()
      .select({ blockerId: b.blockerId, blockedId: b.blockedId })
      .from(b)
      .where(or(and(eq(b.blockerId, viewerId), inArray(b.blockedId, others)), and(eq(b.blockedId, viewerId), inArray(b.blockerId, others)))),
  ]);
  return {
    spaceMates: new Set(mates.map((x) => x.userId)),
    friends: new Set(friends.map((x) => (x.low === viewerId ? x.high : x.low))),
    blocked: new Set(blocks.map((x) => (x.blockerId === viewerId ? x.blockedId : x.blockerId))),
  };
}

/**
 * Which of these keys belong to people the viewer may recognise. Anyone else's keys are simply not
 * returned, so this can't be used to look up strangers.
 */
export async function resolveKeys(user: User, keys: string[]) {
  const unique = [...new Set(keys)].slice(0, MAX_RESOLVE);
  if (!unique.length) return { items: [] };
  const rows = await db().select({ publicKey: k.publicKey, userId: k.userId }).from(k).where(inArray(k.publicKey, unique));
  const others = [...new Set(rows.map((x) => x.userId).filter((id) => id !== user.id))];
  const rel = await relationsWith(user.id, others);
  const visible = rows.filter((x) => mayRecognise(user.id, x.userId, rel));
  const names = await displayNames(visible.map((x) => x.userId));
  return { items: visible.map((x) => ({ publicKey: x.publicKey, userId: x.userId, name: names.get(x.userId) ?? FALLBACK_NAME, isMe: x.userId === user.id })) };
}
