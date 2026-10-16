import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton } from "@/components/today/card-skeleton";
import type { TaskRow } from "@/components/tasks/task-bits";
import { TasksPage } from "@/components/tasks/tasks-page";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";
import { listTasks } from "@/lib/db/queries/tasks";

export const metadata: Metadata = { title: "Tasks & Schedule" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireOwner();
  const [tasks, s] = await Promise.all([listTasks(user.id, { limit: 500 }), getSettings(user.id)]);
  const initial = JSON.parse(JSON.stringify(tasks)) as TaskRow[];
  return (
    <>
      <PageHeader title="Tasks & Schedule" description="Your tasks, the agent's and Claude's, with your calendar alongside." />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <TasksPage initial={initial} timezone={s.timezone} />
      </Suspense>
    </>
  );
}
