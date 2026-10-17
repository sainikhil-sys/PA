import { eq } from "drizzle-orm";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-click export of all my data (?format=json|md). Secrets are excluded:
 * no OAuth tokens, token hashes, session hashes, OTP hashes or embeddings.
 */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const uid = g.user.id;
  const format = new URL(req.url).searchParams.get("format") === "md" ? "md" : "json";
  const by = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, uid);

  const [settings, tasks, comments, emails, briefings, notes, memories, conversations, messages, automations, runs, ideas, drafts, sources, items, activity] = await Promise.all([
    db().select().from(schema.userSettings).where(by(schema.userSettings)),
    db().select().from(schema.tasks).where(by(schema.tasks)),
    db().select().from(schema.taskComments).where(by(schema.taskComments)),
    db().select({ id: schema.emails.id, from: schema.emails.fromEmail, subject: schema.emails.subject, category: schema.emails.category, summary: schema.emails.summary, receivedAt: schema.emails.receivedAt }).from(schema.emails).where(by(schema.emails)),
    db().select().from(schema.briefings).where(by(schema.briefings)),
    db().select({ id: schema.notes.id, title: schema.notes.title, content: schema.notes.content, source: schema.notes.source, createdAt: schema.notes.createdAt }).from(schema.notes).where(by(schema.notes)),
    db().select().from(schema.memories).where(by(schema.memories)),
    db().select().from(schema.conversations).where(by(schema.conversations)),
    db().select().from(schema.messages).where(by(schema.messages)),
    db().select({ id: schema.automations.id, name: schema.automations.name, trigger: schema.automations.trigger, conditions: schema.automations.conditions, actions: schema.automations.actions, enabled: schema.automations.enabled }).from(schema.automations).where(by(schema.automations)),
    db().select().from(schema.automationRuns).where(by(schema.automationRuns)),
    db().select().from(schema.ideas).where(by(schema.ideas)),
    db().select().from(schema.contentDrafts).where(by(schema.contentDrafts)),
    db().select({ id: schema.knowledgeSources.id, type: schema.knowledgeSources.type, name: schema.knowledgeSources.name, itemCount: schema.knowledgeSources.itemCount }).from(schema.knowledgeSources).where(by(schema.knowledgeSources)),
    db().select({ id: schema.knowledgeItems.id, title: schema.knowledgeItems.title, url: schema.knowledgeItems.url, sourceId: schema.knowledgeItems.sourceId }).from(schema.knowledgeItems).where(by(schema.knowledgeItems)),
    db().select().from(schema.activityLog).where(by(schema.activityLog)),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    profile: { email: g.user.email, name: g.user.name, role: g.user.role, bio: g.user.bio },
    settings,
    tasks,
    taskComments: comments,
    emails,
    briefings,
    notes,
    memories,
    conversations,
    messages,
    automations,
    automationRuns: runs,
    ideas,
    contentDrafts: drafts,
    knowledgeSources: sources,
    knowledgeItems: items,
    activity,
  };
  await logActivity({ userId: uid, actor: "me", tool: "data.exported", inputSummary: format, outcome: "success" });
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="cowork-export-${stamp}.json"`, "cache-control": "no-store" } });
  }
  const md = [
    `# Cowork export — ${stamp}`,
    `\n## Profile\n\n- ${g.user.name ?? ""} <${g.user.email}>${g.user.role ? ` — ${g.user.role}` : ""}`,
    `\n## Tasks (${tasks.length})\n`,
    ...tasks.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`),
    `\n## Notes (${notes.length})\n`,
    ...notes.map((n) => `### ${n.title}\n\n${n.content}\n`),
    `\n## Memories\n`,
    ...memories.map((m) => `- ${m.content}`),
    `\n## Content drafts (${drafts.length})\n`,
    ...drafts.map((d) => `### ${d.title} — ${d.status}\n\n${d.body}\n`),
    `\n## Conversations (${conversations.length})\n`,
    ...conversations.map((c) => [`### ${c.title}`, ...messages.filter((m) => m.conversationId === c.id).map((m) => `**${m.role === "user" ? "You" : "Agent"}:** ${m.content}\n`)].join("\n\n")),
  ].join("\n");
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="cowork-export-${stamp}.md"`, "cache-control": "no-store" } });
}
