import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ToggleRightIcon } from "phosphor-react-native";
import * as React from "react";
import { Switch, View } from "react-native";
import { EmptyState, ErrorState, Skeleton, Txt } from "@/components/ui";
import { adminKeys, adminOp, useFlags } from "@/features/admin/api";
import { can, flagIsOn, killSwitchState, type FlagItem } from "@/features/admin/permissions";
import { AdminScreen, ReasonSheet, RequirePermission, usePermissions } from "@/features/admin/ui";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

export default function AdminFlags() {
  return (
    <RequirePermission permission="flags.read" title="Feature flags">
      <Flags />
    </RequirePermission>
  );
}

/** Kill switches only: on or off. Rollout, targeting and schedules are edited on the website console. */
function Flags() {
  const qc = useQueryClient();
  const flags = useFlags();
  const writable = can(usePermissions(), "flags.write");
  const [pending, setPending] = React.useState<{ flag: FlagItem; enabled: boolean } | null>(null);
  const save = useMutation({
    mutationFn: (v: { flag: FlagItem; enabled: boolean; reason: string }) => adminOp("/api/admin/flags", { method: "POST", body: { key: v.flag.key, state: killSwitchState(v.flag, v.enabled), reason: v.reason } }),
    onSuccess: () => {
      setPending(null);
      void qc.invalidateQueries({ queryKey: adminKeys.flags });
    },
  });

  return (
    <AdminScreen title="Feature flags" onRefresh={() => void flags.refetch()} refreshing={flags.isRefetching}>
      <Txt variant="bodyMuted">Turn a feature on or off for everyone it targets. Rollout, targeting and schedules are set on the website console.</Txt>
      {flags.isPending ? (
        <Skeleton rows={3} height={72} />
      ) : flags.isError ? (
        <ErrorState message={errorText(flags.error)} onRetry={() => void flags.refetch()} />
      ) : !flags.data.length ? (
        <EmptyState icon={ToggleRightIcon} title="No feature flags" body="Flags appear here once they are added to Cowork." />
      ) : (
        <Group>
          {flags.data.map((f) => {
            const on = flagIsOn(f);
            const partial = on && f.state && f.state.rolloutPercent < 100;
            return (
              <View key={f.key} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, minHeight: 72 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="label">{f.label}</Txt>
                  <Txt variant="small">{f.description}</Txt>
                  <Txt variant="small">{`${on ? "On" : "Off"}${partial ? `, for ${f.state!.rolloutPercent}% of people` : ""}${f.state ? "" : " (default)"}`}</Txt>
                </View>
                <Switch
                  value={on}
                  disabled={!writable || save.isPending}
                  onValueChange={(enabled) => {
                    save.reset();
                    setPending({ flag: f, enabled });
                  }}
                  accessibilityLabel={`${f.label}, ${on ? "on" : "off"}`}
                  trackColor={{ true: color.accent, false: color.surface3 }}
                  thumbColor={color.bg}
                />
              </View>
            );
          })}
        </Group>
      )}
      {!writable ? <Txt variant="small">Your role can see flags but not change them.</Txt> : null}

      <ReasonSheet
        open={Boolean(pending)}
        title={pending ? `Turn ${pending.flag.label.toLowerCase()} ${pending.enabled ? "on" : "off"}?` : ""}
        body={pending?.enabled ? "The feature comes back for the people it targets within about a minute." : "The feature turns off for everyone within about a minute."}
        confirmLabel={pending?.enabled ? "Turn on" : "Turn off"}
        destructive={pending ? !pending.enabled : false}
        busy={save.isPending}
        error={save.error ? errorText(save.error) : null}
        onConfirm={(reason) => pending && save.mutate({ ...pending, reason })}
        onClose={() => setPending(null)}
      />
    </AdminScreen>
  );
}
