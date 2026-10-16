import "server-only";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { EmailCategory } from "@/lib/db/schema";

export const CATEGORIES: EmailCategory[] = ["URGENT", "REPLY_NEEDED", "FYI", "NEWSLETTER", "SPAM"];

export async function listEmails(
  userId: string,
  opts: { category?: EmailCategory | "UNCLASSIFIED"; limit?: number; important?: boolean } = {},
) {
  const conds = [eq(schema.emails.userId, userId)];
  if (opts.category === "UNCLASSIFIED") conds.push(isNull(schema.emails.category));
  else if (opts.category) conds.push(eq(schema.emails.category, opts.category));
  if (opts.important) conds.push(inArray(schema.emails.category, ["URGENT", "REPLY_NEEDED"]));
  return db()
    .select()
    .from(schema.emails)
    .where(and(...conds))
    .orderBy(desc(schema.emails.receivedAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

/** Important emails, most urgent first. Used by briefing, overview and MCP. */
export async function listImportantEmails(userId: string, limit = 10) {
  return db()
    .select()
    .from(schema.emails)
    .where(and(eq(schema.emails.userId, userId), inArray(schema.emails.category, ["URGENT", "REPLY_NEEDED"])))
    .orderBy(
      sql`case when ${schema.emails.category} = 'URGENT' then 0 else 1 end`,
      desc(schema.emails.priority),
      desc(schema.emails.receivedAt),
    )
    .limit(Math.min(limit, 50));
}

export async function getEmail(userId: string, id: string) {
  return db().query.emails.findFirst({ where: and(eq(schema.emails.id, id), eq(schema.emails.userId, userId)) });
}

export async function categoryCounts(userId: string) {
  const rows = await db()
    .select({ category: schema.emails.category, n: sql<number>`count(*)::int` })
    .from(schema.emails)
    .where(eq(schema.emails.userId, userId))
    .groupBy(schema.emails.category);
  const counts: Record<string, number> = { UNCLASSIFIED: 0 };
  for (const c of CATEGORIES) counts[c] = 0;
  for (const r of rows) counts[r.category ?? "UNCLASSIFIED"] = r.n;
  return counts;
}

/** Emails awaiting classification (bounded retry count so a bad email can't loop forever). */
export async function unclassifiedEmails(userId: string, limit: number) {
  return db()
    .select()
    .from(schema.emails)
    .where(and(eq(schema.emails.userId, userId), isNull(schema.emails.category), lt(schema.emails.classifyAttempts, 3)))
    .orderBy(desc(schema.emails.receivedAt))
    .limit(limit);
}
