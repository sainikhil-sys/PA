import * as WebBrowser from "expo-web-browser";
import { LockKeyIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, EmptyState, Input, Screen, Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { refresh } from "@/features/settings/parts";
import { WEB_URL } from "@/lib/config";
import { space } from "@/theme/tokens";
import { useAdminMe } from "./api";
import { can } from "./permissions";

/** Content width on tablets: the console reads as one column, centred. */
export const ADMIN_MAX_WIDTH = 720;

export const openWebConsole = () => void WebBrowser.openBrowserAsync(`${WEB_URL}/console`);

/** A console screen: header with back to the console home, a centred scrolling column, pull to refresh. */
export function AdminScreen({ title, children, onRefresh, refreshing = false, right, scroll = true }: { title: string; children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; right?: React.ReactNode; scroll?: boolean }) {
  return (
    <Screen>
      <BackHeader title={title} action={right} fallback="/admin" />
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xl, width: "100%", maxWidth: ADMIN_MAX_WIDTH, alignSelf: "center" }}
          refreshControl={onRefresh ? refresh(refreshing, onRefresh) : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, width: "100%", maxWidth: ADMIN_MAX_WIDTH, alignSelf: "center" }}>{children}</View>
      )}
    </Screen>
  );
}

/** The role's permissions from the server (cached by the console layout). */
export function usePermissions(): string[] {
  return useAdminMe().data?.permissions ?? [];
}

/** Shown in place of a screen the role can't open (for example from an old link). */
export function NotAllowed() {
  return <EmptyState icon={LockKeyIcon} title="Not available for your role" body="Ask the owner if you need this. The server refuses it either way." />;
}

/** Wraps a screen that needs one permission. */
export function RequirePermission({ permission, title, children }: { permission: string; title: string; children: React.ReactNode }) {
  const permissions = usePermissions();
  if (!can(permissions, permission)) {
    return (
      <AdminScreen title={title}>
        <NotAllowed />
      </AdminScreen>
    );
  }
  return <>{children}</>;
}

/**
 * Asks why before a change the server records in the audit log. The confirm button names the action.
 * A required reason needs 3 characters, as on the server, so the button only enables when it will be accepted.
 */
export function ReasonSheet(props: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  required?: boolean;
  destructive?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title}>
      {/* Keyed on open, so each opening starts with an empty reason. */}
      <ReasonForm key={props.open ? "open" : "closed"} {...props} />
    </Sheet>
  );
}

function ReasonForm({ body, confirmLabel, busy, error, required = true, destructive, onConfirm, onClose }: React.ComponentProps<typeof ReasonSheet>) {
  const [reason, setReason] = React.useState("");
  const ok = !required || reason.trim().length >= 3;
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="bodyMuted">{body}</Txt>
      <Input label={required ? "Reason" : "Reason (optional)"} value={reason} onChangeText={setReason} placeholder="Saved in the audit log" maxLength={500} autoCapitalize="sentences" error={error} />
      <View style={{ gap: space.sm }}>
        <Button label={confirmLabel} variant={destructive ? "danger" : "primary"} loading={busy} disabled={!ok} onPress={() => onConfirm(reason.trim())} />
        <Button label="Cancel" variant="ghost" onPress={onClose} disabled={busy} />
      </View>
    </View>
  );
}

/** "12 Nov, 14:05" in the phone's locale. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
