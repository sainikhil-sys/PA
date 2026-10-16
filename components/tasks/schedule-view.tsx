"use client";

import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CaretLeft, CaretRight, Lightning, VideoCamera } from "@phosphor-icons/react";
import { addDays, addMonths, startOfMonth, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { createTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { fetcher } from "@/lib/fetcher";
import { suggestFocusBlocks } from "@/lib/tasks/focus";
import { cn } from "@/lib/utils";

type Ev = { id: string; title: string; start: string; end: string; allDay: boolean; meetingUrl: string | null; attendees: number };
type Tk = { id: string; title: string; start: string; durationMinutes: number; status: string; recurring: boolean };
type Data = { timezone: string; calendar: "ok" | "not_connected" | "error"; events: Ev[]; tasks: Tk[] };

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00–21:00
const ROW = 48; // px per hour
const WORK = { start: 9, end: 18 };

export function ScheduleView({ timezone, onOpenTask }: { timezone: string; onOpenTask: (id: string) => void }) {
  const [view, setView] = React.useState<"day" | "week" | "month">("week");
  const [anchor, setAnchor] = React.useState(() => toZonedTime(new Date(), timezone));

  const days = React.useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "week") {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const s = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, i) => addDays(s, i));
  }, [view, anchor]);

  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = fromZonedTime(`${ymd(days[0]!)}T00:00:00`, timezone);
  const to = fromZonedTime(`${ymd(addDays(days.at(-1)!, 1))}T00:00:00`, timezone);
  const { data, error, mutate } = useSWR<Data>(`/api/schedule?from=${from.toISOString()}&to=${to.toISOString()}`, fetcher, { refreshInterval: 30_000 });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const step = (dir: 1 | -1) => setAnchor((a) => (view === "month" ? addMonths(a, dir) : addDays(a, dir * (view === "week" ? 7 : 1))));
  const today = ymd(toZonedTime(new Date(), timezone));

  const reschedule = async (taskId: string, slot: string) => {
    const task = data?.tasks.find((t) => t.id === taskId);
    if (!task) return;
    // slot: "YYYY-MM-DD" (keep time) or "YYYY-MM-DDTHH"
    const time = slot.includes("T") ? `${slot.split("T")[1]}:00:00` : formatInTimeZone(new Date(task.start), timezone, "HH:mm:ss");
    const at = fromZonedTime(`${slot.slice(0, 10)}T${time}`, timezone);
    if (at.toISOString() === task.start) return;
    void mutate((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, start: at.toISOString() } : t)) } : d), false);
    const res = await updateTaskAction({ id: taskId, scheduledAt: at.toISOString() });
    if (!res.ok) toast.error(res.error);
    else toast.success("Rescheduled", { description: formatInTimeZone(at, timezone, "EEE MMM d, HH:mm") });
    void mutate();
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over) void reschedule(String(e.active.id), String(e.over.id));
  };

  const title = view === "month" ? formatInTimeZone(fromZonedTime(`${ymd(anchor)}T12:00:00`, timezone), timezone, "MMMM yyyy") : view === "week" ? `${formatInTimeZone(from, timezone, "MMM d")} – ${formatInTimeZone(addDays(to, -1), timezone, "MMM d")}` : formatInTimeZone(from, timezone, "EEEE, MMMM d");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon-sm" variant="secondary" onClick={() => step(-1)} aria-label="Previous">
            <CaretLeft />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(toZonedTime(new Date(), timezone))}>
            Today
          </Button>
          <Button size="icon-sm" variant="secondary" onClick={() => step(1)} aria-label="Next">
            <CaretRight />
          </Button>
          <h2 className="ml-2 text-[15px] font-medium" aria-live="polite">
            {title}
          </h2>
        </div>
        <Segmented id="sched-view" label="Calendar view" value={view} onChange={setView} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      </div>
      {data?.calendar === "not_connected" ? (
        <p className="rounded-[12px] border border-dashed border-border-strong px-4 py-3 text-[13px] text-muted">
          Showing scheduled tasks only. <a className="underline underline-offset-4" href="/api/integrations/google/start?returnTo=/tasks?view=schedule">Connect Google Calendar</a> to see meetings.
        </p>
      ) : null}
      {error ? <ErrorState compact /> : null}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {view === "month" ? (
          <MonthGrid days={days} month={anchor.getMonth()} data={data} timezone={timezone} today={today} ymd={ymd} onOpenTask={onOpenTask} />
        ) : (
          <TimeGrid days={days} data={data} timezone={timezone} today={today} ymd={ymd} onOpenTask={onOpenTask} onAdded={() => void mutate()} />
        )}
      </DndContext>
      <p className="text-[12px] text-subtle">Drag a task to reschedule it. Meetings are read-only from Google Calendar. Dashed blocks are focus-time suggestions, created only if you add them.</p>
    </div>
  );
}

function TimeGrid({ days, data, timezone, today, ymd, onOpenTask, onAdded }: { days: Date[]; data?: Data; timezone: string; today: string; ymd: (d: Date) => string; onOpenTask: (id: string) => void; onAdded: () => void }) {
  const pos = (iso: string) => {
    const z = toZonedTime(new Date(iso), timezone);
    return Math.max(0, (z.getHours() + z.getMinutes() / 60 - HOURS[0]!) * ROW);
  };
  return (
    <div className="overflow-x-auto rounded-[16px] border border-border" data-lenis-prevent>
      <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))` }}>
        <div className="border-b border-border" />
        {days.map((d) => (
          <div key={ymd(d)} className={cn("border-b border-l border-border px-2 py-2 text-center text-[12px]", ymd(d) === today ? "font-medium" : "text-muted")}>
            {d.toLocaleDateString("en-US", { weekday: "short" })} <span className={cn("tabular", ymd(d) === today && "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground")}>{d.getDate()}</span>
          </div>
        ))}
        <div className="relative">
          {HOURS.map((h) => (
            <div key={h} className="tabular h-12 pr-2 text-right text-[11px] text-subtle" style={{ height: ROW }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((d) => {
          const key = ymd(d);
          const evs = (data?.events ?? []).filter((e) => !e.allDay && formatInTimeZone(new Date(e.start), timezone, "yyyy-MM-dd") === key);
          const tks = (data?.tasks ?? []).filter((t) => formatInTimeZone(new Date(t.start), timezone, "yyyy-MM-dd") === key);
          const busy = [...evs.map((e) => ({ start: new Date(e.start), end: new Date(e.end) })), ...tks.map((t) => ({ start: new Date(t.start), end: new Date(new Date(t.start).getTime() + t.durationMinutes * 60_000) }))];
          const focus = key >= today ? suggestFocusBlocks(busy, { workStart: fromZonedTime(`${key}T${String(WORK.start).padStart(2, "0")}:00:00`, timezone), workEnd: fromZonedTime(`${key}T${WORK.end}:00:00`, timezone) }, { now: new Date(), maxBlocks: 1 }) : [];
          return (
            <div key={key} className="relative border-l border-border">
              {HOURS.map((h) => (
                <Slot key={h} id={`${key}T${String(h).padStart(2, "0")}`} />
              ))}
              {focus.map((f) => (
                <FocusBlock key={f.start.toISOString()} top={pos(f.start.toISOString())} height={((f.end.getTime() - f.start.getTime()) / 3_600_000) * ROW} start={f.start} onAdded={onAdded} />
              ))}
              {evs.map((e) => (
                <div key={e.id} className="absolute inset-x-1 overflow-hidden rounded-[8px] bg-primary px-2 py-1 text-[12px] leading-tight text-primary-foreground" style={{ top: pos(e.start), height: Math.max(22, ((new Date(e.end).getTime() - new Date(e.start).getTime()) / 3_600_000) * ROW - 2) }} title={e.title}>
                  <span className="flex items-center gap-1 truncate font-medium">
                    {e.meetingUrl ? <VideoCamera size={12} weight="fill" aria-label="Video call" /> : null}
                    {e.title}
                  </span>
                  <span className="tabular opacity-80">{formatInTimeZone(new Date(e.start), timezone, "HH:mm")}</span>
                </div>
              ))}
              {tks.map((t) => (
                <DraggableTask key={t.id} task={t} top={pos(t.start)} height={Math.max(24, (t.durationMinutes / 60) * ROW - 2)} timezone={timezone} onOpen={onOpenTask} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Slot({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={cn("border-b border-border/60", isOver && "bg-surface-2")} style={{ height: ROW }} />;
}

function DraggableTask({ task, top, height, timezone, onOpen }: { task: Tk; top: number; height: number; timezone: string; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      aria-label={`Task ${task.title}, ${formatInTimeZone(new Date(task.start), timezone, "HH:mm")}. Drag to reschedule.`}
      className={cn("absolute inset-x-1 z-10 overflow-hidden rounded-[8px] border border-foreground bg-background px-2 py-1 text-left text-[12px] leading-tight", isDragging && "z-20 opacity-80 shadow-pop", task.status === "done" && "text-muted line-through")}
      style={{ top, height, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
    >
      <span className="block truncate font-medium">{task.title}</span>
      <span className="tabular text-muted">{formatInTimeZone(new Date(task.start), timezone, "HH:mm")}</span>
    </button>
  );
}

function FocusBlock({ top, height, start, onAdded }: { top: number; height: number; start: Date; onAdded: () => void }) {
  const [pending, startT] = React.useTransition();
  return (
    <div className="absolute inset-x-1 flex flex-col justify-between rounded-[8px] border border-dashed border-border-strong px-2 py-1 text-[11px] text-muted" style={{ top, height }}>
      <span className="inline-flex items-center gap-1">
        <Lightning size={12} /> Suggested focus
      </span>
      <button
        type="button"
        disabled={pending}
        className="w-fit underline underline-offset-2 hover:text-foreground"
        onClick={() =>
          startT(async () => {
            const res = await createTaskAction({ title: "Focus time", scheduledAt: start.toISOString(), tags: ["focus"] });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Focus block added");
            onAdded();
          })
        }
      >
        Add
      </button>
    </div>
  );
}

function MonthGrid({ days, month, data, timezone, today, ymd, onOpenTask }: { days: Date[]; month: number; data?: Data; timezone: string; today: string; ymd: (d: Date) => string; onOpenTask: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-[16px] border border-border" data-lenis-prevent>
      <div className="grid min-w-[720px] grid-cols-7">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="border-b border-border px-2 py-2 text-center text-[12px] text-muted">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = ymd(d);
          const evs = (data?.events ?? []).filter((e) => (e.allDay ? e.start.slice(0, 10) : formatInTimeZone(new Date(e.start), timezone, "yyyy-MM-dd")) === key);
          const tks = (data?.tasks ?? []).filter((t) => formatInTimeZone(new Date(t.start), timezone, "yyyy-MM-dd") === key);
          return <MonthCell key={key} id={key} day={d.getDate()} muted={d.getMonth() !== month} isToday={key === today} evs={evs} tks={tks} timezone={timezone} onOpenTask={onOpenTask} />;
        })}
      </div>
    </div>
  );
}

function MonthCell({ id, day, muted, isToday, evs, tks, timezone, onOpenTask }: { id: string; day: number; muted: boolean; isToday: boolean; evs: Ev[]; tks: Tk[]; timezone: string; onOpenTask: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const items = [...evs.map((e) => ({ kind: "e" as const, id: e.id, title: e.title })), ...tks.map((t) => ({ kind: "t" as const, id: t.id, title: t.title, task: t }))];
  return (
    <div ref={setNodeRef} className={cn("min-h-[104px] border-b border-l border-border p-1.5 first:border-l-0", isOver && "bg-surface-2", muted && "bg-surface")}>
      <span className={cn("tabular inline-grid size-6 place-items-center rounded-full text-[12px]", isToday ? "bg-primary text-primary-foreground" : muted ? "text-subtle" : "")}>{day}</span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.slice(0, 3).map((it) =>
          it.kind === "e" ? (
            <li key={it.id} className="truncate rounded-[5px] bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground">
              {it.title}
            </li>
          ) : (
            <li key={it.id}>
              <MonthTask task={it.task} timezone={timezone} onOpen={onOpenTask} />
            </li>
          ),
        )}
        {items.length > 3 ? <li className="px-1 text-[11px] text-muted">+{items.length - 3} more</li> : null}
      </ul>
    </div>
  );
}

function MonthTask({ task, timezone, onOpen }: { task: Tk; timezone: string; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  return (
    <button ref={setNodeRef} type="button" {...attributes} {...listeners} onClick={() => onOpen(task.id)} className="block w-full truncate rounded-[5px] border border-foreground px-1.5 py-0.5 text-left text-[11px]" style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }} aria-label={`Task ${task.title}. Drag to another day.`}>
      <span className="tabular text-muted">{formatInTimeZone(new Date(task.start), timezone, "HH:mm")}</span> {task.title}
    </button>
  );
}
