import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ArrowSquareOutIcon, CaretRightIcon, CheckSquareIcon, SealCheckIcon, SquareIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, View } from "react-native";
import { Button, Card, CountBadge, Divider, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { errorText } from "@/lib/api";
import { API_URL } from "@/lib/config";
import type { Today } from "@/lib/types";
import { color, space, TOUCH } from "@/theme/tokens";
import { clock, relativeTime, shortDay } from "./format";
import { useCompleteTask } from "./use-complete-task";

/** A titled card on Home. */
function HomeCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card style={{ gap: space.sm }}>
      <SectionHeader title={title} action={action} />
      {children}
    </Card>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <Txt variant="small">{children}</Txt>;
}

/** Proposals the agent prepared and is waiting on. Only rendered when there are some. */
export function ApprovalsWaitingCard({ count }: { count: number }) {
  return (
    <Card onPress={() => router.push("/approvals")} accessibilityLabel={`${count} ${count === 1 ? "approval" : "approvals"} waiting. Open approvals.`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <SealCheckIcon size={22} color={color.accentText} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading">Approvals waiting</Txt>
          <Txt variant="small">Nothing runs until you approve it.</Txt>
        </View>
        <CountBadge count={count} />
        <CaretRightIcon size={18} color={color.subtle} />
      </View>
    </Card>
  );
}

/** The latest daily briefing, or a note that it arrives each morning. */
export function BriefingCard({ briefing, loading }: { briefing: Today["briefing"] | undefined; loading: boolean }) {
  const title = briefing && !briefing.isToday ? `Briefing, from ${shortDay(briefing.date)}` : "Briefing";
  return (
    <HomeCard title={title}>
      {loading ? (
        <Skeleton rows={2} height={40} />
      ) : !briefing ? (
        <Quiet>Your daily briefing arrives each morning. It sums up your calendar, mail and tasks for the day.</Quiet>
      ) : (
        <>
          <Txt variant="heading">{briefing.headline}</Txt>
          {briefing.summary ? <Txt variant="bodyMuted">{briefing.summary}</Txt> : null}
          {briefing.priorities.length ? (
            <View style={{ gap: space.xs, marginTop: space.xs }}>
              {briefing.priorities.slice(0, 4).map((p, i) => (
                <View key={i} style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: color.accentText, marginTop: 8 }} />
                  <Txt variant="body" style={{ flex: 1 }}>
                    {p}
                  </Txt>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </HomeCard>
  );
}

/** Today's calendar events, with times in the user's timezone. */
export function ScheduleCard({ today, loading }: { today: Today | undefined; loading: boolean }) {
  const tz = today?.timezone;
  return (
    <HomeCard title="Today's schedule">
      {loading || !today ? (
        <Skeleton rows={3} height={44} />
      ) : !today.calendarConnected ? (
        <View style={{ gap: space.md }}>
          <Quiet>Google Calendar isn't connected, so your events don't show here.</Quiet>
          <Button
            label="Connect on the website"
            icon={ArrowSquareOutIcon}
            compact
            style={{ alignSelf: "flex-start", minHeight: TOUCH }}
            onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/integrations`).catch(() => {})}
          />
        </View>
      ) : today.calendarFailed ? (
        <Quiet>{"Your calendar couldn't be read just now. Pull down to try again."}</Quiet>
      ) : today.events.length === 0 ? (
        <Quiet>Nothing on your calendar today.</Quiet>
      ) : (
        today.events.map((e, i) => {
          const start = clock(e.start, tz);
          const end = clock(e.end, tz);
          const detail = [start && end ? `Until ${end}` : null, e.location].filter(Boolean).join(", ");
          const row = (
            <>
              <Txt variant="label" style={{ minWidth: 76, color: color.muted }}>
                {start ?? "All day"}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="label">{e.title || "Untitled event"}</Txt>
                {detail ? <Txt variant="small">{detail}</Txt> : null}
              </View>
            </>
          );
          // Timed events open their meeting notes; all-day ones have none.
          if (e.id && !e.allDay && start) {
            const id = e.id;
            return (
              <Pressable
                key={`${e.start}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`${start}. ${e.title || "Untitled event"}${detail ? `. ${detail}` : ""}. Opens meeting notes`}
                onPress={() => router.push({ pathname: "/meeting/[id]", params: { id, at: e.start } })}
                style={({ pressed }) => ({ flexDirection: "row", gap: space.md, paddingVertical: space.xs, minHeight: TOUCH, opacity: pressed ? 0.7 : 1 })}
              >
                {row}
              </Pressable>
            );
          }
          return (
            <View key={`${e.start}-${i}`} accessible style={{ flexDirection: "row", gap: space.md, paddingVertical: space.xs }}>
              {row}
            </View>
          );
        })
      )}
    </HomeCard>
  );
}

/** Top priorities. Ticking one marks it done right away and rolls back if the server refuses. */
export function TasksCard({ today, loading }: { today: Today | undefined; loading: boolean }) {
  const complete = useCompleteTask();
  // Ids already sent, so a quick second tap never sends the same completion twice.
  const sent = React.useRef(new Set<string>());
  const tick = (id: string) => {
    if (sent.current.has(id)) return;
    sent.current.add(id);
    // mutateAsync settles per call, unlike mutate's callbacks which fire only for the latest call.
    complete
      .mutateAsync(id)
      .catch(() => {})
      .finally(() => sent.current.delete(id));
  };
  return (
    <HomeCard title="Top tasks">
      {loading || !today ? (
        <Skeleton rows={3} height={44} />
      ) : today.tasks.length === 0 ? (
        <Quiet>No open tasks. Ask Cowork to add one, or add it in Tasks.</Quiet>
      ) : (
        today.tasks.map((t, i) => {
          const busy = complete.isPending && complete.variables === t.id;
          const BoxIcon: Icon = busy ? CheckSquareIcon : SquareIcon;
          return (
            <React.Fragment key={t.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: "row", alignItems: "center", minHeight: TOUCH }}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Mark ${t.title} done`}
                  accessibilityState={{ checked: busy, disabled: busy }}
                  disabled={busy}
                  onPress={() => tick(t.id)}
                  style={({ pressed }) => [{ width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", marginLeft: -space.md }, pressed && { opacity: 0.6 }]}
                >
                  <BoxIcon size={22} color={busy ? color.success : color.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${t.title}`}
                  onPress={() => router.push(`/task/${t.id}`)}
                  style={({ pressed }) => [{ flex: 1, paddingVertical: space.sm, justifyContent: "center", minHeight: TOUCH }, pressed && { opacity: 0.7 }]}
                >
                  <Txt variant="body" numberOfLines={2}>
                    {t.title}
                  </Txt>
                  {t.dueDate ? <Txt variant="small">Due {shortDay(t.dueDate)}</Txt> : null}
                </Pressable>
              </View>
            </React.Fragment>
          );
        })
      )}
      {complete.isError ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {errorText(complete.error)}
        </Txt>
      ) : null}
    </HomeCard>
  );
}

/** Important mail, summarised. Read-only: Cowork never sends mail from here. */
export function MailCard({ today, loading }: { today: Today | undefined; loading: boolean }) {
  return (
    <HomeCard title="Mail that needs you">
      {loading || !today ? (
        <Skeleton rows={2} height={56} />
      ) : today.mail.length === 0 ? (
        <Quiet>No mail needs your attention right now.</Quiet>
      ) : (
        today.mail.map((m, i) => (
          <React.Fragment key={m.id}>
            {i > 0 ? <Divider /> : null}
            <View accessible style={{ gap: 2, paddingVertical: space.xs }}>
              <View style={{ flexDirection: "row", gap: space.sm, alignItems: "baseline" }}>
                <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                  {m.from}
                </Txt>
                <Txt variant="small">{relativeTime(m.receivedAt, today.timezone)}</Txt>
              </View>
              <Txt variant="body" numberOfLines={1}>
                {m.subject || "(no subject)"}
              </Txt>
              {m.summary ? (
                <Txt variant="small" numberOfLines={2}>
                  {m.summary}
                </Txt>
              ) : null}
            </View>
          </React.Fragment>
        ))
      )}
    </HomeCard>
  );
}
