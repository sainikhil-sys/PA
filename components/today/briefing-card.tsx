import { ArrowRight, CalendarBlank, Flag, Newspaper, Tray } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { User } from "@/lib/db/schema";
import { latestBriefing } from "@/lib/db/queries/briefings";
import { getSettings } from "@/lib/db/queries/settings";
import { errMessage, log } from "@/lib/log";
import { formatTime, localDayBounds } from "@/lib/time";
import { GenerateBriefingButton } from "./briefing-button";

/** Today's briefing (built each morning at your briefing time), with a button to build it now. */
export async function BriefingCard({ user }: { user: User }) {
  let data: { b: Awaited<ReturnType<typeof latestBriefing>>; tz: string; today: string };
  try {
    const s = await getSettings(user.id);
    data = { b: await latestBriefing(user.id), tz: s.timezone, today: localDayBounds(s.timezone, 0).date };
  } catch (err) {
    log.error("today.card_failed", { card: "briefing", error: errMessage(err) });
    return (
      <Card className="h-full">
        <CardHeader title="Briefing" icon={<Newspaper size={20} />} />
        <ErrorState compact />
      </Card>
    );
  }
  const { b, tz, today } = data;
  const isToday = b?.date === today;
  const c = b?.content;

  return (
    <Card className="h-full">
      <CardHeader
        title="Briefing"
        icon={<Newspaper size={20} />}
        action={b ? <GenerateBriefingButton label={isToday ? "Refresh" : "Build today's"} quiet={isToday} /> : null}
      />
      <CardBody>
        {!b || !c ? (
          <EmptyState
            compact
            icon={Newspaper}
            title="No briefing yet"
            description="Every morning the agent sums up your meetings, mail that needs you and upcoming deadlines. Build one now to see it."
            action={<GenerateBriefingButton label="Build briefing" />}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              {!isToday ? <p className="mb-1 text-[11px] uppercase tracking-wide text-subtle">From {b.date}</p> : null}
              {c.headline ? <p className="text-[15px] font-medium leading-snug">{c.headline}</p> : null}
              {c.summary ? <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{c.summary}</p> : null}
            </div>

            {c.priorities.length ? (
              <ol className="flex flex-col gap-1.5">
                {c.priorities.slice(0, 4).map((p, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] leading-snug">
                    <span className="tabular mt-px grid size-5 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted">{i + 1}</span>
                    <span className="min-w-0">{p}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-3">
              <Stat
                icon={<CalendarBlank size={16} />}
                label={c.meetings.length === 1 ? "meeting" : "meetings"}
                value={c.meetings.length}
                detail={c.meetings[0] ? `${c.meetings[0].start.length > 10 ? formatTime(c.meetings[0].start, tz) : "All day"} · ${c.meetings[0].title}` : "Nothing booked"}
                href="/tasks"
              />
              <Stat
                icon={<Tray size={16} />}
                label={c.emails.length === 1 ? "email needs you" : "emails need you"}
                value={c.emails.length}
                detail={c.emails[0] ? c.emails[0].subject : "Inbox is calm"}
                href="/inbox"
              />
              <Stat
                icon={<Flag size={16} />}
                label={c.deadlines.length === 1 ? "deadline this week" : "deadlines this week"}
                value={c.deadlines.length}
                detail={c.deadlines[0] ? `${c.deadlines[0].due} · ${c.deadlines[0].title}` : "None due"}
                href="/tasks"
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ icon, label, value, detail, href }: { icon: React.ReactNode; label: string; value: number; detail: string; href: string }) {
  return (
    <Link href={href} className="group flex min-w-0 flex-col gap-1 rounded-[12px] border border-border p-3 transition-colors hover:border-border-strong">
      <span className="flex items-center gap-1.5 text-[12px] text-muted">
        {icon}
        <span className="tabular font-medium text-foreground">{value}</span> {label}
        <ArrowRight size={12} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="truncate text-[12px] text-subtle">{detail}</span>
    </Link>
  );
}
