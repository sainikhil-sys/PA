import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ArrowSquareOutIcon, CalendarDotsIcon, CheckSquareIcon, NotebookIcon, VideoCameraIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, RefreshControl, SectionList, View } from "react-native";
import { Button, EmptyState, ErrorState, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { clock } from "@/features/home/format";
import { BackHeader } from "@/features/home/header";
import { dayLabel, ymd } from "@/features/tasks/dates";
import { errorText } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { useSchedule, type ScheduleEvent, type ScheduleTask } from "@/lib/knowledge";
import { color, space, TOUCH } from "@/theme/tokens";

const DAYS = 7;

type Entry = { kind: "event"; at: string; event: ScheduleEvent } | { kind: "task"; at: string; task: ScheduleTask };

/** The next seven days: calendar events (read-only from Google) and scheduled tasks, by day. */
export default function AgendaScreen() {
  // Computed once per visit, so the query key stays stable while the screen is open.
  const [range] = React.useState(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + DAYS);
    return { from, to };
  });
  const schedule = useSchedule(range.from, range.to);
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await schedule.refetch();
    setRefreshing(false);
  }, [schedule]);

  const tz = schedule.data?.timezone;
  const sections = React.useMemo(() => {
    const d = schedule.data;
    if (!d) return [];
    const entries: Entry[] = [
      ...d.events.map((event): Entry => ({ kind: "event", at: event.start, event })),
      ...d.tasks.filter((t) => t.status !== "done").map((task): Entry => ({ kind: "task", at: task.start, task })),
    ];
    // All-day events carry a bare date; it sorts before any time on that day.
    const dayOf = (at: string) => (/^\d{4}-\d{2}-\d{2}$/.test(at) ? at : ymd(new Date(at)));
    entries.sort((a, b) => (dayOf(a.at) === dayOf(b.at) ? a.at.localeCompare(b.at) : dayOf(a.at).localeCompare(dayOf(b.at))));
    const byDay = new Map<string, Entry[]>();
    for (const e of entries) byDay.set(dayOf(e.at), [...(byDay.get(dayOf(e.at)) ?? []), e]);
    return [...byDay.entries()].map(([day, data]) => ({ title: dayLabel(day), data }));
  }, [schedule.data]);

  const calendar = schedule.data?.calendar;
  const banner =
    calendar === "not_connected" ? (
      <View style={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Txt variant="small">{"Google Calendar isn't connected, so only your scheduled tasks show here."}</Txt>
        <Button
          label="Connect on the website"
          icon={ArrowSquareOutIcon}
          compact
          style={{ alignSelf: "flex-start", minHeight: TOUCH }}
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/integrations`).catch(() => {})}
        />
      </View>
    ) : calendar === "error" ? (
      <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, paddingBottom: space.md, color: color.warning }}>
        {"Your calendar couldn't be read just now, so events are missing. Pull down to try again."}
      </Txt>
    ) : null;

  return (
    <Screen>
      <BackHeader title="Next 7 days" />
      {schedule.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={6} height={56} />
        </View>
      ) : schedule.isError && !schedule.data ? (
        <ErrorState message={errorText(schedule.error)} onRetry={() => void schedule.refetch()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => (e.kind === "event" ? `e:${e.event.id}` : `t:${e.task.id}`)}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={banner ?? undefined}
          contentContainerStyle={{ paddingBottom: space.xxxl, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
          renderSectionHeader={({ section }) => (
            <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
              <SectionHeader title={section.title} />
            </View>
          )}
          ListEmptyComponent={<EmptyState icon={CalendarDotsIcon} title="Nothing scheduled" body="No events or scheduled tasks in the next seven days." />}
          renderItem={({ item }) => (item.kind === "event" ? <EventRow event={item.event} tz={tz} /> : <TaskRowItem task={item.task} tz={tz} />)}
        />
      )}
    </Screen>
  );
}

function EntryRow({ icon, time, title, detail, onPress, label }: { icon: React.ReactNode; time: string; title: string; detail?: string | null; onPress?: () => void; label: string }) {
  const content = (
    <View style={{ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: TOUCH }}>
      <Txt variant="small" style={{ width: 64, paddingTop: 1 }}>
        {time}
      </Txt>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label">{title}</Txt>
        {detail ? <Txt variant="small">{detail}</Txt> : null}
      </View>
      <View style={{ paddingTop: 2 }}>{icon}</View>
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => (pressed ? { backgroundColor: color.surface2 } : undefined)}>
      {content}
    </Pressable>
  );
}

function EventRow({ event, tz }: { event: ScheduleEvent; tz?: string }) {
  const time = event.allDay ? "All day" : (clock(event.start, tz) ?? "");
  const detail = [event.location, event.attendees > 1 ? `${event.attendees} people` : null, event.hasNotes ? "Has notes" : null].filter(Boolean).join(", ");
  const open = event.allDay ? undefined : () => router.push({ pathname: "/meeting/[id]", params: { id: event.id, at: event.start } });
  return (
    <EntryRow
      time={time}
      title={event.title}
      detail={detail || null}
      onPress={open}
      label={`${time}. ${event.title}${detail ? `. ${detail}` : ""}${open ? ". Opens meeting notes" : ""}`}
      icon={event.hasNotes ? <NotebookIcon size={16} color={color.accent2} /> : event.meetingUrl ? <VideoCameraIcon size={16} color={color.muted} /> : null}
    />
  );
}

function TaskRowItem({ task, tz }: { task: ScheduleTask; tz?: string }) {
  const time = clock(task.start, tz) ?? "";
  return (
    <EntryRow
      time={time}
      title={task.title}
      detail={`Task, ${task.durationMinutes} min${task.recurring ? ", repeats" : ""}`}
      onPress={() => router.push(`/task/${task.id}`)}
      label={`${time}. Task: ${task.title}`}
      icon={<CheckSquareIcon size={16} color={color.muted} />}
    />
  );
}
