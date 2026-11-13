import "server-only";
import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { flagContext, isFlagOn } from "@/lib/flags/store";

/**
 * Anonymous Spaces (B7). Inside one, a person appears only as a pseudonym ("Quiet Heron 42") that is
 * stable in that Space and unrelated in every other, so posts can't be linked across Spaces. The
 * link from pseudonym to account stays on the server; admins can read it only through the audited
 * console action (lib/admin/ops/anonymous.ts). Anonymous never means unmoderated: every post and
 * comment goes through the same moderation, reports and take-downs as anywhere else.
 */

export const ANON_FLAG = "social.anonymous";

const ADJECTIVES = [
  "Quiet", "Bright", "Calm", "Swift", "Gentle", "Bold", "Clever", "Steady", "Kind", "Curious", "Patient", "Brave",
  "Lucky", "Sunny", "Silver", "Amber", "Misty", "Rapid", "Humble", "Witty", "Nimble", "Quick", "Merry", "Noble",
] as const;
const ANIMALS = [
  "Heron", "Otter", "Falcon", "Fox", "Lynx", "Panda", "Robin", "Badger", "Koala", "Marten", "Owl", "Sparrow",
  "Turtle", "Wren", "Bison", "Crane", "Dolphin", "Gecko", "Ibis", "Jay", "Lark", "Moth", "Newt", "Puffin",
] as const;

export function randomAlias(): string {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${ANIMALS[randomInt(ANIMALS.length)]} ${randomInt(10, 100)}`;
}

/** Whether anonymous Spaces are switched on for this person (feature flag, off by default). */
export async function anonymousOn(user: Pick<User, "id" | "createdAt" | "disabledAt">): Promise<boolean> {
  let h: Pick<Headers, "get">;
  try {
    h = await headers();
  } catch {
    h = new Headers();
  }
  return isFlagOn(ANON_FLAG, await flagContext(user, h));
}

/** This person's pseudonym in this Space, created on first use. Retries on the rare alias clash. */
export async function identityFor(spaceId: string, userId: string): Promise<{ id: string; alias: string }> {
  const t = schema.anonIdentities;
  const find = async () => (await db().select({ id: t.id, alias: t.alias }).from(t).where(and(eq(t.spaceId, spaceId), eq(t.userId, userId))).limit(1))[0];
  const existing = await find();
  if (existing) return existing;
  for (let attempt = 0; attempt < 8; attempt++) {
    const [row] = await db().insert(t).values({ spaceId, userId, alias: randomAlias() }).onConflictDoNothing().returning({ id: t.id, alias: t.alias });
    if (row) return row;
    // Either this person already got one (a parallel request) or the alias is taken: look again, then retry.
    const again = await find();
    if (again) return again;
  }
  throw new Error("Couldn't create a pseudonym");
}

/** Whether a user's sign-in email is at a domain or one of its subdomains. */
export function emailInDomain(email: string, domain: string): boolean {
  const host = email.toLowerCase().split("@")[1] ?? "";
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

/** "stanford.edu", "ox.ac.uk": a plain domain, no scheme, no @, at least one dot. */
export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}
