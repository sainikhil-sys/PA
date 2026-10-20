import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowCounterClockwiseIcon, CalendarBlankIcon, CheckIcon, ClockIcon, TrashIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { Controller, useForm, type Path, type PathValue } from "react-hook-form";
import { KeyboardAvoidingView, RefreshControl, ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Card, Divider, ErrorState, IconButton, Input, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { Segmented } from "@/features/tasks/components";
import { dayLabel, fromYmd, PRIORITY_LABEL, timeLabel, ymd } from "@/features/tasks/dates";
import { diff, DURATIONS, taskSchema, toForm, type TaskForm } from "@/features/tasks/form";
import { useDeleteTask, useSetDone, useUpdateTask } from "@/features/tasks/mutations";
import { pickDate, pickTime } from "@/features/tasks/pickers";
import { ApiError, errorText } from "@/lib/api";
import { useTask } from "@/lib/queries";
import type { TaskDetail } from "@/lib/types";
import { color, space } from "@/theme/tokens";

const STATUS_LABEL: Record<TaskDetail["status"], string> = { todo: "To do", in_progress: "In progress", needs_review: "Needs review", done: "Done" };

/** One task: edit its details, schedule it, finish it or cancel it. */
export default function TaskScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const task = useTask(id);
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await task.refetch();
    setRefreshing(false);
  }, [task]);

  let body: React.ReactNode;
  if (task.isPending) body = <Skeleton rows={5} height={64} />;
  else if (task.isError && !task.data) {
    const gone = task.error instanceof ApiError && task.error.status === 404;
    body = <ErrorState message={errorText(task.error)} onRetry={gone ? undefined : () => void task.refetch()} />;
  } else body = <TaskEditor key={task.data.id} task={task.data} />;

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm }}>
        <Txt variant="heading" accessibilityRole="header">
          Task
        </Txt>
        <IconButton icon={XIcon} label="Close" tone="plain" onPress={() => router.back()} />
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
        >
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function TaskEditor({ task }: { task: TaskDetail }) {
  const server = React.useMemo(() => toForm(task), [task]);
  const update = useUpdateTask(task.id);
  const setDone = useSetDone();
  const del = useDeleteTask(task.id);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [notice, setNotice] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const { control, handleSubmit, reset, watch, setValue, formState } = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    defaultValues: server,
  });

  // Fresh server data (after a save or refresh) replaces the form unless the user is mid-edit.
  React.useEffect(() => {
    if (!formState.isDirty) reset(server);
  }, [server, reset, formState.isDirty]);

  const dueDate = watch("dueDate");
  const scheduledAt = watch("scheduledAt");
  const durationMinutes = watch("durationMinutes");
  const priority = watch("priority");
  const done = task.status === "done";

  const set = <K extends Path<TaskForm>>(k: K, v: PathValue<TaskForm, K>) => setValue(k, v, { shouldDirty: true, shouldValidate: true });

  const save = handleSubmit((values) => {
    if (update.isPending) return;
    // Compare with what the form started from, so a change made elsewhere meanwhile (by Cowork or the web)
    // is not overwritten by a field the user never touched.
    const base = { ...server, ...(formState.defaultValues as Partial<TaskForm>) };
    const changes = diff(base, values);
    if (!Object.keys(changes).length) {
      reset(values);
      return;
    }
    setNotice(null);
    update.mutate(changes, {
      onSuccess: () => {
        reset(values);
        setNotice({ kind: "ok", text: "Saved." });
      },
      onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
    });
  });

  const toggleDone = () => {
    if (setDone.isPending) return;
    setNotice(null);
    setDone.mutate(
      { id: task.id, done: !done },
      {
        onSuccess: () => setNotice({ kind: "ok", text: done ? "Reopened." : task.recurring ? "Marked done. The next occurrence is on your list." : "Marked done." }),
        onError: (err) => setNotice({ kind: "error", text: errorText(err) }),
      },
    );
  };

  // One system dialog at a time: a second tap while one is opening is ignored.
  const picking = React.useRef(false);
  const guard = (fn: () => Promise<void>) => async () => {
    if (picking.current) return;
    picking.current = true;
    try {
      await fn();
    } finally {
      picking.current = false;
    }
  };

  const chooseDue = guard(async () => {
    const d = await pickDate(dueDate ? fromYmd(dueDate) : new Date());
    if (d) set("dueDate", ymd(d));
  });

  const defaultSlot = () => {
    const base = dueDate ? fromYmd(dueDate) : new Date();
    const now = new Date();
    base.setHours(now.getHours() + 1, 0, 0, 0);
    return base;
  };

  const chooseScheduleDay = guard(async () => {
    const cur = scheduledAt ? new Date(scheduledAt) : defaultSlot();
    const d = await pickDate(cur);
    if (!d) return;
    const next = new Date(cur);
    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    if (scheduledAt) set("scheduledAt", next.toISOString());
    else {
      // A new slot needs a time as well; ask for it straight away.
      const t = await pickTime(next);
      if (!t) return;
      next.setHours(t.getHours(), t.getMinutes(), 0, 0);
      set("scheduledAt", next.toISOString());
    }
  });

  const chooseScheduleTime = guard(async () => {
    const cur = scheduledAt ? new Date(scheduledAt) : defaultSlot();
    const t = await pickTime(cur);
    if (!t) return;
    const next = new Date(cur);
    next.setHours(t.getHours(), t.getMinutes(), 0, 0);
    set("scheduledAt", next.toISOString());
  });

  const dirty = formState.isDirty;
  const busy = update.isPending || setDone.isPending || del.isPending;

  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: space.xs }}>
        <Txt variant="small">Status: {STATUS_LABEL[task.status] ?? task.status}</Txt>
        {task.assignee !== "me" ? <Txt variant="small">Assigned to Cowork</Txt> : null}
        {task.recurring ? <Txt variant="small">Recurring</Txt> : null}
        {done && task.completedAt ? <Txt variant="small">Completed {dayLabel(ymd(new Date(task.completedAt)))}</Txt> : null}
      </View>

      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <Input label="Title" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} maxLength={200} error={fieldState.error?.message} returnKeyType="next" />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <Input
            label="Notes"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="Add details"
            multiline
            textAlignVertical="top"
            maxLength={10_000}
            error={fieldState.error?.message}
            style={{ minHeight: 112, paddingTop: space.md, paddingBottom: space.md }}
          />
        )}
      />

      <View>
        <SectionHeader title="Due date" />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            label={dueDate ? dayLabel(dueDate) : "Set a due date"}
            icon={CalendarBlankIcon}
            onPress={() => void chooseDue()}
            style={{ flex: 1 }}
            accessibilityLabel={dueDate ? `Due date, ${dayLabel(dueDate)}. Change` : "Set a due date"}
          />
          {dueDate ? <Button label="Clear" variant="ghost" onPress={() => set("dueDate", null)} accessibilityLabel="Clear the due date" /> : null}
        </View>
      </View>

      <View>
        <SectionHeader title="Scheduled time" />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            label={scheduledAt ? dayLabel(ymd(new Date(scheduledAt))) : "Pick a day"}
            icon={CalendarBlankIcon}
            onPress={() => void chooseScheduleDay()}
            style={{ flex: 1 }}
            accessibilityLabel={scheduledAt ? `Scheduled day, ${dayLabel(ymd(new Date(scheduledAt)))}. Change` : "Pick a day to schedule the task"}
          />
          <Button
            label={scheduledAt ? timeLabel(scheduledAt) : "Pick a time"}
            icon={ClockIcon}
            onPress={() => void chooseScheduleTime()}
            style={{ flex: 1 }}
            accessibilityLabel={scheduledAt ? `Scheduled time, ${timeLabel(scheduledAt)}. Change` : "Pick a time to schedule the task"}
          />
        </View>
        {scheduledAt ? <Button label="Clear time" variant="ghost" onPress={() => set("scheduledAt", null)} style={{ alignSelf: "flex-start", marginTop: space.xs }} accessibilityLabel="Clear the scheduled time" /> : null}
        <Txt variant="small" style={{ marginTop: space.sm }}>
          The reminder fires at this time. Moving the time moves the reminder with it.
        </Txt>
      </View>

      <View>
        <SectionHeader title="Duration" />
        <Segmented<number | null>
          label="Duration"
          value={durationMinutes}
          onChange={(v) => set("durationMinutes", v)}
          options={[...DURATIONS.map((m) => ({ value: m as number | null, label: m < 60 ? `${m} min` : m === 60 ? "1 hr" : "1.5 hr" })), { value: null, label: "None" }]}
        />
      </View>

      <View>
        <SectionHeader title="Priority" />
        <Segmented<number> label="Priority" value={priority} onChange={(v) => set("priority", v)} options={PRIORITY_LABEL.map((l, i) => ({ value: i, label: l }))} />
      </View>

      {task.resultMarkdown ? (
        <View>
          <SectionHeader title="Result from Cowork" />
          <Card>
            <Txt variant="body" selectable>
              {task.resultMarkdown}
            </Txt>
          </Card>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        {notice ? (
          <Txt variant="small" style={notice.kind === "error" ? { color: color.danger } : { color: color.success }} accessibilityLiveRegion="polite">
            {notice.text}
          </Txt>
        ) : null}
        <Button label="Save changes" variant="primary" onPress={() => void save()} loading={update.isPending} disabled={!dirty || busy} />
        {dirty ? <Button label="Discard changes" variant="ghost" onPress={() => reset(server)} disabled={busy} /> : null}
      </View>

      <Divider />

      <View style={{ gap: space.sm }}>
        <Button
          label={done ? "Reopen" : "Mark done"}
          icon={done ? ArrowCounterClockwiseIcon : CheckIcon}
          onPress={toggleDone}
          loading={setDone.isPending}
          disabled={busy}
        />
        <Button label="Cancel task" variant="danger" icon={TrashIcon} onPress={() => setConfirmDelete(true)} disabled={busy} />
      </View>

      <ConfirmSheet
        open={confirmDelete}
        title="Cancel this task?"
        body={`"${task.title}" will be deleted. This can't be undone.`}
        confirmLabel="Delete task"
        destructive
        busy={del.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          !del.isPending &&
          del.mutate(undefined, {
            onSuccess: () => {
              setConfirmDelete(false);
              router.back();
            },
            onError: (err) => {
              setConfirmDelete(false);
              setNotice({ kind: "error", text: errorText(err) });
            },
          })
        }
      />
    </>
  );
}
