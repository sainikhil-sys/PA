import Link from "next/link";
import { Table } from "@/components/admin/parts";
import { GrantRoleForm, RevokeSessionButton, RoleRowActions } from "@/components/admin/security-actions";
import { verifyAuditChain } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/guard";
import { recoveryCodesLeft } from "@/lib/admin/mfa";
import { listOpenAdminSessions, listRoleHolders, ROLE_LABEL, securityEvents } from "@/lib/admin/ops/security";
import { can } from "@/lib/admin/permissions";
import { cn, timeAgo } from "@/lib/utils";

const utcTime = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)} UTC`;

function Card({ label, children, hint, bad }: { label: string; children: React.ReactNode; hint?: string; bad?: boolean }) {
  return (
    <div className="card rounded-md border border-border bg-background p-3.5">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn("mt-1 text-[15px] font-medium", bad && "text-danger")}>{children}</p>
      {hint ? <p className="mt-1 text-[11.5px] text-subtle">{hint}</p> : null}
    </div>
  );
}

function Unavailable() {
  return <p className="rounded-md border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Try again in a minute.</p>;
}

export default async function ConsoleSecurity() {
  const me = await requireAdmin("audit.read");
  const seeAll = can(me.adminRole, "security.read");
  const isOwner = can(me.adminRole, "roles.manage");
  const endOthers = can(me.adminRole, "security.policy");
  const [chain, codesLeft, admins, sessions, events] = await Promise.all([
    verifyAuditChain().catch(() => null),
    recoveryCodesLeft(me.id).catch(() => null),
    seeAll ? listRoleHolders().catch(() => null) : Promise.resolve(null),
    listOpenAdminSessions(seeAll ? undefined : me.id).catch(() => null),
    seeAll ? securityEvents().catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Audit trail" bad={Boolean(chain && !chain.ok)} hint="Every entry is chained to the one before; an edited entry breaks the chain.">
          {!chain ? "Unavailable" : chain.ok ? `Intact, ${chain.rows.toLocaleString("en-US")} entries` : `Broken at entry ${chain.firstBrokenSeq}`}
        </Card>
        <Card label="Your recovery codes left" bad={codesLeft !== null && codesLeft <= 2}>
          {codesLeft ?? "Unavailable"}
        </Card>
        <Card label="Open admin sessions" hint={seeAll ? "Across everyone with a role." : "Yours only."}>
          {sessions ? sessions.length : "Unavailable"}
        </Card>
        {seeAll ? (
          <Card label="Wrong codes (30 days)" bad={Boolean(events?.lockedNow.length)} hint={events ? `${events.locked30} lockouts, ${events.lockedNow.length} locked now` : undefined}>
            {events ? events.failed30 + events.locked30 : "Unavailable"}
          </Card>
        ) : null}
      </div>

      {seeAll ? (
        <section className="flex flex-col gap-2" aria-label="Admin roles">
          <h2 className="text-[15px] font-medium">People with admin roles</h2>
          {admins ? (
            <Table
              head={["Account", "Role", "Two-step", "Last admin session", "Since", ...(isOwner ? [""] : [])]}
              rows={admins.map((a) => {
                const self = a.userId === me.id;
                return [
                  <span key="e" className={cn(a.disabled && "text-muted line-through")}>
                    {a.email}
                    {self ? <span className="text-muted"> (you)</span> : null}
                  </span>,
                  ROLE_LABEL[a.role],
                  <span key="m" className={cn(!a.mfa && "text-warning", a.lockedUntil && "text-danger")}>
                    {a.lockedUntil ? `Locked until ${utcTime(a.lockedUntil)}` : a.mfa ? "Set up" : "Not set up"}
                  </span>,
                  <span key="l" className="text-muted">
                    {a.lastSessionAt ? timeAgo(a.lastSessionAt) : "Never"}
                  </span>,
                  <span key="s" className="text-muted">
                    {timeAgo(a.since)}
                  </span>,
                  ...(isOwner
                    ? [a.role === "owner" || self ? <span key="x" className="text-[12px] text-subtle">{a.role === "owner" ? "Owner" : ""}</span> : <RoleRowActions key="x" userId={a.userId} role={a.role as "admin" | "support" | "moderator" | "analyst"} hasMfa={a.mfa || Boolean(a.lockedUntil)} />]
                    : []),
                ];
              })}
              empty="No one holds an admin role."
            />
          ) : (
            <Unavailable />
          )}
          {isOwner ? (
            <>
              <GrantRoleForm />
              <p className="text-[12px] text-subtle">
                The owner role can&apos;t be given, changed or removed here. Ownership moves only with <code>scripts/admin-bootstrap.mjs --transfer</code>, run on the server. Changing or removing a role ends that person&apos;s admin sessions.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-label="Admin sessions">
        <h2 className="text-[15px] font-medium">{seeAll ? "Open admin sessions" : "Your open admin sessions"}</h2>
        {sessions ? (
          <Table
            head={[...(seeAll ? ["Person", "Role"] : []), "Started", "Last active", "Method", "Platform", "Network", ""]}
            rows={sessions.map((s) => {
              const own = s.userId === me.id;
              return [
                ...(seeAll
                  ? [
                      <span key="p">
                        {s.email}
                        {own ? <span className="text-muted"> (you)</span> : null}
                      </span>,
                      s.role ? ROLE_LABEL[s.role] : "No role",
                    ]
                  : []),
                timeAgo(s.createdAt),
                timeAgo(s.lastSeenAt),
                s.method === "recovery" ? "Recovery code" : s.method === "passkey" ? "Passkey" : "Authenticator",
                s.platform === "android" ? "Android app" : "Web",
                <span key="n" className="text-muted">
                  {s.ipPrefix ?? "Unknown"}
                  {s.id === me.adminSession.id ? " · this one" : ""}
                </span>,
                own || endOthers ? <RevokeSessionButton key="r" id={s.id} own={own} current={s.id === me.adminSession.id} /> : "",
              ];
            })}
            empty="No open admin sessions."
          />
        ) : (
          <Unavailable />
        )}
      </section>

      {seeAll ? (
        <section className="flex flex-col gap-2" aria-label="Failed step-ups">
          <h2 className="text-[15px] font-medium">Wrong codes and lockouts (30 days)</h2>
          {events ? (
            <Table
              head={["When", "Person", "Role", "What happened", "Network"]}
              rows={events.events.map((e) => [
                <span key="w" className="text-muted">
                  {timeAgo(e.createdAt)}
                </span>,
                e.email ?? <span className="text-muted">Deleted account</span>,
                e.actorRole ? ROLE_LABEL[e.actorRole as keyof typeof ROLE_LABEL] ?? e.actorRole : "",
                <span key="k" className={e.kind === "locked" ? "text-danger" : ""}>
                  {e.kind === "locked" ? "Locked for 15 minutes" : `Wrong code${e.failures ? ` (${e.failures} in a row)` : ""}`}
                </span>,
                <span key="n" className="text-muted">
                  {e.ipPrefix ?? "Unknown"}
                </span>,
              ])}
              empty="No wrong codes in the last 30 days."
            />
          ) : (
            <Unavailable />
          )}
        </section>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3.5">
        <div>
          <p className="text-[14px] font-medium">Audit log</p>
          <p className="text-[12.5px] text-muted">Every admin change and denied attempt, with before and after values. Filter by person, action, resource, outcome and date.</p>
        </div>
        <Link href="/console/security/audit" className="text-[13px] font-medium underline-offset-4 hover:underline">
          Open the audit log
        </Link>
      </section>
    </div>
  );
}
