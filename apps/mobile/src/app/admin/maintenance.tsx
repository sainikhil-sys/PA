import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Switch, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, ErrorState, Input, Skeleton, Txt } from "@/components/ui";
import { adminKeys, adminOp, confirmFrom, useAdminConfig, type ConfirmRequest } from "@/features/admin/api";
import { AdminScreen, RequirePermission } from "@/features/admin/ui";
import { useClientConfigStore } from "@/features/config/store";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

export default function AdminMaintenance() {
  return (
    <RequirePermission permission="maintenance.write" title="Maintenance">
      <Maintenance />
    </RequirePermission>
  );
}

type Body = { active: boolean; message: string | null; endsAt: string | null; pauseJobs: boolean; reason: string };

/**
 * Maintenance on or off (owner only). The server answers the first request with a summary and a
 * one-time token (409 confirm_required); the summary is shown here, and confirming sends it back.
 */
function Maintenance() {
  const qc = useQueryClient();
  const config = useAdminConfig(true);
  const values = new Map((config.data ?? []).map((e) => [e.key, e.value]));
  const active = values.get("maintenance.active") === true;
  const pauseJobs = values.get("maintenance.pauseJobs") === true;
  const storedMessage = typeof values.get("maintenance.message") === "string" ? (values.get("maintenance.message") as string) : "";
  const endsAt = typeof values.get("maintenance.endsAt") === "string" ? (values.get("maintenance.endsAt") as string) : null;

  const [message, setMessage] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState<{ body: Body; request: ConfirmRequest } | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const shownMessage = message ?? storedMessage;

  const send = useMutation({
    mutationFn: (v: { body: Body; confirmToken?: string }) => adminOp<{ changed: number }>("/api/admin/config/maintenance", { method: "POST", body: v.body, confirmToken: v.confirmToken }),
    onSuccess: (_r, v) => {
      setConfirm(null);
      setReason("");
      setDone(v.body.active ? "Maintenance is on. People see the maintenance screen; admins can still use Cowork." : "Maintenance is off. Cowork is open again.");
      void qc.invalidateQueries({ queryKey: adminKeys.config });
      void useClientConfigStore.getState().refresh();
    },
    onError: (err, v) => {
      const request = confirmFrom(err);
      if (request) setConfirm({ body: v.body, request });
      else setConfirm(null);
    },
  });

  const start = (nextActive: boolean) => {
    setDone(null);
    send.reset();
    send.mutate({ body: { active: nextActive, message: shownMessage.trim() || null, endsAt: nextActive ? endsAt : null, pauseJobs, reason: reason.trim() } });
  };
  const reasonOk = reason.trim().length >= 3;
  const error = send.error && !confirmFrom(send.error) ? errorText(send.error) : null;

  return (
    <AdminScreen title="Maintenance" onRefresh={() => void config.refetch()} refreshing={config.isRefetching}>
      {config.isPending ? (
        <Skeleton rows={3} />
      ) : config.isError ? (
        <ErrorState message={errorText(config.error)} onRetry={() => void config.refetch()} />
      ) : (
        <>
          <Group>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="label">{active ? "Maintenance is on" : "Maintenance is off"}</Txt>
                <Txt variant="small">{active ? "Everyone except admins sees the maintenance screen." : "Cowork is open to everyone."}</Txt>
              </View>
              <Switch value={active} disabled accessibilityLabel={`Maintenance is ${active ? "on" : "off"}`} trackColor={{ true: color.accent, false: color.surface3 }} thumbColor={color.bg} />
            </View>
          </Group>

          <Input label="Message people see" value={shownMessage} onChangeText={setMessage} placeholder="Cowork is down for planned maintenance." maxLength={300} multiline style={{ minHeight: 96, paddingTop: space.md, textAlignVertical: "top" }} />
          <Input label="Reason" value={reason} onChangeText={setReason} placeholder="Saved in the audit log" maxLength={500} />
          {pauseJobs ? <Txt variant="small">Background jobs are paused. Change that on the website console.</Txt> : null}

          <Button label={active ? "Turn maintenance off" : "Turn maintenance on"} variant={active ? "primary" : "danger"} disabled={!reasonOk} loading={send.isPending && !confirm} onPress={() => start(!active)} />
          {!reasonOk ? <Txt variant="small">Add a reason of at least 3 characters.</Txt> : null}
          {error ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {error}
            </Txt>
          ) : null}
          {done ? (
            <Txt variant="body" accessibilityLiveRegion="polite">
              {done}
            </Txt>
          ) : null}
          <Txt variant="small">The server asks you to confirm every change, and may ask for a fresh code if you unlocked more than 10 minutes ago.</Txt>
        </>
      )}

      <ConfirmSheet
        open={Boolean(confirm)}
        title="Confirm the change"
        body={confirm?.request.summary ?? ""}
        confirmLabel={confirm?.body.active ? "Turn maintenance on" : "Turn maintenance off"}
        destructive={confirm?.body.active}
        busy={send.isPending}
        onConfirm={() => confirm && send.mutate({ body: confirm.body, confirmToken: confirm.request.token })}
        onClose={() => setConfirm(null)}
      />
    </AdminScreen>
  );
}
