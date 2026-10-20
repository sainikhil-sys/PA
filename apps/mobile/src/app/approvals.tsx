import { router } from "expo-router";
import { ChatCircleIcon, CheckIcon, SealCheckIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Card, EmptyState, ErrorState, Screen, Skeleton, Txt } from "@/components/ui";
import { sourceLabel } from "@/features/approvals/source";
import { relativeTime } from "@/features/home/format";
import { BackHeader } from "@/features/home/header";
import { errorText } from "@/lib/api";
import { useApprovals, useDecide, useMe } from "@/lib/queries";
import type { Approval } from "@/lib/types";
import { color, space } from "@/theme/tokens";

/** Proposals the agent prepared. Each one runs only after you approve it here. */
export default function ApprovalsScreen() {
  const approvals = useApprovals();
  const me = useMe();
  const decide = useDecide();
  const [confirming, setConfirming] = React.useState<Approval | null>(null);
  const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await approvals.refetch();
    setRefreshing(false);
  }, [approvals]);

  const run = (item: Approval, action: "approve" | "dismiss") => {
    setNotice(null);
    decide.mutate(
      { id: item.id, action },
      {
        onSuccess: (res) => setNotice({ text: res.message || (action === "approve" ? "Done." : "Dismissed.") }),
        onError: (err) => setNotice({ text: errorText(err), error: true }),
        onSettled: () => setConfirming(null),
      },
    );
  };

  const busyId = decide.isPending ? decide.variables?.id : undefined;
  const tz = me.data?.timezone;

  return (
    <Screen>
      <BackHeader title="Approvals" />
      {notice ? (
        <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, color: notice.error ? color.danger : color.muted }}>
          {notice.text}
        </Txt>
      ) : null}
      {approvals.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} height={120} />
        </View>
      ) : approvals.isError && !approvals.data ? (
        <ErrorState message={errorText(approvals.error)} onRetry={() => void approvals.refetch()} />
      ) : (
        <FlatList
          data={approvals.data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
          ListHeaderComponent={
            approvals.data?.length ? <Txt variant="small">Cowork prepared these. Nothing runs, sends or posts until you approve it.</Txt> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={SealCheckIcon}
              title="Nothing waiting"
              body="When Cowork prepares something that needs your approval, it shows up here."
              action={<Button label="Back to Home" compact onPress={() => router.replace("/")} />}
            />
          }
          renderItem={({ item }) => {
            const busy = busyId === item.id;
            return (
              <Card style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
                  <Txt variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                    {item.label}
                  </Txt>
                  <Txt variant="small">
                    {sourceLabel(item.source)}, {relativeTime(item.createdAt, tz)}
                  </Txt>
                </View>
                <Txt variant="body">{item.summary}</Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs }}>
                  <Button label="Approve" icon={CheckIcon} compact disabled={decide.isPending} loading={busy && decide.variables?.action === "approve"} onPress={() => setConfirming(item)} />
                  <Button
                    label="Dismiss"
                    variant="ghost"
                    compact
                    disabled={decide.isPending}
                    loading={busy && decide.variables?.action === "dismiss"}
                    accessibilityLabel={`Dismiss ${item.label}`}
                    onPress={() => run(item, "dismiss")}
                  />
                  {item.conversationId ? (
                    <Button label="Open chat" icon={ChatCircleIcon} variant="ghost" compact onPress={() => router.push(`/chat/${item.conversationId}`)} />
                  ) : null}
                </View>
              </Card>
            );
          }}
        />
      )}
      <ConfirmSheet
        open={confirming !== null}
        title="Approve and run"
        body={confirming ? `${confirming.summary}\n\nThis runs once, right now.` : ""}
        confirmLabel="Approve and run"
        busy={decide.isPending}
        onConfirm={() => confirming && run(confirming, "approve")}
        onClose={() => !decide.isPending && setConfirming(null)}
      />
    </Screen>
  );
}
