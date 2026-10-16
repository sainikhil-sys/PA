import { and, desc, eq, or, like } from "drizzle-orm";
import type { Metadata } from "next";
import { AccountView } from "@/components/settings/account-view";
import { getSession, listSessions, requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireOwner();
  const [current, sessions, log] = await Promise.all([
    getSession(),
    listSessions(user.id),
    db()
      .select()
      .from(schema.activityLog)
      .where(and(eq(schema.activityLog.userId, user.id), or(like(schema.activityLog.tool, "auth.%"), like(schema.activityLog.tool, "integration.%"), like(schema.activityLog.tool, "token.%"), like(schema.activityLog.tool, "oauth.%"), like(schema.activityLog.tool, "approval.%"))))
      .orderBy(desc(schema.activityLog.createdAt))
      .limit(30),
  ]);
  return (
    <AccountView
      email={user.email}
      sessions={sessions.map((s) => ({ id: s.id, userAgent: s.userAgent, ipPrefix: s.ipPrefix, lastSeenAt: s.lastSeenAt.toISOString(), current: s.id === current?.sessionId }))}
      log={log.map((l) => ({ id: l.id, tool: l.tool, outcome: l.outcome, at: l.createdAt.toISOString(), detail: l.detail }))}
    />
  );
}
