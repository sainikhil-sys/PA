import * as WebBrowser from "expo-web-browser";
import { ArrowCircleUpIcon, ArrowClockwiseIcon, DownloadSimpleIcon, ShieldStarIcon, SignOutIcon, WrenchIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Linking, ScrollView, View } from "react-native";
import { Button, Screen, Txt } from "@/components/ui";
import { WEB_URL } from "@/lib/config";
import { useSession } from "@/lib/session";
import { color, radius, space } from "@/theme/tokens";
import { useClientConfigStore } from "./store";

const DEFAULT_UPDATE = "This version of Cowork is no longer supported. Install the latest version to keep using it.";
const DEFAULT_MAINTENANCE = "Cowork is down for planned maintenance. Your data is safe. Try again in a little while.";

/** Opens only web or Play Store links from the server, never anything else. */
function openStore(url: string | null) {
  if (url && /^(https:\/\/|market:\/\/)/i.test(url)) void Linking.openURL(url).catch(() => {});
}

function GateFrame({ icon: IconCmp, title, message, children }: { icon: Icon; title: string; message: string; children: React.ReactNode }) {
  return (
    <Screen edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.xxl, maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: space.lg }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.card, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: "center", justifyContent: "center" }}>
            <IconCmp size={28} color={color.accentText} />
          </View>
          <Txt variant="title" accessibilityRole="header">
            {title}
          </Txt>
          <Txt variant="bodyMuted" accessibilityLiveRegion="polite">
            {message}
          </Txt>
        </View>
        <View style={{ gap: space.sm }}>{children}</View>
      </ScrollView>
    </Screen>
  );
}

/** 426 or a required update: cannot be dismissed. Sign-out and the data page still work (the server exempts them). */
export function UpdateRequiredScreen({ message, storeUrl }: { message: string | null; storeUrl: string | null }) {
  const signedIn = useSession((s) => s.status === "signedIn");
  const signOut = useSession((s) => s.signOut);
  const [signingOut, setSigningOut] = React.useState(false);
  return (
    <GateFrame icon={ArrowCircleUpIcon} title="Update Cowork" message={message || DEFAULT_UPDATE}>
      {storeUrl ? (
        <Button label="Get the update" variant="primary" icon={ArrowCircleUpIcon} onPress={() => openStore(storeUrl)} />
      ) : (
        <Txt variant="small">Open the Play Store and update Cowork from there.</Txt>
      )}
      {signedIn ? (
        <>
          <Button
            label="Export or delete your data"
            icon={DownloadSimpleIcon}
            accessibilityLabel="Export or delete your data on the website"
            onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/settings/privacy`)}
          />
          <Button
            label="Sign out"
            variant="ghost"
            icon={SignOutIcon}
            loading={signingOut}
            onPress={() => {
              setSigningOut(true);
              void signOut({ remote: true }).finally(() => setSigningOut(false));
            }}
          />
        </>
      ) : null}
    </GateFrame>
  );
}

function backBy(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return null;
  return `Expected back by ${d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`;
}

/** Maintenance (a 503 or the configuration): a full-screen message with a retry. */
export function MaintenanceScreen({ message, endsAt, onRetry, onOpenAdmin }: { message: string | null; endsAt: string | null; onRetry?: () => void; onOpenAdmin?: () => void }) {
  const refreshing = useClientConfigStore((s) => s.refreshing);
  const retry = useClientConfigStore((s) => s.retryMaintenance);
  const back = backBy(endsAt);
  return (
    <GateFrame icon={WrenchIcon} title="Cowork is down for maintenance" message={[message || DEFAULT_MAINTENANCE, back].filter(Boolean).join(" ")}>
      <Button label="Try again" variant="primary" icon={ArrowClockwiseIcon} loading={refreshing} onPress={() => void retry().then(onRetry)} />
      {onOpenAdmin ? <Button label="Open admin console" icon={ShieldStarIcon} onPress={onOpenAdmin} /> : null}
    </GateFrame>
  );
}
