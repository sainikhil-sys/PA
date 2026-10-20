"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { insertFocusSession } from "@/lib/db/queries/focus";

/** Save one finished or stopped focus session. The client refreshes /api/focus itself. */
export const logFocusSessionAction = ownerAction(
  z.object({
    startedAt: z.string().datetime(),
    plannedMinutes: z.number().int().min(5).max(120),
    actualMinutes: z.number().int().min(1).max(120),
    completed: z.boolean(),
    taskId: z.string().uuid().nullable().optional(),
  }),
  async (input, user) => {
    const now = new Date();
    const started = new Date(input.startedAt);
    if (started.getTime() > now.getTime() + 60_000 || started.getTime() < now.getTime() - 24 * 3_600_000) {
      throw new UserFacingError("That session looks off. Start a new one.");
    }
    // Never record more than the wall clock allows.
    const actual = Math.max(1, Math.min(input.actualMinutes, input.plannedMinutes, Math.ceil((now.getTime() - started.getTime()) / 60_000) + 1));
    let taskId: string | null = null;
    if (input.taskId) {
      const t = await db().query.tasks.findFirst({ where: and(eq(schema.tasks.id, input.taskId), eq(schema.tasks.userId, user.id)), columns: { id: true } });
      taskId = t?.id ?? null;
    }
    const row = await insertFocusSession(user.id, { taskId, startedAt: started, endedAt: now, plannedMinutes: input.plannedMinutes, actualMinutes: actual, completed: input.completed });
    return { id: row.id, actualMinutes: actual };
  },
);
