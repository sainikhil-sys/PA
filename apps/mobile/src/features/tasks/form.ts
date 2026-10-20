import { z } from "zod";
import type { TaskDetail } from "@/lib/types";
import type { TaskPatch } from "./mutations";

export const DURATIONS = [15, 30, 45, 60, 90] as const;

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(200, "Keep the title under 200 characters"),
  description: z.string().max(10_000, "The notes are too long"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  scheduledAt: z.string().nullable(),
  durationMinutes: z.number().int().min(5).max(600).nullable(),
  priority: z.number().int().min(0).max(3),
});

export type TaskForm = z.infer<typeof taskSchema>;

/** Form values from the server's task. */
export function toForm(t: TaskDetail): TaskForm {
  return {
    title: t.title,
    description: t.description ?? "",
    dueDate: t.dueDate ?? null,
    scheduledAt: t.scheduledAt ? new Date(t.scheduledAt).toISOString() : null,
    durationMinutes: t.durationMinutes ?? null,
    priority: t.priority ?? 0,
  };
}

/** Only the fields that differ from what the server has, in the shape PATCH expects. */
export function diff(before: TaskForm, after: TaskForm): TaskPatch {
  const out: TaskPatch = {};
  const title = after.title.trim();
  if (title !== before.title) out.title = title;
  if (after.description !== before.description) out.description = after.description;
  if (after.dueDate !== before.dueDate) out.dueDate = after.dueDate;
  if (after.scheduledAt !== before.scheduledAt) out.scheduledAt = after.scheduledAt;
  if (after.durationMinutes !== before.durationMinutes) out.durationMinutes = after.durationMinutes;
  if (after.priority !== before.priority) out.priority = after.priority;
  return out;
}
