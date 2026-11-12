import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * The person's own Chats data for the export: their profile, friends and blocks (by handle),
 * the chats they are in, the messages they sent and their reactions, and the reports they filed.
 * Other people's messages and the text captured in reports are theirs, so they are left out.
 */
export async function socialExport(uid: string) {
  const s = schema;
  const [profile, pairs, blocks, memberships, sent, reactions, reports] = await Promise.all([
    db().select().from(s.socialProfiles).where(eq(s.socialProfiles.userId, uid)),
    db()
      .select()
      .from(s.friendships)
      .where(or(eq(s.friendships.userLow, uid), eq(s.friendships.userHigh, uid))),
    db().select().from(s.userBlocks).where(eq(s.userBlocks.blockerId, uid)),
    db()
      .select({ threadId: s.dmMembers.threadId, role: s.dmMembers.role, joinedAt: s.dmMembers.joinedAt, leftAt: s.dmMembers.leftAt, kind: s.dmThreads.kind, title: s.dmThreads.title })
      .from(s.dmMembers)
      .innerJoin(s.dmThreads, eq(s.dmThreads.id, s.dmMembers.threadId))
      .where(eq(s.dmMembers.userId, uid)),
    db()
      .select({ id: s.dmMessages.id, threadId: s.dmMessages.threadId, body: s.dmMessages.body, replyToId: s.dmMessages.replyToId, createdAt: s.dmMessages.createdAt, editedAt: s.dmMessages.editedAt })
      .from(s.dmMessages)
      .where(and(eq(s.dmMessages.senderId, uid), eq(s.dmMessages.kind, "text"), isNull(s.dmMessages.deletedAt))),
    db().select({ messageId: s.dmReactions.messageId, kind: s.dmReactions.kind, createdAt: s.dmReactions.createdAt }).from(s.dmReactions).where(eq(s.dmReactions.userId, uid)),
    db()
      .select({ id: s.userReports.id, reason: s.userReports.reason, details: s.userReports.details, status: s.userReports.status, createdAt: s.userReports.createdAt })
      .from(s.userReports)
      .where(eq(s.userReports.reporterId, uid)),
  ]);

  // Other people appear by their public handle only.
  const others = [...new Set([...pairs.map((p) => (p.userLow === uid ? p.userHigh : p.userLow)), ...blocks.map((b) => b.blockedId)])];
  const handles = new Map(
    others.length
      ? (await db().select({ userId: s.socialProfiles.userId, handle: s.socialProfiles.handle }).from(s.socialProfiles).where(inArray(s.socialProfiles.userId, others))).map((r) => [r.userId, r.handle])
      : [],
  );
  const handleOf = (id: string) => handles.get(id) ?? "(left Chats)";

  return {
    profile: profile[0] ?? null,
    friends: pairs.map((p) => {
      const other = p.userLow === uid ? p.userHigh : p.userLow;
      return { handle: handleOf(other), status: p.status, requestedByMe: p.requesterId === uid, createdAt: p.createdAt, respondedAt: p.respondedAt };
    }),
    blocked: blocks.map((b) => ({ handle: handleOf(b.blockedId), createdAt: b.createdAt })),
    chats: memberships,
    messagesSent: sent,
    reactions,
    reportsFiled: reports,
  };
}
