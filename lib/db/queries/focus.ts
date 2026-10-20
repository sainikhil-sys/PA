import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** One row per finished or stopped focus session (no open rows). */
export async function insertFocusSession(
  userId: string,
  v: { taskId: string | null; startedAt: Date; endedAt: Date; plannedMinutes: number; actualMinutes: number; completed: boolean },
) {
  const [row] = await db()
    .insert(schema.focusSessions)
    .values({ userId, ...v })
    .returning();
  return row!;
}

export async function listFocusSessions(userId: string, since: Date, limit = 500) {
  return db()
    .select({
      id: schema.focusSessions.id,
      startedAt: schema.focusSessions.startedAt,
      endedAt: schema.focusSessions.endedAt,
      plannedMinutes: schema.focusSessions.plannedMinutes,
      actualMinutes: schema.focusSessions.actualMinutes,
      completed: schema.focusSessions.completed,
      taskId: schema.focusSessions.taskId,
      taskTitle: schema.tasks.title,
    })
    .from(schema.focusSessions)
    .leftJoin(schema.tasks, eq(schema.tasks.id, schema.focusSessions.taskId))
    .where(and(eq(schema.focusSessions.userId, userId), gte(schema.focusSessions.startedAt, since)))
    .orderBy(desc(schema.focusSessions.startedAt))
    .limit(Math.min(limit, 1000));
}

/** Total focused minutes on one task (shown in the task drawer). */
export async function focusMinutesForTask(userId: string, taskId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`coalesce(sum(${schema.focusSessions.actualMinutes}), 0)::int` })
    .from(schema.focusSessions)
    .where(and(eq(schema.focusSessions.userId, userId), eq(schema.focusSessions.taskId, taskId)));
  return row?.n ?? 0;
}
