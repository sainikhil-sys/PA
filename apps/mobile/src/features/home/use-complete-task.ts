import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { TaskSummary, Today } from "@/lib/types";

/**
 * Tick a task done from Home. Optimistic: the row leaves Today and turns done in the Tasks list
 * at once, and both roll back if the server refuses.
 */
export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/mobile/tasks/${id}`, { method: "PATCH", body: { done: true } }),
    onMutate: async (id) => {
      await Promise.all([qc.cancelQueries({ queryKey: keys.today }), qc.cancelQueries({ queryKey: keys.tasks })]);
      const today = qc.getQueryData<Today>(keys.today);
      const tasks = qc.getQueryData<TaskSummary[]>(keys.tasks);
      if (today) qc.setQueryData<Today>(keys.today, { ...today, tasks: today.tasks.filter((t) => t.id !== id) });
      if (tasks) qc.setQueryData<TaskSummary[]>(keys.tasks, tasks.map((t) => (t.id === id ? { ...t, status: "done" } : t)));
      return { today, tasks };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.today) qc.setQueryData(keys.today, ctx.today);
      if (ctx?.tasks) qc.setQueryData(keys.tasks, ctx.tasks);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.today });
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}
