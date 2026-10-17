"use server";

import { generateText } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { AGENT_CONNECTORS, AGENT_PROVIDERS } from "@/lib/agents/connectors";
import { runAgentTask } from "@/lib/agents/run-task";
import { keyHint } from "@/lib/ai/presets";
import { modelFor } from "@/lib/ai/providers";
import { ownerAction } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { enqueue } from "@/lib/jobs/queue";
import { errMessage } from "@/lib/log";
import { encrypt } from "@/lib/security/crypto";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Connect ChatGPT / Gemini / Claude with the user's own key (tested first, stored encrypted). */
export const connectAgent = ownerAction(
  z.object({ provider: z.enum(AGENT_PROVIDERS), apiKey: z.string().trim().min(8).max(400), model: z.string().trim().min(1).max(120).regex(/^[\w./:@-]+$/) }),
  async ({ provider, apiKey, model }, user) => {
    const info = AGENT_CONNECTORS[provider];
    try {
      await generateText({ model: modelFor({ name: "own", baseURL: info.baseURL, apiKey, fastModel: model, smartModel: model }, "fast").model, prompt: "Reply with: ok", maxRetries: 0, abortSignal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new Error(`${info.name} didn't accept that key or model: ${errMessage(err).slice(0, 160)}`);
    }
    await db()
      .insert(schema.agentConnectors)
      .values({ userId: user.id, provider, model, keyEnc: encrypt(apiKey), keyHint: keyHint(apiKey) })
      .onConflictDoUpdate({ target: [schema.agentConnectors.userId, schema.agentConnectors.provider], set: { model, keyEnc: encrypt(apiKey), keyHint: keyHint(apiKey) } });
    await logActivity({ userId: user.id, actor: "me", tool: "agents.connected", inputSummary: provider, outcome: "success" });
    revalidatePath("/agents");
  },
);

export const disconnectAgent = ownerAction(z.object({ provider: z.enum(AGENT_PROVIDERS) }), async ({ provider }, user) => {
  await db().delete(schema.agentConnectors).where(and(eq(schema.agentConnectors.userId, user.id), eq(schema.agentConnectors.provider, provider)));
  revalidatePath("/agents");
});

export const saveSprint = ownerAction(
  z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(80), goal: z.string().trim().max(400).default(""), startDate: day, endDate: day }),
  async (input, user) => {
    if (input.endDate < input.startDate) throw new Error("The sprint ends before it starts");
    if (input.id) {
      await db().update(schema.sprints).set({ name: input.name, goal: input.goal, startDate: input.startDate, endDate: input.endDate }).where(and(eq(schema.sprints.id, input.id), eq(schema.sprints.userId, user.id)));
      revalidatePath("/agents");
      return { id: input.id };
    }
    const [s] = await db().insert(schema.sprints).values({ userId: user.id, name: input.name, goal: input.goal, startDate: input.startDate, endDate: input.endDate }).returning({ id: schema.sprints.id });
    revalidatePath("/agents");
    return { id: s!.id };
  },
);

/** Start / close a sprint. Closing moves unfinished tasks back to the backlog. */
export const setSprintStatus = ownerAction(z.object({ id: uuid, status: z.enum(["planned", "active", "closed"]) }), async ({ id, status }, user) => {
  if (status === "active") await db().update(schema.sprints).set({ status: "planned" }).where(and(eq(schema.sprints.userId, user.id), eq(schema.sprints.status, "active")));
  await db().update(schema.sprints).set({ status }).where(and(eq(schema.sprints.id, id), eq(schema.sprints.userId, user.id)));
  if (status === "closed") {
    await db()
      .update(schema.tasks)
      .set({ sprintId: null })
      .where(and(eq(schema.tasks.userId, user.id), eq(schema.tasks.sprintId, id), inArray(schema.tasks.status, ["todo", "in_progress"])));
  }
  revalidatePath("/agents");
});

export const planTask = ownerAction(
  z.object({ taskId: uuid, sprintId: uuid.nullable().optional(), points: z.number().int().min(0).max(40).nullable().optional() }),
  async ({ taskId, sprintId, points }, user) => {
    if (sprintId) {
      const [s] = await db().select({ id: schema.sprints.id }).from(schema.sprints).where(and(eq(schema.sprints.id, sprintId), eq(schema.sprints.userId, user.id))).limit(1);
      if (!s) throw new Error("Sprint not found");
    }
    await db()
      .update(schema.tasks)
      .set({ ...(sprintId !== undefined ? { sprintId } : {}), ...(points !== undefined ? { points } : {}) })
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id)));
    revalidatePath("/agents");
  },
);

/**
 * Hand a task to ChatGPT / Gemini / Claude. It moves to In progress, the agent works it,
 * and the result lands in Needs review for the user's approval.
 */
export const assignToAgent = ownerAction(z.object({ taskId: uuid, provider: z.enum(AGENT_PROVIDERS) }), async ({ taskId, provider }, user) => {
  const [conn] = await db().select({ id: schema.agentConnectors.id }).from(schema.agentConnectors).where(and(eq(schema.agentConnectors.userId, user.id), eq(schema.agentConnectors.provider, provider))).limit(1);
  if (!conn) throw new Error(`Connect ${AGENT_CONNECTORS[provider].name} first`);
  const [t] = await db()
    .update(schema.tasks)
    .set({ agentProvider: provider, assignee: "agent", status: "in_progress", claimedAt: new Date() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, user.id), inArray(schema.tasks.status, ["todo", "in_progress"])))
    .returning({ id: schema.tasks.id });
  if (!t) throw new Error("Only To do or In progress tasks can be handed to an agent");
  await db().insert(schema.taskComments).values({ userId: user.id, taskId, author: "me", kind: "comment", body: `Handed to ${AGENT_CONNECTORS[provider].name}.` });
  await logActivity({ userId: user.id, actor: "me", tool: "agents.assigned", inputSummary: provider, outcome: "success" });
  // Work it right after the response; the queue retries if this request can't finish it.
  after(() => runAgentTask(user.id, taskId).catch(() => enqueue(user.id, "agent_task", { taskId }, { dedupeKey: `agent:${taskId}` })));
  revalidatePath("/agents");
});
