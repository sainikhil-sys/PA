import { ArrowRight, CalendarBlank, Lightbulb, Plugs, Tray } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { CategoryBadge } from "@/components/email/category-badge";
import { EmailActions } from "@/components/email/email-actions";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { User } from "@/lib/db/schema";
import { listImportantEmails } from "@/lib/db/queries/emails";
import { getSettings, listIntegrations } from "@/lib/db/queries/settings";
import { listScheduled, needsReview, topPriorities } from "@/lib/db/queries/tasks";
import { listEvents, type CalendarEvent } from "@/lib/integrations/calendar";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { CATALOG } from "@/lib/integrations/catalog";
import { db, schema } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { errMessage, log } from "@/lib/log";
import { formatTime, localDate, localDayBounds } from "@/lib/time";
import { timeAgo } from "@/lib/utils";
import { AgentCardClient, IdeaActions, PrepButton, RefreshIdeasButton } from "./cards-client";
import { TasksCardClient } from "./tasks-card";

function fail(where: string, err: unknown) {
  log.error("today.card_failed", { card: where, error: errMessage(err) });
}

// ---------- Mail ----------
export async function MailCard({ user }: { user: User }) {
  let emails: Awaited<ReturnType<typeof listImportantEmails>>;
  try {
    emails = await listImportantEmails(user.id, 4);
  } catch (err) {
    fail("mail", err);
    return (
      <Card>
        <CardHeader title="Mail" icon={<Tray size={20} />} />
        <ErrorState compact />
      </Card>
    );
  }
  return (
    <Card className="h-full">
      <CardHeader
        title="Mail that needs you"
        icon={<Tray size={20} />}
        action={
          <Button asChild size="sm" variant="quiet">
            <Link href="/inbox">
              Inbox <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardBody>
        {emails.length === 0 ? (
          <EmptyState compact icon={Tray} title="Nothing urgent" description="No emails need a reply right now." action={<Button asChild size="sm"><Link href="/inbox">Open inbox</Link></Button>} />
        ) : (
          <ul className="flex flex-col gap-2">
            {emails.map((e, i) => (
              <li key={e.id} className="rounded-[14px] border border-border p-4 transition-colors hover:border-border-strong" style={{ marginTop: i === 0 ? 0 : undefined }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.fromName ?? e.fromEmail}</p>
                    <p className="truncate text-[13px] text-muted">{e.subject}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <CategoryBadge category={e.category} />
                    <span className="tabular text-[11px] text-subtle">{timeAgo(e.receivedAt)}</span>
                  </div>
                </div>
                {e.summary ? <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed">{e.summary}</p> : null}
                <div className="mt-3">
                  <EmailActions id={e.id} hasDraft={Boolean(e.draftId)} compact />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Schedule ----------
export async function ScheduleCard({ user }: { user: User }) {
  const s = await getSettings(user.id);
  const { start, end } = localDayBounds(s.timezone, 0);
  let events: CalendarEvent[] = [];
  let calendarIssue: string | null = null;
  try {
    events = await listEvents(user.id, start, end);
  } catch (err) {
    calendarIssue = err instanceof GoogleNotConnectedError ? "not_connected" : "error";
    if (calendarIssue === "error") fail("schedule", err);
  }
  const tasks = await listScheduled(user.id, start, end).catch(() => []);
  const items = [
    ...events.map((e) => ({ id: `e-${e.id}`, kind: "event" as const, title: e.title, start: e.start, allDay: e.allDay, meta: e.attendees.filter((a) => !a.self).length ? `${e.attendees.filter((a) => !a.self).length} people` : e.location })),
    ...tasks.map((t) => ({ id: `t-${t.id}`, kind: "task" as const, title: t.title, start: t.scheduledAt!.toISOString(), allDay: false, meta: "Task" })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const now = new Date().toISOString();

  return (
    <Card className="h-full">
      <CardHeader
        title="Today's schedule"
        icon={<CalendarBlank size={20} />}
        action={
          <Button asChild size="sm" variant="quiet">
            <Link href="/tasks?view=schedule">
              Week <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardBody>
        {calendarIssue === "not_connected" && !items.length ? (
          <EmptyState compact icon={CalendarBlank} title="Connect your calendar" description="See meetings and prep notes here." action={<Button asChild size="sm"><a href="/api/integrations/google/start?returnTo=/">Connect Google</a></Button>} />
        ) : calendarIssue === "error" && !items.length ? (
          <ErrorState compact message="Your calendar didn't load. It will retry shortly." />
        ) : !items.length ? (
          <EmptyState compact icon={CalendarBlank} title="A clear day" description="No meetings or scheduled tasks today." />
        ) : (
          <ol className="relative flex flex-col">
            {items.slice(0, 7).map((it) => {
              const past = it.start < now && !it.allDay;
              return (
                <li key={it.id} className="group relative flex gap-4 py-2.5 pl-1">
                  <span className="tabular w-12 shrink-0 pt-0.5 text-[13px] text-muted">{it.allDay ? "All day" : formatTime(it.start, s.timezone)}</span>
                  <span className="relative mt-2 flex w-2 shrink-0 justify-center" aria-hidden>
                    <span className={`size-2 rounded-full ${it.kind === "event" ? (past ? "bg-border-strong" : "bg-foreground") : "border border-foreground bg-background"}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${past ? "text-muted" : ""}`}>{it.title}</span>
                    {it.meta ? <span className="block truncate text-[12px] text-subtle">{it.meta}</span> : null}
                  </span>
                  {it.kind === "event" && !past ? <PrepButton title={it.title} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Tasks ----------
export async function TasksCard({ user }: { user: User }) {
  try {
    const [priorities, review] = await Promise.all([topPriorities(user.id, 5), needsReview(user.id, 3)]);
    const ser = (t: (typeof priorities)[number]) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, assignee: t.assignee, status: t.status });
    return <TasksCardClient initial={{ priorities: priorities.map(ser), review: review.map(ser) }} />;
  } catch (err) {
    fail("tasks", err);
    return (
      <Card>
        <CardHeader title="Tasks" />
        <ErrorState compact />
      </Card>
    );
  }
}

// ---------- Agent ----------
export async function AgentCard({ user }: { user: User }) {
  const s = await getSettings(user.id);
  const [emails, review, priorities] = await Promise.all([
    listImportantEmails(user.id, 20).catch(() => []),
    needsReview(user.id, 10).catch(() => []),
    topPriorities(user.id, 20).catch(() => []),
  ]);
  const repliesDue = emails.filter((e) => !e.draftId).length;
  const today = localDate(s.timezone);
  const overdue = priorities.filter((t) => t.dueDate && t.dueDate < today).length;

  // One proactive suggestion, strictly from real data. Proactivity "ask" shows none.
  let suggestion: { text: string; prompt: string } | null = null;
  if (s.agent.proactivity !== "ask") {
    if (repliesDue > 0) suggestion = { text: `You have ${repliesDue} ${repliesDue === 1 ? "reply" : "replies"} due. Want me to draft ${repliesDue === 1 ? "it" : "them"}?`, prompt: "Draft replies to my emails that need a reply." };
    else if (review.length > 0) suggestion = { text: `${review.length} ${review.length === 1 ? "result is" : "results are"} waiting for your review.`, prompt: "Summarize the task results waiting for my review." };
    else if (overdue > 0) suggestion = { text: `${overdue} ${overdue === 1 ? "task is" : "tasks are"} overdue. Want help re-planning?`, prompt: "Help me re-plan my overdue tasks." };
    else suggestion = { text: "Your inbox is calm. A good moment for focused work.", prompt: "What should I focus on today?" };
  }
  return <AgentCardClient agentName={s.agent.name} stats={{ repliesDue, review: review.length, overdue }} suggestion={suggestion} />;
}

// ---------- LinkedIn ideas ----------
export async function IdeasCard({ user }: { user: User }) {
  const s = await getSettings(user.id);
  const today = localDate(s.timezone);
  let ideas: (typeof schema.ideas.$inferSelect)[] = [];
  try {
    ideas = await db()
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.userId, user.id), eq(schema.ideas.suggestedFor, today)))
      .orderBy(desc(schema.ideas.createdAt))
      .limit(3);
  } catch (err) {
    fail("ideas", err);
  }
  const visible = ideas.filter((i) => i.status !== "dismissed");
  return (
    <Card className="h-full">
      <CardHeader
        title="LinkedIn ideas for today"
        icon={<Lightbulb size={20} />}
        action={<RefreshIdeasButton />}
      />
      <CardBody>
        {visible.length === 0 ? (
          <EmptyState compact icon={Lightbulb} title="No ideas yet today" description="I'll suggest three from your news, notes and idea bank." action={<RefreshIdeasButton primary />} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visible.map((idea) => (
              <li key={idea.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">{idea.title}</p>
                {idea.hook ? <p className="line-clamp-2 border-l-2 border-border-strong pl-3 font-serif text-[15px] italic leading-snug text-muted">“{idea.hook}”</p> : null}
                <IdeaActions id={idea.id} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[12px] text-subtle">Nothing is posted automatically.</p>
      </CardBody>
    </Card>
  );
}

// ---------- Integrations strip ----------
export async function IntegrationsStrip({ user }: { user: User }) {
  const rows = await listIntegrations(user.id).catch(() => []);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const shown = CATALOG.slice(0, 7);
  return (
    <Card>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <Plugs size={20} className="text-muted" />
          <h2 className="text-[15px] font-medium">Integrations</h2>
        </div>
        <ul className="no-scrollbar flex flex-1 items-center gap-2 overflow-x-auto">
          {shown.map((c) => {
            const row = c.provider ? byProvider.get(c.provider) : undefined;
            const state = c.provider === "telegram" ? (process.env.TELEGRAM_BOT_TOKEN ? "ok" : "idle") : row?.status === "connected" ? "ok" : row?.status === "error" ? "error" : "idle";
            const label = state === "ok" ? "connected" : state === "error" ? "needs attention" : "not connected";
            return (
              <li key={c.id}>
                <Link href="/integrations" className="flex h-11 items-center gap-2 rounded-[12px] border border-border px-3 text-[13px] hover:border-border-strong" aria-label={`${c.name}, ${label}`}>
                  <BrandLogo id={c.logo} size={18} />
                  <span className="hidden sm:inline">{c.name}</span>
                  <StatusDot state={state as "ok" | "error" | "idle"} pulse={state === "ok"} />
                </Link>
              </li>
            );
          })}
        </ul>
        <Button asChild size="sm" variant="secondary">
          <Link href="/integrations">Add more</Link>
        </Button>
      </div>
    </Card>
  );
}
