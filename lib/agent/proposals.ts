import "server-only";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { draftReply } from "@/lib/agents/emailAgent";
import { queueRun } from "@/lib/automations/events";
import { draftPostFromIdeaText } from "@/lib/content/drafts";
import { db, schema } from "@/lib/db";
import type { Proposal, ProposalKind, User } from "@/lib/db/schema";
import { logActivity } from "@/lib/db/queries/activity";
import { getSettings } from "@/lib/db/queries/settings";
import { createTask } from "@/lib/db/queries/tasks";
import { addTextToKnowledge } from "@/lib/knowledge/ingest";
import { parseQuickAdd } from "@/lib/tasks/quick-add";
import type { PlannedAction } from "./plan";

/**
 * The approval queue. Agents, voice and automations only CREATE proposals.
 * Execution happens here, only after the owner clicks Approve. There is no
 * proposal kind that sends, posts, pays or deletes.
 */
export const PROPOSAL_LABEL: Record<ProposalKind, string> = {
  create_task: "Create task",
  create_draft: "Create Gmail draft",
  schedule_task: "Schedule task",
  run_automation: "Run automation",
  create_linkedin_draft: "Create LinkedIn draft",
  add_note: "Add note to knowledge base",
  notify: "Notify me",
};

export async function proposalFromAction(user: User, a: PlannedAction, origin: { source: string; conversationId?: string; automationRunId?: string }): Promise<Proposal | null> {
  const { timezone } = await getSettings(user.id);
  let summary = "";
  let payload: Record<string, unknown> = {};
  let kind: ProposalKind = a.kind;

  if (a.kind === "create_task" || a.kind === "schedule_task") {
    const q = parseQuickAdd(`${a.title ?? ""} ${a.when ?? ""}`.trim() || "New task", timezone);
    kind = q.scheduledAt || q.recurrence ? "schedule_task" : "create_task";
    payload = { title: q.title, dueDate: q.dueDate, scheduledAt: q.scheduledAt?.toISOString() ?? null, recurrence: q.recurrence, details: a.details ?? "" };
    summary = q.title;
  } else if (a.kind === "create_draft") {
    const hint = (a.email_hint ?? "").slice(0, 100);
    const pattern = `%${hint.replace(/[%_\\]/g, "")}%`;
    const [email] = await db()
      .select()
      .from(schema.emails)
      .where(and(eq(schema.emails.userId, user.id), hint ? or(ilike(schema.emails.fromName, pattern), ilike(schema.emails.fromEmail, pattern), ilike(schema.emails.subject, pattern)) : undefined))
      .orderBy(desc(schema.emails.receivedAt))
      .limit(1);
    if (!email) return null;
    payload = { emailId: email.id, instructions: a.details ?? "" };
    summary = `Reply to ${email.fromName ?? email.fromEmail}: “${email.subject}”`;
  } else if (a.kind === "run_automation") {
    const name = (a.automation_name ?? "").slice(0, 100);
    const [auto] = await db()
      .select()
      .from(schema.automations)
      .where(and(eq(schema.automations.userId, user.id), ilike(schema.automations.name, `%${name.replace(/[%_\\]/g, "")}%`)))
      .limit(1);
    if (!auto) return null;
    payload = { automationId: auto.id };
    summary = auto.name;
  } else if (a.kind === "create_linkedin_draft") {
    payload = { topic: a.title ?? "Post", details: a.details ?? "" };
    summary = a.title ?? "LinkedIn post";
  } else if (a.kind === "add_note") {
    payload = { title: a.title ?? "Note", content: a.details ?? a.title ?? "" };
    summary = a.title ?? "Note";
  }

  const [row] = await db()
    .insert(schema.proposals)
    .values({ userId: user.id, source: origin.source, kind, summary: summary.slice(0, 300), payload, conversationId: origin.conversationId ?? null, automationRunId: origin.automationRunId ?? null })
    .returning();
  return row ?? null;
}

export async function executeProposal(user: User, id: string, edits?: { title?: string; when?: string }): Promise<{ ok: true; message: string; href?: string } | { ok: false; message: string }> {
  const [p] = await db()
    .update(schema.proposals)
    .set({ status: "approved", decidedAt: new Date() })
    .where(and(eq(schema.proposals.id, id), eq(schema.proposals.userId, user.id), eq(schema.proposals.status, "pending")))
    .returning();
  if (!p) return { ok: false, message: "This request was already handled." };
  const payload = { ...p.payload };
  try {
    let result: { message: string; href?: string };
    switch (p.kind) {
      case "create_task":
      case "schedule_task": {
        const { timezone } = await getSettings(user.id);
        const q = edits?.title || edits?.when ? parseQuickAdd(`${edits.title ?? payload.title} ${edits.when ?? ""}`, timezone) : null;
        const task = await createTask(user.id, {
          title: String(q?.title ?? payload.title ?? "Task"),
          description: String(payload.details ?? ""),
          dueDate: (q?.dueDate ?? payload.dueDate ?? null) as string | null,
          scheduledAt: q?.scheduledAt ?? (payload.scheduledAt ? new Date(String(payload.scheduledAt)) : null),
          recurrence: (q?.recurrence ?? payload.recurrence ?? null) as never,
          createdBy: "agent",
          assignee: "me",
        });
        result = { message: "Task created", href: `/tasks?task=${task.id}` };
        break;
      }
      case "create_draft": {
        const email = await db().query.emails.findFirst({ where: and(eq(schema.emails.id, String(payload.emailId)), eq(schema.emails.userId, user.id)) });
        if (!email) throw new Error("Email not found");
        await draftReply(user, email, String(payload.instructions ?? "") || undefined);
        result = { message: "Draft saved in Gmail. Review and send it from Gmail." };
        break;
      }
      case "run_automation": {
        const auto = await db().query.automations.findFirst({ where: and(eq(schema.automations.id, String(payload.automationId)), eq(schema.automations.userId, user.id)) });
        if (!auto) throw new Error("Automation not found");
        await queueRun(auto, `manual:${p.id}`, { type: "manual", source: "approval" }, false);
        result = { message: "Automation started", href: `/automations/${auto.id}` };
        break;
      }
      case "create_linkedin_draft": {
        const draft = await draftPostFromIdeaText(user, String(edits?.title ?? payload.topic), String(payload.details ?? ""));
        result = { message: "LinkedIn draft created", href: `/content/${draft.id}` };
        break;
      }
      case "add_note": {
        await addTextToKnowledge(user.id, { title: String(edits?.title ?? payload.title), content: String(payload.content ?? payload.title), via: "agent" });
        result = { message: "Saved to your knowledge base" };
        break;
      }
      default:
        throw new Error("Unsupported request");
    }
    await db().update(schema.proposals).set({ status: "executed", result }).where(eq(schema.proposals.id, p.id));
    await logActivity({ userId: user.id, actor: "me", tool: "approval.executed", inputSummary: p.kind, outcome: "success" });
    return { ok: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    await db().update(schema.proposals).set({ status: "failed", result: { message } }).where(eq(schema.proposals.id, p.id));
    await logActivity({ userId: user.id, actor: "me", tool: "approval.failed", inputSummary: p.kind, outcome: "error", detail: message });
    return { ok: false, message: message.includes("Google") || message.includes("provider") ? message : "That didn't work. Please try again." };
  }
}

export async function dismissProposal(userId: string, id: string) {
  await db()
    .update(schema.proposals)
    .set({ status: "dismissed", decidedAt: new Date() })
    .where(and(eq(schema.proposals.id, id), eq(schema.proposals.userId, userId), eq(schema.proposals.status, "pending")));
}

export async function pendingProposals(userId: string, limit = 20) {
  return db().select().from(schema.proposals).where(and(eq(schema.proposals.userId, userId), eq(schema.proposals.status, "pending"))).orderBy(desc(schema.proposals.createdAt)).limit(limit);
}
