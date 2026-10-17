import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import type { Metadata } from "next";
import { AgentsBoard } from "@/components/agents/agents-board";
import { PageHeader } from "@/components/ui/states";
import { AGENT_CONNECTORS } from "@/lib/agents/connectors";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ sprint?: string }> }) {
  const user = await requireOwner();
  const { sprint: wanted } = await searchParams;
  const [connectors, sprints] = await Promise.all([
    db().select({ provider: schema.agentConnectors.provider, model: schema.agentConnectors.model, keyHint: schema.agentConnectors.keyHint }).from(schema.agentConnectors).where(eq(schema.agentConnectors.userId, user.id)),
    db().select().from(schema.sprints).where(eq(schema.sprints.userId, user.id)).orderBy(desc(schema.sprints.startDate)).limit(30),
  ]);
  const current = sprints.find((s) => s.id === wanted) ?? sprints.find((s) => s.status === "active") ?? sprints.find((s) => s.status === "planned") ?? sprints[0] ?? null;
  const taskCols = {
    id: schema.tasks.id,
    title: schema.tasks.title,
    status: schema.tasks.status,
    points: schema.tasks.points,
    agentProvider: schema.tasks.agentProvider,
    assignee: schema.tasks.assignee,
    dueDate: schema.tasks.dueDate,
    resultMarkdown: schema.tasks.resultMarkdown,
    sprintId: schema.tasks.sprintId,
  };
  const [sprintTasks, backlog] = await Promise.all([
    current ? db().select(taskCols).from(schema.tasks).where(and(eq(schema.tasks.userId, user.id), eq(schema.tasks.sprintId, current.id), isNull(schema.tasks.parentId))).orderBy(asc(schema.tasks.position)) : Promise.resolve([]),
    db()
      .select(taskCols)
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, user.id), isNull(schema.tasks.sprintId), isNull(schema.tasks.parentId), ne(schema.tasks.status, "done"), or(isNull(schema.tasks.externalRef), ne(schema.tasks.status, "done"))))
      .orderBy(desc(schema.tasks.priority), asc(schema.tasks.position))
      .limit(60),
  ]);
  return (
    <>
      <PageHeader title="Agents" description="Hand tasks to ChatGPT, Gemini or Claude and run your work in sprints. Agents write results; you approve them." />
      <AgentsBoard
        connectors={Object.entries(AGENT_CONNECTORS).map(([id, c]) => {
          const conn = connectors.find((x) => x.provider === id);
          return { id, name: c.name, logo: c.logo, defaultModel: c.model, keyUrl: c.keyUrl, connected: Boolean(conn), model: conn?.model ?? null, keyHint: conn?.keyHint ?? null };
        })}
        sprints={sprints.map((s) => ({ id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, status: s.status }))}
        currentId={current?.id ?? null}
        tasks={sprintTasks}
        backlog={backlog}
      />
    </>
  );
}
