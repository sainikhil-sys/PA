import { FlagRow, type FlagItem } from "@/components/admin/flags-editor";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { FLAG_DEFS } from "@/lib/flags/registry";
import { flagStateOf, listFlagRows } from "@/lib/flags/store";

export default async function ConsoleFlags() {
  const me = await requireAdmin("flags.read");
  const rows = await listFlagRows().catch(() => null);
  if (!rows) {
    return <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Feature flags unavailable: the database couldn&apos;t be read. Try again in a moment.</p>;
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const items: FlagItem[] = FLAG_DEFS.map((f) => {
    const r = byKey.get(f.key);
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      default: f.default,
      enforcedIn: f.enforcedIn,
      state: r && !r.archivedAt ? flagStateOf(r) : null,
      version: r?.version ?? 0,
      updatedAt: r?.updatedAt.toISOString() ?? null,
    };
  });
  const unknown = rows.filter((r) => !FLAG_DEFS.some((f) => f.key === r.key));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">
        Flags are defined in code with a safe default. A change reaches the server within about 30 seconds and each app at its next refresh. Turning a flag off is the fastest way to stop a broken feature.
      </p>
      <ul className="card divide-y divide-border rounded-[14px] border border-border bg-background">
        {items.map((i) => (
          <FlagRow key={i.key} item={i} canEdit={can(me.adminRole, "flags.write")} />
        ))}
      </ul>
      {unknown.length ? (
        <p className="text-[12.5px] text-muted">
          {unknown.length} stored {unknown.length === 1 ? "flag is" : "flags are"} no longer in the code and {unknown.length === 1 ? "does" : "do"} nothing: {unknown.map((r) => r.key).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
