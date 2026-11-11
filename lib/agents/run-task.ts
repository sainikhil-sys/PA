import "server-only";
import { generateText } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { modelFor } from "@/lib/ai/providers";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { notify } from "@/lib/db/queries/notifications";
import { completeTask } from "@/lib/db/queries/tasks";
import { decrypt } from "@/lib/security/crypto";
import { Trace } from "@/lib/trace";
import { AGENT_CONNECTORS, isAgentProvider } from "./connectors";

const SYSTEM = `You are an AI agent working a task from the user's sprint board in Cowork.
Produce the deliverable itself (a plan, draft, analysis, code, checklist), in Markdown.
You cannot browse, send messages or take actions outside this answer; if something needs the user to act, list it under "Next steps for you".
Be concise and concrete. Start with a one-line summary.`;

/**
 * Hand a task to the user's connected ChatGPT / Gemini / Claude. The result is posted on the
 * task and the task moves to Needs review: nothing is "done" until the user approves it.
 */
export async function runAgentTask(userId: string, taskId: string): Promise<void> {
  const [task] = await db().select().from(schema.tasks).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId))).limit(1);
  if (!task || !isAgentProvider(task.agentProvider) || task.status !== "in_progress") return;
  const provider = task.agentProvider;
  const [conn] = await db().select().from(schema.agentConnectors).where(and(eq(schema.agentConnectors.userId, userId), eq(schema.agentConnectors.provider, provider))).limit(1);
  const info = AGENT_CONNECTORS[provider];
  if (!conn) {
    await db().insert(schema.taskComments).values({ userId, taskId, author: "system", kind: "comment", body: `${info.name} isn't connected. Connect it on the Agents page and start the task again.` });
    await db().update(schema.tasks).set({ status: "todo", agentProvider: null }).where(eq(schema.tasks.id, taskId));
    return;
  }
  const comments = await db().select().from(schema.taskComments).where(eq(schema.taskComments.taskId, taskId)).orderBy(asc(schema.taskComments.createdAt)).limit(20);
  const prompt = [
    `Task: ${task.title}`,
    task.description ? `Details:\n${task.description}` : "",
    task.dueDate ? `Due: ${task.dueDate}` : "",
    comments.length ? `Conversation so far:\n${comments.map((c) => `- ${c.author}: ${c.body}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const trace = new Trace(userId, "job", `agent:${provider}`);
  const config = { name: "own", baseURL: info.baseURL, apiKey: decrypt(conn.keyEnc), fastModel: conn.model, smartModel: conn.model };
  const started = Date.now();
  try {
    const { text, usage } = await trace.span(`agent:${provider}`, `${info.name}: ${task.title.slice(0, 60)}`, () =>
      generateText({ model: modelFor(config, "smart").model, system: SYSTEM, prompt, maxRetries: 1, abortSignal: AbortSignal.timeout(120_000) }),
    );
    await db()
      .insert(schema.aiRuns)
      .values({ userId, taskKind: `agent.${provider}`, provider: "own", model: conn.model, ok: true, attempts: 1, durationMs: Date.now() - started, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, keySource: "own" })
      .catch(() => {});
    await completeTask(userId, taskId, "agent", { markdown: text.slice(0, 20_000) });
    await logActivity({ userId, actor: "agent", tool: `agents.${provider}.completed`, inputSummary: task.title.slice(0, 80), outcome: "success" });
    await notify(userId, { kind: "automation", title: `${info.name} finished: ${task.title}`.slice(0, 200), body: "Review the result and approve or request changes.", href: `/tasks?task=${taskId}`, dedupeKey: `agent:${taskId}:${Date.now()}` });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "unknown error";
    await db()
      .insert(schema.aiRuns)
      .values({ userId, taskKind: `agent.${provider}`, provider: "own", model: conn.model, ok: false, attempts: 1, durationMs: Date.now() - started, errorCode: "error", keySource: "own" })
      .catch(() => {});
    await db().insert(schema.taskComments).values({ userId, taskId, author: "system", kind: "comment", body: `${info.name} couldn't finish: ${message}` });
    await db().update(schema.tasks).set({ status: "todo" }).where(eq(schema.tasks.id, taskId));
    await logActivity({ userId, actor: "agent", tool: `agents.${provider}.failed`, inputSummary: task.title.slice(0, 80), outcome: "error", detail: message });
  }
}
