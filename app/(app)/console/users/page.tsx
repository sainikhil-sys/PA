import { Table } from "@/components/admin/parts";
import { DisableToggle } from "@/components/admin/console-client";
import { fmt } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { listUsersAdmin } from "@/lib/admin/stats";
import { timeAgo } from "@/lib/utils";

export default async function ConsoleUsers() {
  const me = await requireAdmin("users.read");
  const canSuspend = can(me.adminRole, "users.suspend");
  const users = await listUsersAdmin();
  return (
    <Table
      head={["Account", "Joined", "Last seen", "Integrations", "Devices", "Tokens (30d)", ""]}
      rows={users.map((u) => [
        <div key="a" className="min-w-0">
          <p className="truncate font-medium">{u.name ?? u.email.split("@")[0]}</p>
          <p className="truncate text-[12px] text-muted">
            {u.email}
            {u.disabledAt ? " · disabled" : !u.onboardedAt ? " · not onboarded" : ""}
          </p>
        </div>,
        <span key="j" className="text-muted">{timeAgo(u.createdAt)}</span>,
        <span key="l" className="text-muted">{u.lastSeen ? timeAgo(u.lastSeen) : "never"}</span>,
        <span key="i" className="tabular">{u.integrations}</span>,
        <span key="d" className="tabular">{u.devices}</span>,
        <span key="t" className="tabular">{fmt(u.tokens30)}</span>,
        canSuspend ? <DisableToggle key="x" userId={u.id} disabled={Boolean(u.disabledAt)} self={u.id === me.id} /> : <span key="x" />,
      ])}
    />
  );
}
