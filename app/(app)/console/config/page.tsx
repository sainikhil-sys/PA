import { ConfigRow, MaintenanceCard, type ConfigItem } from "@/components/admin/config-editor";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { CONFIG_ENTRIES, CONFIG_GROUPS, maintenanceFrom, resolveValues } from "@/lib/config/registry";
import { listConfigRows } from "@/lib/config/store";

export default async function ConsoleConfig() {
  const me = await requireAdmin("config.read");
  const rows = await listConfigRows().catch(() => null);
  if (!rows) {
    return <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Configuration unavailable: the database couldn't be read. Try again in a moment.</p>;
  }
  const values = resolveValues(rows);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const items: ConfigItem[] = CONFIG_ENTRIES.filter((e) => !e.dedicated).map((e) => ({
    key: e.key,
    label: e.label,
    description: e.description,
    field: e.field,
    value: e.secret ? "[secret]" : values.get(e.key),
    defaultValue: e.default,
    isDefault: !byKey.has(e.key),
    version: byKey.get(e.key)?.version ?? 0,
    updatedAt: byKey.get(e.key)?.updatedAt.toISOString() ?? null,
    scope: e.scope,
    readBy: e.readBy,
    canEdit: can(me.adminRole, e.permission) && !e.secret,
  }));
  const canRestore = can(me.adminRole, "config.rollback");
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-muted">
        Changes reach the server within about 30 seconds and the app at its next refresh. Every change needs a reason and is kept in the history and the audit log.
        {canRestore ? " You can restore any earlier version." : " Only the owner can restore earlier versions."}
      </p>
      <MaintenanceCard state={maintenanceFrom(values)} canEdit={can(me.adminRole, "maintenance.write")} />
      {CONFIG_GROUPS.filter((g) => items.some((i) => CONFIG_ENTRIES.find((e) => e.key === i.key)?.group === g.id)).map((g) => (
        <section key={g.id}>
          <h2 className="mb-1 text-[15px] font-medium">{g.label}</h2>
          {g.note ? <p className="mb-2 text-[12.5px] text-muted">{g.note}</p> : null}
          <ul className="card divide-y divide-border rounded-[14px] border border-border bg-background">
            {items
              .filter((i) => CONFIG_ENTRIES.find((e) => e.key === i.key)?.group === g.id)
              .map((i) => (
                <ConfigRow key={i.key} item={i} canRestore={canRestore} />
              ))}
          </ul>
        </section>
      ))}
      <p className="text-[12.5px] text-muted">The app&apos;s minimum and latest versions are set on the Releases page.</p>
    </div>
  );
}
