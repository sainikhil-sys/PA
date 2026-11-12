import { CheckCircleIcon, WarningCircleIcon, WarningIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { ErrorState, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useAnalytics, useProbes, type Probe } from "@/features/admin/api";
import { can } from "@/features/admin/permissions";
import { AdminScreen, RequirePermission, usePermissions } from "@/features/admin/ui";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

const STATUS_TEXT = { working: "Working", degraded: "Degraded", unavailable: "Unavailable" } as const;

/** Working is neutral with a check (no green in Cowork); problems use the warning and danger colours. */
function ProbeIcon({ status }: { status: Probe["status"] }) {
  if (status === "working") return <CheckCircleIcon size={20} color={color.text} />;
  if (status === "degraded") return <WarningIcon size={20} color={color.warning} />;
  return <WarningCircleIcon size={20} color={color.danger} />;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 140, padding: space.lg, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Txt variant="title">{value.toLocaleString()}</Txt>
      <Txt variant="small">{label}</Txt>
    </View>
  );
}

export default function AdminOverview() {
  return (
    <RequirePermission permission="overview.read" title="Overview">
      <Overview />
    </RequirePermission>
  );
}

function Overview() {
  const permissions = usePermissions();
  const showHealth = can(permissions, "infra.read");
  const showCounts = can(permissions, "analytics.read");
  const probes = useProbes(showHealth);
  const counts = useAnalytics(showCounts);
  const refreshing = probes.isRefetching || counts.isRefetching;

  return (
    <AdminScreen
      title="Overview"
      refreshing={refreshing}
      onRefresh={() => {
        if (showHealth) void probes.refetch();
        if (showCounts) void counts.refetch();
      }}
    >
      {showHealth ? (
        <View>
          <SectionHeader title="Service health" />
          {probes.isPending ? (
            <Skeleton rows={4} />
          ) : probes.isError ? (
            <ErrorState message={errorText(probes.error)} onRetry={() => void probes.refetch()} />
          ) : (
            <Group>
              {probes.data.map((p) => (
                <View key={p.id} style={{ flexDirection: "row", gap: space.md, padding: space.lg, alignItems: "flex-start" }} accessible accessibilityLabel={`${p.label}: ${STATUS_TEXT[p.status]}, ${p.value}. ${p.detail}`}>
                  <ProbeIcon status={p.status} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                      <Txt variant="label">{p.label}</Txt>
                      <Txt variant="small">{p.value}</Txt>
                    </View>
                    <Txt variant="small">{`${STATUS_TEXT[p.status]}. ${p.detail}`}</Txt>
                  </View>
                </View>
              ))}
            </Group>
          )}
        </View>
      ) : null}

      {showCounts ? (
        <View>
          <SectionHeader title="People" />
          {counts.isPending ? (
            <Skeleton rows={2} height={72} />
          ) : counts.isError ? (
            <ErrorState message={errorText(counts.error)} onRetry={() => void counts.refetch()} />
          ) : (
            <Group>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Stat label="Active today" value={counts.data.active.day} />
                <Stat label="Active this week" value={counts.data.active.week} />
                <Stat label="Active this month" value={counts.data.active.month} />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Stat label="Accounts" value={counts.data.signups.total} />
                <Stat label="New this week" value={counts.data.signups.week} />
                <Stat label="Messages this week" value={counts.data.conversations.messagesWeek} />
              </View>
            </Group>
          )}
        </View>
      ) : null}

      {!showHealth && !showCounts ? <Txt variant="bodyMuted">Your role can open the overview, but health and counts need more access. Users is in the console menu.</Txt> : null}
    </AdminScreen>
  );
}
