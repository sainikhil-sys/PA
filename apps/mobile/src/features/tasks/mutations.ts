import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { TaskSummary } from "@/lib/types";

/** Fields PATCH /api/mobile/tasks/{id} accepts. Send only what changed. */
export type TaskPatch = {
  done?: boolean;
  title?: string;
  description?: string;
  dueDate?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  priority?: number;
};

function refresh(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: keys.tasks });
  void qc.invalidateQueries({ queryKey: keys.today });
  if (id) void qc.invalidateQueries({ queryKey: keys.task(id) });
}

/** Tick a task done (or back to to-do). Done tasks leave the list at once and come back if the server refuses. */
export function useSetDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; done: boolean }) => api<{ ok: true }>(`/api/mobile/tasks/${v.id}`, { method: "PATCH", body: { done: v.done } }),
    onMutate: async (v) => {
      if (!v.done) return { removed: undefined };
      await qc.cancelQueries({ queryKey: keys.tasks });
      const removed = qc.getQueryData<TaskSummary[]>(keys.tasks)?.find((t) => t.id === v.id);
      qc.setQueryData<TaskSummary[]>(keys.tasks, (cur) => cur?.filter((t) => t.id !== v.id));
      return { removed };
    },
    onError: (_err, _v, ctx) => {
      const removed = ctx?.removed;
      if (removed) qc.setQueryData<TaskSummary[]>(keys.tasks, (cur) => (cur && !cur.some((t) => t.id === removed.id) ? [...cur, removed] : cur));
    },
    onSettled: (_d, _e, v) => refresh(qc, v.id),
  });
}

/** Natural-language quick add. The server parses dates, times, #tags and !priority. */
export function useQuickAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api<{ ok: true; id: string; summary: string }>("/api/mobile/tasks", { method: "POST", body: { text } }),
    onSuccess: () => refresh(qc),
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskPatch) => api<{ ok: true }>(`/api/mobile/tasks/${id}`, { method: "PATCH", body }),
    onSettled: () => refresh(qc, id),
  });
}

export function useDeleteTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/mobile/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.task(id) });
      qc.setQueryData<TaskSummary[]>(keys.tasks, (cur) => cur?.filter((t) => t.id !== id));
      refresh(qc);
    },
  });
}
