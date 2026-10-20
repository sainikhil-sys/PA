import { apiGuard } from "@/lib/auth/api";
import { listFocusSessions } from "@/lib/db/queries/focus";
import { getSettings } from "@/lib/db/queries/settings";
import { bucketFocusDays } from "@/lib/focus/stats";
import { localDayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Focus history: today's total, the last 7 days and recent sessions. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const uid = g.user.id;
  const { timezone } = await getSettings(uid);
  const since = localDayBounds(timezone, -6).start;
  const rows = await listFocusSessions(uid, since);
  const days = bucketFocusDays(rows, timezone);
  const today = days.at(-1)!;
  return Response.json(
    {
      today: { minutes: today.minutes, sessions: today.sessions },
      days,
      recent: rows.slice(0, 30).map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt.toISOString(),
        plannedMinutes: r.plannedMinutes,
        actualMinutes: r.actualMinutes,
        completed: r.completed,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
