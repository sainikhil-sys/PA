import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Table } from "@/components/admin/parts";
import { LiftRestrictionButton, RestrictionForm, RevokeSessionsButton, SuspendButton } from "@/components/admin/users-detail";
import { fmt } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { FEATURE_LABEL } from "@/lib/admin/restrictions";
import { userDetail } from "@/lib/admin/users-query";
import { cn, timeAgo } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", moderator: "Moderator", support: "Support", analyst: "Analyst" };
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cn("tabular mt-0.5 truncate text-[14px]", bad && "text-danger")}>{value}</dd>
    </div>
  );
}

export default async function ConsoleUser({ params }: { params: Promise<{ userId: string }> }) {
  const me = await requireAdmin("users.read");
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) notFound();
  const d = await userDetail(userId).catch(() => undefined);
  if (d === null) notFound();
  if (!d) return <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Try again in a minute.</p>;

  const canSuspend = can(me.adminRole, "users.suspend");
  const canRevoke = can(me.adminRole, "users.sessions.revoke");
  const self = d.user.id === me.id;
  const u = d.usage;
  const activeRestrictions = d.restrictions.filter((r) => r.active);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/console/users" className="text-[13px] text-muted hover:text-foreground">
          Back to users
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-[22px] leading-tight">{d.user.name ?? d.user.email.split("@")[0]}</h2>
            <p className="truncate text-[13px] text-muted">{d.user.email}</p>
          </div>
          {!self ? (
            <div className="flex flex-wrap gap-2">
              {canRevoke ? <RevokeSessionsButton userId={d.user.id} sessions={d.sessions.length} /> : null}
              {canSuspend ? <SuspendButton userId={d.user.id} suspended={Boolean(d.user.disabledAt)} /> : null}
            </div>
          ) : (
            <p className="text-[12px] text-subtle">This is your account.</p>
          )}
        </div>
        <dl className="card grid grid-cols-2 gap-3 rounded-[14px] border border-border bg-background p-3.5 sm:grid-cols-4">
          <Fact label="Status" value={d.user.disabledAt ? `Suspended ${timeAgo(d.user.disabledAt)}` : activeRestrictions.length ? "Active, restricted" : "Active"} bad={Boolean(d.user.disabledAt)} />
          <Fact label="Joined" value={day(d.user.createdAt)} />
          <Fact label="Onboarded" value={d.user.onboardedAt ? day(d.user.onboardedAt) : "Not yet"} />
          <Fact label="Admin role" value={d.user.adminRole ? ROLE_LABEL[d.user.adminRole] : "None"} />
        </dl>
      </div>

      <Section title="Usage">
        <p className="text-[12px] text-muted">Counts only. Content is never shown here.</p>
        <dl className="card grid grid-cols-2 gap-3 rounded-[14px] border border-border bg-background p-3.5 sm:grid-cols-4">
          <Fact label="Paired phones" value={fmt(u.pairedPhones)} />
          <Fact label="Push devices" value={fmt(u.pushDevices)} />
          <Fact label="Connected services" value={fmt(u.integrations)} />
          <Fact label="Chats" value={fmt(u.conversations)} />
          <Fact label="Messages" value={fmt(u.messages)} />
          <Fact label="Tasks" value={fmt(u.tasks)} />
          <Fact label="Notes" value={fmt(u.notes)} />
          <Fact label="Memories" value={fmt(u.memories)} />
          <Fact label="Documents" value={fmt(u.documents)} />
          <Fact label="Automations" value={fmt(u.automations)} />
          <Fact label="Automation runs (30d)" value={fmt(u.automationRuns30)} />
          <Fact label="AI runs (30d)" value={`${fmt(u.aiRuns30)}, ${fmt(u.tokens30)} tokens`} />
        </dl>
      </Section>

      <Section title={`Live sessions (${d.sessions.length})`}>
        <Table
          empty="No live sessions. They're signed out everywhere."
          head={["Device", "App version", "Network", "Last seen", "Signed in"]}
          rows={d.sessions.map((s) => [
            <span key="d">{s.device}</span>,
            <span key="v" className="tabular text-muted">
              {s.appVersion ?? "Not reported"}
            </span>,
            <span key="n" className="tabular text-muted">
              {s.network ?? "Unknown"}
            </span>,
            <span key="l" className="text-muted">
              {timeAgo(s.lastSeenAt)}
            </span>,
            <span key="c" className="text-muted">
              {day(s.createdAt)}
            </span>,
          ])}
        />
      </Section>

      <Section title="Restrictions">
        <p className="text-[12px] text-muted">A restricted feature is refused by the server with a message to contact support.</p>
        <Table
          empty="No restrictions."
          head={["Feature", "Reason", "Until", "Status", ""]}
          rows={d.restrictions.map((r) => [
            <span key="f" className="font-medium">
              {FEATURE_LABEL[r.feature]}
            </span>,
            <span key="r" className="line-clamp-2 max-w-[320px] text-muted">
              {r.reason}
            </span>,
            <span key="u" className="tabular text-muted">
              {r.expiresAt ? utc(r.expiresAt) : "Until lifted"}
            </span>,
            <span key="s" className={r.active ? "text-danger" : "text-muted"}>
              {r.active ? "Active" : r.liftedAt ? `Lifted ${timeAgo(r.liftedAt)}` : "Expired"}
            </span>,
            r.active && canSuspend && !self ? <LiftRestrictionButton key="x" userId={d.user.id} restrictionId={r.id} label={FEATURE_LABEL[r.feature]} /> : <span key="x" />,
          ])}
        />
        {canSuspend && !self ? (
          <div className="card rounded-[14px] border border-border bg-background p-3.5">
            <RestrictionForm userId={d.user.id} />
          </div>
        ) : null}
      </Section>

      {d.deletionRequests.length ? (
        <Section title="Deletion requests">
          <Table
            head={["Status", "Received", "Due"]}
            rows={d.deletionRequests.map((r) => [
              <span key="s" className="capitalize">
                {r.status}
              </span>,
              <span key="c" className="text-muted">
                {day(r.createdAt)}
              </span>,
              <span key="d" className="text-muted">
                {day(r.dueBy)}
              </span>,
            ])}
          />
        </Section>
      ) : null}

      <Section title="Admin activity on this account">
        <Table
          empty="No admin actions on this account yet."
          head={["When", "Action", "By", "Outcome", "Reason"]}
          rows={d.audit.map((a) => [
            <span key="w" className="tabular text-muted">
              {utc(a.createdAt)}
            </span>,
            <span key="a" className="font-mono text-[12px]">
              {a.action}
            </span>,
            <span key="b" className="text-muted">
              {a.actorEmail ?? "Deleted account"}
              {a.actorRole ? `, ${ROLE_LABEL[a.actorRole] ?? a.actorRole}` : ""}
            </span>,
            <span key="o" className={a.outcome === "success" ? "text-muted" : "text-danger"}>
              {a.outcome}
            </span>,
            <span key="r" className="line-clamp-2 max-w-[260px] text-muted">
              {a.reason ?? ""}
            </span>,
          ])}
        />
      </Section>
    </div>
  );
}
