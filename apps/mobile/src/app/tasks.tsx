import { router, useLocalSearchParams } from "expo-router";
import { CheckCircleIcon, CheckSquareIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, RefreshControl, SectionList, TextInput, View } from "react-native";
import { Button, Divider, EmptyState, ErrorState, SectionHeader, Screen, Skeleton, Txt } from "@/components/ui";
import { BackHeader } from "@/features/home/header";
import { QuickAddBar, TaskRow } from "@/features/tasks/components";
import { groupTasks } from "@/features/tasks/dates";
import { useQuickAdd, useSetDone } from "@/features/tasks/mutations";
import { errorText } from "@/lib/api";
import { useTasks } from "@/lib/queries";
import { color, space } from "@/theme/tokens";

/** Tasks (from Workspace or Create): open tasks grouped by day, with a natural-language quick add. ?add=1 focuses the quick add. */
export default function TasksScreen() {
  const tasks = useTasks();
  const setDone = useSetDone();
  const quickAdd = useQuickAdd();
  const inputRef = React.useRef<React.ComponentRef<typeof TextInput>>(null);
  const params = useLocalSearchParams<{ add?: string }>();
  const [text, setText] = React.useState("");
  // Opened from Create > New task: put the cursor in quick add once the screen has drawn.
  React.useEffect(() => {
    if (params.add !== "1") return;
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [params.add]);
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await tasks.refetch();
    setRefreshing(false);
  }, [tasks]);

  // isPending only updates on the next render, so a fast double tap would add the task twice.
  const adding = React.useRef(false);
  const add = () => {
    const value = text.trim();
    if (!value || adding.current) return;
    adding.current = true;
    setNotice(null);
    quickAdd.mutate(value, {
      onSettled: () => {
        adding.current = false;
      },
      onSuccess: (r) => {
        setText("");
        setNotice({ kind: "ok", text: `Added: ${r.summary}` });
      },
      onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
    });
  };

  const complete = (id: string) => {
    setNotice(null);
    setDone.mutate({ id, done: true }, { onError: (err) => setNotice({ kind: "error", text: `Couldn't complete that task. ${errorText(err)}` }) });
  };

  const sections = React.useMemo(() => groupTasks(tasks.data ?? []), [tasks.data]);
  const count = tasks.data?.length ?? 0;

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      {tasks.data ? <Txt variant="small">{count === 1 ? "1 open task" : `${count} open tasks`}</Txt> : null}
      <QuickAddBar value={text} onChangeText={setText} onSubmit={add} busy={quickAdd.isPending} inputRef={inputRef} />
      {notice ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} accessibilityLiveRegion="polite">
          {notice.kind === "ok" ? <CheckCircleIcon size={16} color={color.success} weight="fill" /> : null}
          <Txt variant="small" style={[{ flex: 1 }, notice.kind === "error" ? { color: color.danger } : null]}>
            {notice.text}
          </Txt>
        </View>
      ) : null}
      {tasks.isError && tasks.data ? (
        <Txt variant="small" accessibilityLiveRegion="polite">
          {`Couldn't refresh. ${errorText(tasks.error)}`}
        </Txt>
      ) : null}
    </View>
  );

  let empty: React.ReactElement;
  if (tasks.isPending) empty = <Skeleton rows={5} />;
  else if (tasks.isError && !tasks.data) empty = <ErrorState message={errorText(tasks.error)} onRetry={() => void tasks.refetch()} />;
  else
    empty = (
      <EmptyState
        icon={CheckSquareIcon}
        title="No open tasks"
        body="Add one above, with a day, time or #tag if you like."
        action={<Button label="Add a task" onPress={() => inputRef.current?.focus()} />}
      />
    );

  return (
    <Screen>
      <BackHeader title="Tasks" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxxl }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderSectionHeader={({ section }) => (
            <View style={{ paddingTop: space.lg }}>
              <SectionHeader title={`${section.title} (${section.data.length})`} />
            </View>
          )}
          renderItem={({ item }) => <TaskRow task={item} onToggle={() => complete(item.id)} onOpen={() => router.push(`/task/${item.id}`)} />}
          ItemSeparatorComponent={() => <Divider style={{ marginLeft: 52 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} progressBackgroundColor={color.surface2} />}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
