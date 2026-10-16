"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarBlank } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { moveTaskAction } from "@/app/actions/tasks";
import { STATUS_LABEL, STATUSES } from "@/lib/tasks/transitions";
import { cn } from "@/lib/utils";
import { AssigneeBadge, PriorityMark, RecurringMark, type TaskRow } from "./task-bits";

type Status = TaskRow["status"];

/**
 * Kanban with drag and drop (pointer + keyboard: focus a card, Space to lift,
 * arrows to move, Space to drop). Optimistic, reverted on error.
 */
export function TaskBoard({ tasks, onOpen, onChanged }: { tasks: TaskRow[]; onOpen: (id: string) => void; onChanged: () => void }) {
  const [items, setItems] = React.useState(tasks);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  React.useEffect(() => setItems(tasks), [tasks]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const byStatus = (s: Status) => items.filter((t) => t.status === s && !t.parentId).sort((a, b) => a.position - b.position);
  const active = items.find((t) => t.id === activeId) ?? null;

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active: a, over } = e;
    if (!over) return;
    const task = items.find((t) => t.id === a.id);
    if (!task) return;
    const overTask = items.find((t) => t.id === over.id);
    const to = (overTask?.status ?? (over.id as Status)) as Status;
    if (!STATUSES.includes(to)) return;
    const col = byStatus(to).filter((t) => t.id !== task.id);
    const idx = overTask ? col.findIndex((t) => t.id === overTask.id) : col.length;
    const before = col[idx - 1]?.position ?? (col[0] ? col[0].position - 1024 : 1024);
    const after = col[idx]?.position ?? before + 2048;
    const position = idx >= col.length ? (col.at(-1)?.position ?? 0) + 1024 : (before + after) / 2;
    if (task.status === to && Math.abs(task.position - position) < 0.0001) return;

    const prev = items;
    setItems((list) => list.map((t) => (t.id === task.id ? { ...t, status: to, position } : t)));
    const res = await moveTaskAction({ id: task.id, status: to, position });
    if (!res.ok) {
      setItems(prev);
      toast.error(res.error);
    } else {
      onChanged();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active: a }) => `Picked up ${items.find((t) => t.id === a.id)?.title ?? "task"}.`,
          onDragOver: ({ over }) => (over ? `Over ${STATUS_LABEL[(items.find((t) => t.id === over.id)?.status ?? over.id) as Status] ?? "column"}.` : "Not over a column."),
          onDragEnd: ({ over }) => (over ? `Dropped in ${STATUS_LABEL[(items.find((t) => t.id === over.id)?.status ?? over.id) as Status] ?? "column"}.` : "Drop cancelled."),
          onDragCancel: () => "Drag cancelled.",
        },
      }}
    >
      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible" data-lenis-prevent>
        {STATUSES.map((s) => (
          <Column key={s} status={s} tasks={byStatus(s)} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>{active ? <CardBody task={active} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, tasks, onOpen }: { status: Status; tasks: TaskRow[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={STATUS_LABEL[status]} className="w-[280px] shrink-0 snap-start lg:w-auto">
      <header className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-medium">{STATUS_LABEL[status]}</h2>
        <span className="tabular text-[12px] text-muted">{tasks.length}</span>
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-[200px] flex-col gap-2 rounded-[14px] border border-dashed p-2 transition-colors", isOver ? "border-foreground bg-surface" : "border-transparent bg-surface")}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} onOpen={onOpen} />
          ))}
        </SortableContext>
        {tasks.length === 0 ? <p className="px-2 py-6 text-center text-[12px] text-subtle">Drop tasks here</p> : null}
      </div>
    </section>
  );
}

function SortableCard({ task, onOpen }: { task: TaskRow; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen(task.id);
      }}
      onClick={() => onOpen(task.id)}
    >
      <CardBody task={task} />
    </div>
  );
}

function CardBody({ task, lifted }: { task: TaskRow; lifted?: boolean }) {
  return (
    <article className={cn("cursor-grab rounded-[12px] border border-border bg-background p-3 transition-[border-color] hover:border-border-strong active:cursor-grabbing", lifted && "rotate-[1deg] border-border-strong shadow-pop")}>
      <p className="text-sm leading-snug">{task.title}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {task.assignee !== "me" || task.status === "needs_review" ? <AssigneeBadge assignee={task.assignee} status={task.status} /> : null}
        <PriorityMark priority={task.priority} />
        {task.recurrence ? <RecurringMark /> : null}
        {task.dueDate ? (
          <span className="tabular inline-flex items-center gap-1 text-[11px] text-muted">
            <CalendarBlank size={12} /> {task.dueDate.slice(5)}
          </span>
        ) : null}
        {task.tags.slice(0, 2).map((t) => (
          <span key={t} className="text-[11px] text-subtle">
            #{t}
          </span>
        ))}
      </div>
    </article>
  );
}
