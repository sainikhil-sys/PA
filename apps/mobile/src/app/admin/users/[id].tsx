import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { CheckCircleIcon, ProhibitIcon, SignOutIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, ErrorState, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { adminKeys, adminOp, useUserDetail } from "@/features/admin/api";
import { can } from "@/features/admin/permissions";
import { AdminScreen, ReasonSheet, RequirePermission, shortDateTime, usePermissions } from "@/features/admin/ui";
import { Group, timeAgo } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

export default function AdminUser() {
  return (
    <RequirePermission permission="users.read" title="Account">
      <UserDetailScreen />
    </RequirePermission>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }}>
      <Txt variant="small">{label}</Txt>
      <Txt variant="label" style={{ flexShrink: 1, textAlign: "right" }}>
        {value}
      </Txt>
    </View>
  );
}

function UserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = typeof id === "string" ? id : "";
  const qc = useQueryClient();
  const permissions = usePermissions();
  const detail = useUserDetail(userId);
  const [sheet, setSheet] = React.useState<"suspend" | "restore" | "signout" | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  const after = (message: string) => {
    setSheet(null);
    setDone(message);
    void qc.invalidateQueries({ queryKey: adminKeys.user(userId) });
    void qc.invalidateQueries({ queryKey: ["admin", "users"] });
  };
  const setDisabled = useMutation({
    mutationFn: (disabled: boolean) => adminOp(`/api/admin/users/${encodeURIComponent(userId)}/disabled`, { method: "POST", body: { disabled } }),
    onSuccess: (_d, disabled) => after(disabled ? "Account suspended and signed out everywhere." : "Account restored. They can sign in again."),
  });
  const signOutAll = useMutation({
    mutationFn: (reason: string) => adminOp<{ revoked: number }>(`/api/admin/users/${encodeURIComponent(userId)}/sessions`, { method: "DELETE", body: reason ? { reason } : {} }),
    onSuccess: (r) => after(`Signed out of ${r.revoked} session${r.revoked === 1 ? "" : "s"}.`),
  });

  const d = detail.data;
  const u = d?.user;
  const canSuspend = can(permissions, "users.suspend");
  const canRevoke = can(permissions, "users.sessions.revoke");
  const mutationError = setDisabled.error ?? signOutAll.error;

  return (
    <AdminScreen title="Account" onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
      {detail.isPending ? (
        <Skeleton rows={4} />
      ) : detail.isError || !d || !u ? (
        <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
      ) : (
        <>
          <View style={{ gap: space.xs }}>
            <Txt variant="title" numberOfLines={2}>
              {u.name || u.email}
            </Txt>
            {u.name ? <Txt variant="bodyMuted">{u.email}</Txt> : null}
            <Txt variant="small" style={u.disabledAt ? { color: color.danger } : undefined} accessibilityLiveRegion="polite">
              {u.disabledAt ? `Suspended ${shortDateTime(u.disabledAt)}` : "Active"}
            </Txt>
          </View>

          {done ? (
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }} accessibilityLiveRegion="polite">
              <CheckCircleIcon size={20} color={color.success} />
              <Txt variant="body" style={{ flex: 1 }}>
                {done}
              </Txt>
            </View>
          ) : null}

          <Group>
            <Line label="Joined" value={shortDateTime(u.createdAt)} />
            {u.adminRole ? <Line label="Admin role" value={u.adminRole} /> : null}
            <Line label="Signed-in devices" value={String(d.sessions.length)} />
            <Line label="Active restrictions" value={String(d.restrictions.filter((r) => r.active).length)} />
          </Group>

          {canSuspend || canRevoke ? (
            <View style={{ gap: space.sm }}>
              {canSuspend ? (
                u.disabledAt ? (
                  <Button label="Restore account" icon={CheckCircleIcon} onPress={() => setSheet("restore")} />
                ) : (
                  <Button label="Suspend account" variant="danger" icon={ProhibitIcon} onPress={() => setSheet("suspend")} />
                )
              ) : null}
              {canRevoke ? <Button label="Sign out everywhere" icon={SignOutIcon} disabled={!d.sessions.length} onPress={() => setSheet("signout")} /> : null}
              {mutationError ? (
                <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
                  {errorText(mutationError)}
                </Txt>
              ) : null}
            </View>
          ) : null}

          <View>
            <SectionHeader title="Signed-in devices" />
            {d.sessions.length ? (
              <Group>
                {d.sessions.map((s) => (
                  <View key={s.id} style={{ padding: space.lg, gap: 2 }}>
                    <Txt variant="label">{s.device}</Txt>
                    <Txt variant="small">{[s.appVersion ? `App ${s.appVersion}` : null, `Last seen ${timeAgo(s.lastSeenAt).toLowerCase()}`].filter(Boolean).join("  ·  ")}</Txt>
                  </View>
                ))}
              </Group>
            ) : (
              <Txt variant="small">Not signed in anywhere.</Txt>
            )}
          </View>

          {d.restrictions.some((r) => r.active) ? (
            <View>
              <SectionHeader title="Restrictions" />
              <Group>
                {d.restrictions
                  .filter((r) => r.active)
                  .map((r) => (
                    <View key={r.id} style={{ padding: space.lg, gap: 2 }}>
                      <Txt variant="label">{r.feature}</Txt>
                      <Txt variant="small">{r.expiresAt ? `Until ${shortDateTime(r.expiresAt)}` : "No end date"}</Txt>
                    </View>
                  ))}
              </Group>
              <Txt variant="small" style={{ marginTop: space.sm }}>
                Restrictions are added and lifted on the website console.
              </Txt>
            </View>
          ) : null}
        </>
      )}

      <ConfirmSheet
        open={sheet === "suspend" || sheet === "restore"}
        title={sheet === "suspend" ? "Suspend this account?" : "Restore this account?"}
        body={sheet === "suspend" ? "They are signed out on every device and can't sign in until you restore the account. Their data stays." : "They can sign in again. Nothing else changes."}
        confirmLabel={sheet === "suspend" ? "Suspend account" : "Restore account"}
        destructive={sheet === "suspend"}
        busy={setDisabled.isPending}
        onConfirm={() => setDisabled.mutate(sheet === "suspend")}
        onClose={() => setSheet(null)}
      />
      <ReasonSheet
        open={sheet === "signout"}
        title="Sign out everywhere?"
        body="Ends every session on the web and on phones. They can sign in again with their email."
        confirmLabel="Sign out everywhere"
        required={false}
        destructive
        busy={signOutAll.isPending}
        onConfirm={(reason) => signOutAll.mutate(reason)}
        onClose={() => setSheet(null)}
      />
    </AdminScreen>
  );
}
