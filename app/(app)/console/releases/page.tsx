import { Kpi, Table } from "@/components/admin/parts";
import { NewRelease, PolicyForm, ReleaseStatus } from "@/components/admin/releases-panel";
import { requireAdmin } from "@/lib/admin/guard";
import { liveStoreBuilds, listReleases, minimumBlockedReason, versionAdoption } from "@/lib/admin/ops/releases";
import { can } from "@/lib/admin/permissions";
import { DEFAULT_UPDATE_POLICY, effectiveMinBuild, updatePolicySchema } from "@/lib/config/registry";
import { listConfigRows } from "@/lib/config/store";
import { timeAgo } from "@/lib/utils";

const UNAVAILABLE = "Unavailable";

export default async function ConsoleReleases() {
  const me = await requireAdmin("releases.read");
  const [rows, releases, adoption, live] = await Promise.all([
    listConfigRows().catch(() => null),
    listReleases().catch(() => null),
    versionAdoption().catch(() => null),
    liveStoreBuilds().catch(() => null),
  ]);
  const stored = rows?.find((r) => r.key === "updates.android");
  const parsed = updatePolicySchema.safeParse(stored?.value);
  const policy = parsed.success ? parsed.data : DEFAULT_UPDATE_POLICY;
  const min = effectiveMinBuild(policy);
  const reporting = adoption ? adoption.filter((a) => a.appBuild !== null).reduce((n, a) => n + a.people, 0) : null;
  const silent = adoption ? adoption.filter((a) => a.appBuild === null).reduce((n, a) => n + a.people, 0) : null;
  const blocked = live ? minimumBlockedReason(1, live) : "Live builds couldn't be read.";
  const canWrite = can(me.adminRole, "releases.write");

  const seenFor = (r: { kind: "store" | "ota"; buildNumber: number | null; runtimeVersion: string | null; version: string }) => {
    if (!adoption) return UNAVAILABLE;
    const match = r.kind === "store" ? adoption.filter((a) => a.appBuild !== null && a.appBuild === r.buildNumber) : adoption.filter((a) => a.runtimeVersion === r.runtimeVersion && a.appVersion === r.version);
    return `${match.reduce((n, a) => n + a.people, 0)} people`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Required build" value={rows ? (min > 0 ? String(min) : "None") : UNAVAILABLE} sub={policy.mode === "required" ? "Latest update is required" : undefined} />
        <Kpi label="Latest version" value={rows ? (policy.latestVersion ?? "Not set") : UNAVAILABLE} sub={policy.latestBuild ? `Build ${policy.latestBuild}` : undefined} />
        <Kpi label="People on a reporting build" value={reporting ?? UNAVAILABLE} sub="Android, last 30 days" />
        <Kpi label="People on builds without a version" value={silent ?? UNAVAILABLE} sub="1.0.0 and other builds before the headers" />
      </div>

      <section className="card rounded-[14px] border border-border bg-background p-3.5">
        <h2 className="mb-1 text-[15px] font-medium">Android update policy</h2>
        <p className="mb-3 text-[12.5px] text-muted">
          Builds below the required build can only update, sign out, export their data or delete their account. The website is never affected.
          {stored ? ` Version ${stored.version}, changed ${timeAgo(stored.updatedAt)}.` : " Not changed yet."}
        </p>
        {rows ? (
          canWrite ? (
            <PolicyForm policy={policy} canEdit={canWrite} canMandate={can(me.adminRole, "releases.mandatory")} blockedReason={blocked} />
          ) : (
            <p className="text-[13px] text-muted">Your role can view the policy but not change it.</p>
          )
        ) : (
          <p className="text-[13px] text-muted">{UNAVAILABLE}: the policy couldn&apos;t be read.</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium">Releases</h2>
          {canWrite ? <NewRelease /> : null}
        </div>
        {releases ? (
          <Table
            empty="No releases recorded yet."
            head={["Release", "Type", "Build or update", "Runtime", "Channel", "Seen in use", "Status"]}
            rows={releases.map((r) => [
              <span key="v" className="tabular font-medium">
                {r.version}
              </span>,
              <span key="k">{r.kind === "store" ? "Store build" : "OTA"}</span>,
              <code key="b" className="text-[12px]">
                {r.kind === "store" ? (r.buildNumber ?? "") : (r.updateGroupId ?? "")}
              </code>,
              <code key="rt" className="text-[12px]">
                {r.runtimeVersion ?? ""}
              </code>,
              <span key="c" className="capitalize text-muted">
                {r.channel}
              </span>,
              <span key="s" className="tabular">
                {seenFor(r)}
              </span>,
              <ReleaseStatus key="st" id={r.id} status={r.status} canEdit={canWrite} />,
            ])}
          />
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">{UNAVAILABLE}: releases couldn&apos;t be read.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Versions in use (Android, last 30 days)</h2>
        {adoption ? (
          <Table
            empty="No Android sessions in the last 30 days."
            head={["Version", "Build", "Runtime", "People", "Sessions"]}
            rows={adoption.map((a, i) => [
              <span key={`v${i}`} className="tabular">
                {a.appVersion ?? "Not reported"}
              </span>,
              <span key={`b${i}`} className="tabular">
                {a.appBuild ?? "Not reported"}
              </span>,
              <code key={`r${i}`} className="text-[12px]">
                {a.runtimeVersion ?? ""}
              </code>,
              <span key={`p${i}`} className="tabular">
                {a.people}
              </span>,
              <span key={`s${i}`} className="tabular text-muted">
                {a.sessions}
              </span>,
            ])}
          />
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">{UNAVAILABLE}: sessions couldn&apos;t be read.</p>
        )}
      </section>

      <section className="text-[12.5px] text-muted">
        <h2 className="mb-1 text-[13px] font-medium text-foreground">What the console can&apos;t do</h2>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Change native code, permissions, the icon or the package id. Those need a new store build.</li>
          <li>Install an update on a phone. It can only block old builds from the API and send people to the store.</li>
          <li>Publish an OTA update. Publish it with the EAS CLI, then record it here.</li>
          <li>Reach a phone that is offline. Changes apply at its next refresh.</li>
          <li>Remove an APK someone already installed.</li>
        </ul>
      </section>
    </div>
  );
}
