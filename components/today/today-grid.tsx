"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowCounterClockwise, DotsSixVertical } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { saveTodayLayout } from "@/app/actions/room";
import { cn } from "@/lib/utils";

export type TodayItem = { id: string; label: string; className: string; node: React.ReactNode };

/** Apply a saved order; unknown ids are ignored and new cards keep their default place. */
function ordered(items: TodayItem[], order: string[]): TodayItem[] {
  if (!order.length) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? 1000 + items.indexOf(a)) - (rank.get(b.id) ?? 1000 + items.indexOf(b)));
}

/** Today cards you can rearrange by dragging the handle (mouse, touch or keyboard). The order is saved. */
export function TodayGrid({ items, initialOrder }: { items: TodayItem[]; initialOrder: string[] }) {
  const [order, setOrder] = React.useState(() => ordered(items, initialOrder).map((i) => i.id));
  const byId = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = (next: string[]) => {
    setOrder(next);
    void saveTodayLayout({ order: next }).then((r) => !r.ok && toast.error("Couldn't save your layout"));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    persist(arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id))));
  };
  const custom = order.join() !== items.map((i) => i.id).join();

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-12">
            {order.map((id) => {
              const it = byId.get(id);
              return it ? <SortableCard key={id} item={it} /> : null;
            })}
          </div>
        </SortableContext>
      </DndContext>
      {custom ? (
        <button type="button" onClick={() => persist(items.map((i) => i.id))} className="inline-flex w-fit items-center gap-1.5 self-end rounded-full px-2.5 py-1 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground">
          <ArrowCounterClockwise size={13} /> Reset layout
        </button>
      ) : null}
    </div>
  );
}

function SortableCard({ item }: { item: TodayItem }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group/drag relative min-w-0", item.className, isDragging && "z-20 opacity-90 [&_.card]:shadow-[var(--shadow-pop)] [&_.card]:ring-2 [&_.card]:ring-foreground/15")}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Move ${item.label}`}
        className="absolute right-2 top-2 z-10 grid size-7 cursor-grab touch-none place-items-center rounded-[8px] text-subtle opacity-60 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing group-hover/drag:opacity-100 sm:opacity-0"
        {...attributes}
        {...listeners}
      >
        <DotsSixVertical size={16} weight="bold" />
      </button>
      {item.node}
    </div>
  );
}
