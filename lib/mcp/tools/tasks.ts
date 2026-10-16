import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { claimTask, completeTask, createTask, getTask, listTasks, TaskError } from "@/lib/db/queries/tasks";
import type { Task } from "@/lib/db/schema";
import { truncate } from "@/lib/security/sanitize";
import { STATUS_LABEL } from "@/lib/tasks/transitions";
import { registerTool } from "./define";

const statusEnum = z.enum(["todo", "in_progress", "needs_review", "done"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function brief(t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    status_label: STATUS_LABEL[t.status],
    assignee: t.assignee,
    due_date: t.dueDate,
    created_by: t.createdBy,
    updated_at: t.updatedAt.toISOString(),
  };
}

export function registerTaskTools(server: McpServer) {
  registerTool(server, {
    name: "list_tasks",
    title: "List tasks",
    description: "List the owner's tasks, optionally filtered by status. Returns id, title, status, assignee and due date.",
    scope: "tasks:read",
    readOnly: true,
    input: z.object({
      status: statusEnum.optional().describe("todo | in_progress | needs_review | done"),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    summarize: (a) => `status=${a.status ?? "any"} limit=${a.limit}`,
    run: async (a, ctx) => (await listTasks(ctx.userId, { status: a.status ? [a.status] : undefined, limit: a.limit })).map(brief),
  });

  registerTool(server, {
    name: "get_task",
    title: "Get task",
    description:
      "Get one task with its description, latest result, and comment history. If the owner requested changes, their feedback appears as a comment with kind 'change_request'.",
    scope: "tasks:read",
    readOnly: true,
    input: z.object({ id: z.string().uuid() }),
    summarize: (a) => `id=${a.id}`,
    run: async (a, ctx) => {
      const t = await getTask(ctx.userId, a.id);
      if (!t) throw new TaskError("Task not found", "not_found");
      return {
        ...brief(t),
        description: t.description,
        result_markdown: t.resultMarkdown,
        artifacts: t.artifacts ?? [],
        comments: t.comments.map((c) => ({ author: c.author, kind: c.kind, body: c.body, at: c.createdAt.toISOString() })),
      };
    },
  });

  registerTool(server, {
    name: "create_task",
    title: "Create task",
    description: "Create a new task (assigned to Claude, in To do).",
    scope: "tasks:write",
    readOnly: false,
    input: z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(10_000).default(""),
      due_date: isoDate.optional(),
    }),
    summarize: (a) => `title="${truncate(a.title, 60)}"`,
    run: async (a, ctx) => brief(await createTask(ctx.userId, { title: a.title, description: a.description, dueDate: a.due_date, createdBy: "claude", assignee: "claude" })),
  });

  registerTool(server, {
    name: "claim_task",
    title: "Claim task",
    description: "Claim a To do task so it shows as 'In progress by Claude' in the dashboard. Call this before working on a task.",
    scope: "tasks:write",
    readOnly: false,
    input: z.object({ id: z.string().uuid() }),
    summarize: (a) => `id=${a.id}`,
    run: async (a, ctx) => brief(await claimTask(ctx.userId, a.id, "claude", ctx.tokenId)),
  });

  registerTool(server, {
    name: "complete_task",
    title: "Complete task",
    description:
      "Submit the result of a claimed task as Markdown. The task moves to 'Needs review'; the owner approves it or requests changes. You cannot mark tasks Done.",
    scope: "tasks:write",
    readOnly: false,
    input: z.object({
      id: z.string().uuid(),
      result_markdown: z.string().min(1).max(100_000),
      artifacts: z
        .array(
          z.object({
            title: z.string().min(1).max(200),
            url: z.string().url().refine((u) => /^https?:/i.test(u), "http(s) only").optional(),
            content: z.string().max(50_000).optional(),
          }),
        )
        .max(20)
        .optional(),
    }),
    summarize: (a) => `id=${a.id} result=${a.result_markdown.length} chars artifacts=${a.artifacts?.length ?? 0}`,
    run: async (a, ctx) => brief(await completeTask(ctx.userId, a.id, "claude", { markdown: a.result_markdown, artifacts: a.artifacts })),
  });
}
