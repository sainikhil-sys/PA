import Link from "next/link";
import { UsersTable } from "@/components/admin/users-table";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { FEATURE_LABEL, RESTRICTABLE_FEATURES } from "@/lib/admin/restrictions";
import { appVersionsSeen, searchUsers, userSearchSchema, type UserSearch } from "@/lib/admin/users-query";
import { cn } from "@/lib/utils";

const selectClass = cn(inputClass, "h-9 w-auto min-w-0 pr-8 text-[13px]");

function pageHref(f: UserSearch, page: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status !== "all") p.set("status", f.status);
  if (f.restricted) p.set("restricted", f.restricted);
  if (f.platform) p.set("platform", f.platform);
  if (f.appVersion) p.set("appVersion", f.appVersion);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/console/users?${s}` : "/console/users";
}

export default async function ConsoleUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin("users.read");
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = userSearchSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : userSearchSchema.parse({});
  const [result, versions] = await Promise.all([searchUsers(filters).catch(() => null), appVersionsSeen().catch(() => [] as string[])]);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" action="/console/users" className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted">
          Email or name
          <input name="q" defaultValue={filters.q} maxLength={200} placeholder="ana@example.com" className={cn(inputClass, "h-9 text-[13px]")} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Status
          <select name="status" defaultValue={filters.status} className={selectClass}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Restricted
          <select name="restricted" defaultValue={filters.restricted} className={selectClass}>
            <option value="">Any or none</option>
            <option value="any">Any restriction</option>
            {RESTRICTABLE_FEATURES.map((f) => (
              <option key={f} value={f}>
                {FEATURE_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Platform
          <select name="platform" defaultValue={filters.platform} className={selectClass}>
            <option value="">Any</option>
            <option value="web">Web</option>
            <option value="android">Android</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          App version
          <select name="appVersion" defaultValue={filters.appVersion} className={selectClass}>
            <option value="">Any</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="primary">
            Search
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/console/users">Reset</Link>
          </Button>
        </div>
      </form>
      {!parsed.success ? <p className="text-[13px] text-danger">{parsed.error.issues[0]?.message ?? "Those filters aren't valid."} Showing everyone instead.</p> : null}

      {result ? (
        <>
          <p className="text-[12px] text-muted">
            <span className="tabular">{result.total.toLocaleString()}</span> account{result.total === 1 ? "" : "s"}
            {result.total > result.pageSize ? (
              <>
                , page <span className="tabular">{result.page}</span> of <span className="tabular">{result.pages}</span>
              </>
            ) : null}
          </p>
          <UsersTable rows={result.rows} canSuspend={can(me.adminRole, "users.suspend")} meId={me.id} />
          {result.pages > 1 ? (
            <nav aria-label="Pages" className="flex justify-between gap-2">
              {result.page > 1 ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={pageHref(filters, result.page - 1)}>Previous</Link>
                </Button>
              ) : (
                <span />
              )}
              {result.page < result.pages ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={pageHref(filters, result.page + 1)}>Next</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Try again in a minute.</p>
      )}
    </div>
  );
}
