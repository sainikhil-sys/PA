import { useLocalSearchParams } from "expo-router";
import { TrayIcon, TrashIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Pressable, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { EmptyState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { ACTIVE, type TransferRow } from "@/features/connect/files-db";
import { useFiles } from "@/features/connect/files";
import { FileBubble, MediaViewer } from "@/features/connect/files-ui";
import { useConnectFeatures } from "@/features/connect/groups-ui";
import { SubHeader } from "@/features/settings/parts";
import { color, radius, space, TOUCH } from "@/theme/tokens";

type Filter = "all" | "file" | "snap" | "voice";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "file", label: "Files" },
  { key: "snap", label: "SnapShare" },
  { key: "voice", label: "Voice" },
];

function when(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

/** Every file, SnapShare and voice message sent or received over Connect, newest first. */
export default function TransfersScreen() {
  useConnectFeatures();
  const params = useLocalSearchParams<{ filter?: string }>();
  const initial = FILTERS.some((f) => f.key === params.filter) ? (params.filter as Filter) : "all";
  const [filter, setFilter] = React.useState<Filter>(initial);
  const transfers = useFiles((x) => x.transfers);
  const loaded = useFiles((x) => x.loaded);
  const remove = useFiles((x) => x.remove);
  const [viewing, setViewing] = React.useState<TransferRow | null>(null);
  const [confirm, setConfirm] = React.useState<TransferRow | null>(null);

  const shown = React.useMemo(() => {
    const list = transfers.filter((t) => filter === "all" || t.kind === filter);
    // Anything waiting for my decision comes first.
    return [...list.filter((t) => t.status === "incoming"), ...list.filter((t) => t.status !== "incoming")];
  }, [transfers, filter]);

  return (
    <Screen>
      <SubHeader title="Transfers" />
      <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f.key }}
            onPress={() => setFilter(f.key)}
            style={{ minHeight: TOUCH, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.control, borderWidth: 1, borderColor: filter === f.key ? color.borderStrong : color.border, backgroundColor: filter === f.key ? color.surface3 : color.surface }}
          >
            <Txt variant="label" style={{ color: filter === f.key ? color.text : color.muted }}>
              {f.label}
            </Txt>
          </Pressable>
        ))}
      </View>

      {!loaded ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} height={88} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
          ListEmptyComponent={
            <EmptyState
              icon={TrayIcon}
              title="Nothing here yet"
              body={filter === "snap" ? "Photos and videos you share with SnapShare appear here." : filter === "voice" ? "Voice messages you send or receive appear here." : "Files you send or receive over Connect appear here. They stay on this phone."}
            />
          }
          renderItem={({ item }) => (
            <View style={{ marginTop: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
                  {item.outgoing ? `To ${item.peerName}` : `From ${item.peerName}`} · {when(item.ts)}
                </Txt>
                {!ACTIVE.includes(item.status) ? <IconButton icon={TrashIcon} label={`Remove ${item.name} from history`} tone="plain" onPress={() => setConfirm(item)} /> : null}
              </View>
              <FileBubble t={item} wide onOpen={setViewing} />
            </View>
          )}
        />
      )}

      <MediaViewer t={viewing} onClose={() => setViewing(null)} />
      <ConfirmSheet
        open={Boolean(confirm)}
        title="Remove from history?"
        body={confirm && !confirm.outgoing && confirm.uri ? "The received file is deleted from this phone. The other person keeps their copy." : "This entry is removed from this phone. Your original file is not touched."}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (confirm) await remove(confirm.id);
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}
