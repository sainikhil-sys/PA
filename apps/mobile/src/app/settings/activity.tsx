import { CheckCircleIcon, ListChecksIcon, ProhibitIcon, XCircleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, View } from "react-native";
import { Button, EmptyState, ErrorState, Screen, Skeleton, Txt } from "@/components/ui";
import { refresh, SubHeader, timeAgo } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { useActivity } from "@/lib/queries";
import type { ActivityEntry } from "@/lib/types";
import { color, space } from "@/theme/tokens";

const OUTCOME: Record<string, { icon: Icon; label: string; tint: string }> = {
  success: { icon: CheckCircleIcon, label: "Done", tint: color.success },
  error: { icon: XCircleIcon, label: "Failed", tint: color.danger },
  denied: { icon: ProhibitIcon, label: "Blocked", tint: color.warning },
};

const ACTOR: Record<string, string> = { me: "You", agent: "Your agent", claude: "Claude", system: "Cowork" };

/** "gmail.create_draft" -> "Gmail create draft". */
function toolLabel(tool: string) {
  const s = tool.replace(/[._-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Entry({ item, last }: { item: ActivityEntry; last: boolean }) {
  const o = OUTCOME[item.outcome] ?? { icon: CheckCircleIcon, label: item.outcome, tint: color.muted };
  const OIcon = o.icon;
  const who = ACTOR[item.actor] ?? item.actor;
  return (
    <View style={{ flexDirection: "row", gap: space.md }} accessible accessibilityLabel={`${who}, ${toolLabel(item.tool)}, ${o.label}, ${timeAgo(item.createdAt)}${item.inputSummary ? `, ${item.inputSummary}` : ""}`}>
      <View style={{ alignItems: "center", width: 20 }}>
        <View style={{ marginTop: 3 }}>
          <OIcon size={18} color={o.tint} weight="fill" />
        </View>
        {!last ? <View style={{ flex: 1, width: 1, backgroundColor: color.border, marginTop: space.xs }} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: space.xl, gap: 2 }}>
        <Txt variant="label">{toolLabel(item.tool)}</Txt>
        {item.inputSummary ? (
          <Txt variant="small" numberOfLines={2}>
            {item.inputSummary}
          </Txt>
        ) : null}
        <Txt variant="small" style={{ color: color.subtle }}>
          {who}, {o.label.toLowerCase()}, {timeAgo(item.createdAt).toLowerCase()}
        </Txt>
      </View>
    </View>
  );
}

/** Timeline of what you and your agent did. Summaries only, never message or document content. */
export default function ActivityScreen() {
  const q = useActivity();
  return (
    <Screen>
      <SubHeader title="Activity" />
      {q.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={6} height={52} />
        </View>
      ) : q.isError ? (
        <View style={{ padding: space.lg }}>
          <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}
          refreshControl={refresh(q.isRefetching, () => void q.refetch())}
          ListHeaderComponent={
            <Txt variant="bodyMuted" style={{ paddingBottom: space.xl }}>
              The latest 30 actions taken in your account. Entries describe what happened, not the content involved.
            </Txt>
          }
          ListEmptyComponent={<EmptyState icon={ListChecksIcon} title="No activity yet" body="Actions you and your agent take will show up here." action={<Button label="Refresh" onPress={() => void q.refetch()} />} />}
          renderItem={({ item, index }) => <Entry item={item} last={index === q.data.length - 1} />}
        />
      )}
    </Screen>
  );
}
