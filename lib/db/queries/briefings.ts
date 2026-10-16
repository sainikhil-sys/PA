import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function getBriefingForDate(userId: string, date: string) {
  return db().query.briefings.findFirst({
    where: and(eq(schema.briefings.userId, userId), eq(schema.briefings.date, date)),
  });
}

export async function latestBriefing(userId: string) {
  const [b] = await db()
    .select()
    .from(schema.briefings)
    .where(eq(schema.briefings.userId, userId))
    .orderBy(desc(schema.briefings.date))
    .limit(1);
  return b ?? null;
}
