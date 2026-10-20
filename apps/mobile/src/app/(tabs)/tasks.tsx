import { router } from "expo-router";
import { CheckCircleIcon, CheckSquareIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, RefreshControl, SectionList, type TextInput, View } from "react-native";
import { Button, Divider, EmptyState, ErrorState, SectionHeader, Screen, Skeleton, Txt } from "@/components/ui";
import { QuickAddBar, TaskRow } from "@/features/tasks/components";
import { groupTasks } from "@/features/tasks/dates";
import { useQuickAdd, useSetDone } from "@/features/tasks/mutations";
import { errorText } from "@/lib/api";
import { useTasks } from "@/lib/queries";
import { color, space } from "@/theme/tokens";

/** Tasks: open tasks grouped by day, with a natural-language quick add at the top. */
export default function TasksScreen() {
  const tasks = useTasks();
  const setDone = useSetDone();
  const quickAdd = useQuickAdd();
  const inputRef = React.useRef<TextInput>(null);
  const [text, setText] = React.useState("");
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await tasks.refetch();
    setRefreshing(false);
  }, [tasks]);

  const add = () => {
    const value = text.trim();
    if (!value || quickAdd.isPending) return;
    setNotice(null);
    quickAdd.mutate(value, {
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
      <View>
        <Txt variant="title" accessibilityRole="header">
          Tasks
        </Txt>
        {tasks.data ? <Txt variant="small">{count === 1 ? "1 open task" : `${count} open tasks`}</Txt> : null}
      </View>
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
          Couldn't refresh. {errorText(tasks.error)}
        </Txt>
      ) : null}
    </View>
  );

  let empty: React.ReactElement;
  if (tasks.isPending) empty = <Skeleton rows={5} />;
  else if (tasks.isError) empty = <ErrorState message={errorText(tasks.error)} onRetry={() => void tasks.refetch()} />;
  else
    empty = (
      <EmptyState
        icon={CheckSquareIcon}
        title="No open tasks"
        body="Add one above, with a day, time or #tag if you like."
        action={<Button label="Add a task" variant="primary" onPress={() => inputRef.current?.focus()} />}
      />
    );

  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxxl }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderSectionHeader={({ section }) => (
            <View style={{ paddingTop: space.lg }}>
              <SectionHeader title={`${section.title} (${section.data.length})`} />
            </View>
          )}
          renderItem={({ item }) => <TaskRow task={item} onToggle={() => complete(item.id)} onOpen={() => router.push(`/task/${item.id}`)} />}
          ItemSeparatorComponent={() => <Divider style={{ marginLeft: 52 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
