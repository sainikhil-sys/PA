import * as WebBrowser from "expo-web-browser";
import { ArrowSquareOutIcon, CheckCircleIcon, CircleDashedIcon, PlugsConnectedIcon, WarningCircleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, View } from "react-native";
import { Button, EmptyState, ErrorState, Screen, Skeleton, Txt } from "@/components/ui";
import { refresh, SubHeader, timeAgo } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { useIntegrations } from "@/lib/queries";
import type { Integration } from "@/lib/types";
import { color, radius, space } from "@/theme/tokens";

function statusOf(i: Integration): { icon: Icon; label: string; tint: string } {
  if (i.status === "connected") return { icon: CheckCircleIcon, label: "Connected", tint: color.success };
  if (i.status === "not_connected") return { icon: CircleDashedIcon, label: "Not connected", tint: color.subtle };
  return { icon: WarningCircleIcon, label: "Needs attention", tint: color.warning };
}

const manage = () => void WebBrowser.openBrowserAsync(`${API_URL}/integrations`);

/** Connected services, read-only. Connecting runs the website's OAuth flow, so this links there. */
export default function IntegrationsScreen() {
  const q = useIntegrations();
  return (
    <Screen>
      <SubHeader title="Connected services" />
      {q.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={5} height={64} />
        </View>
      ) : q.isError ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.sm }}
          refreshControl={refresh(q.isRefetching, () => void q.refetch())}
          ListHeaderComponent={
            <View style={{ gap: space.lg, paddingBottom: space.lg }}>
              <Txt variant="bodyMuted">
                Gmail and Calendar are read-only: your agent can read them and make Gmail drafts, and it never sends without your tap. Connect or disconnect services on the website.
              </Txt>
              <Button label="Manage on the website" variant="primary" icon={ArrowSquareOutIcon} onPress={manage} />
            </View>
          }
          ListEmptyComponent={<EmptyState icon={PlugsConnectedIcon} title="No services available" body="Services you can connect will appear here." action={<Button label="Try again" onPress={() => void q.refetch()} />} />}
          renderItem={({ item }) => {
            const s = statusOf(item);
            const SIcon = s.icon;
            return (
              <View
                accessible
                accessibilityLabel={`${item.name}, ${s.label}${item.account ? `, ${item.account}` : ""}`}
                style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: space.xs }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <Txt variant="label" style={{ flex: 1 }} numberOfLines={1}>
                    {item.name}
                  </Txt>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <SIcon size={16} color={s.tint} weight={item.status === "not_connected" ? "regular" : "fill"} />
                    <Txt variant="small" style={{ color: item.status === "not_connected" ? color.muted : color.text }}>
                      {s.label}
                    </Txt>
                  </View>
                </View>
                {item.account ? (
                  <Txt variant="small" numberOfLines={1}>
                    {item.account}
                  </Txt>
                ) : null}
                {item.error ? (
                  <Txt variant="small" style={{ color: color.warning }} numberOfLines={2}>
                    {item.error}
                  </Txt>
                ) : item.lastSyncAt ? (
                  <Txt variant="small" style={{ color: color.subtle }}>
                    Synced {timeAgo(item.lastSyncAt).toLowerCase()}
                  </Txt>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}
