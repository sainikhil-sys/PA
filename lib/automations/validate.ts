import { z } from "zod";
import { isValidCron, scheduleToCron } from "./schedule";

/** zod schemas for the builder. Note: no action can send, post, pay or delete. */
const text = (max: number) => z.string().trim().max(max);

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), text: text(100).optional(), cron: text(100).optional() }).transform((t, ctx) => {
    const cron = t.cron && isValidCron(t.cron) ? t.cron : scheduleToCron(t.text ?? "");
    if (!cron) {
      ctx.addIssue({ code: "custom", message: "I couldn't understand that schedule. Try “every weekday at 9am”." });
      return z.NEVER;
    }
    return { type: "schedule" as const, cron, text: t.text };
  }),
  z.object({ type: z.literal("email"), from: text(200).optional(), subjectContains: text(200).optional(), category: z.enum(["URGENT", "REPLY_NEEDED", "FYI", "NEWSLETTER", "SPAM"]).optional() }),
  z.object({ type: z.literal("calendar_event"), titleContains: text(200).optional() }),
  z.object({ type: z.literal("task_status"), to: z.enum(["todo", "in_progress", "needs_review", "done"]) }),
  z.object({ type: z.literal("knowledge_item"), sourceType: text(40).optional() }),
  z.object({ type: z.literal("webhook") }),
  z.object({ type: z.literal("news_topic"), keywords: z.array(text(60)).min(1).max(10) }),
]);

export const conditionSchema = z.object({ field: z.enum(["from", "subject", "category", "summary", "title", "to", "source", "sourceType"]), op: z.enum(["contains", "equals", "not_contains"]), value: text(200).min(1) });

const httpsUrl = z.string().url().refine((u) => u.startsWith("https://"), "Webhooks must use https");

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_task"), title: text(200).min(1), description: text(2000).optional() }),
  z.object({ type: z.literal("create_draft"), instructions: text(500).optional() }),
  z.object({ type: z.literal("generate_briefing") }),
  z.object({ type: z.literal("create_linkedin_draft"), prompt: text(500).optional() }),
  z.object({ type: z.literal("add_note"), title: text(200).min(1), content: text(4000).optional() }),
  z.object({ type: z.literal("notify"), title: text(200).min(1), body: text(1000).optional() }),
  z.object({ type: z.literal("call_agent"), prompt: text(1000).min(1) }),
  z.object({ type: z.literal("call_webhook"), url: httpsUrl }),
  z.object({ type: z.literal("write_email"), to: text(320).min(3, "Who is it to?"), subject: text(150).optional(), instructions: text(1000).min(3, "What should it say?") }),
  z.object({ type: z.literal("create_youtube_package"), topic: text(300).min(3, "Give it a topic") }),
]);

export const automationSchema = z.object({
  id: z.string().uuid().optional(),
  name: text(80).min(1, "Give it a name"),
  description: text(300).default(""),
  template: text(40).optional(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(5).default([]),
  actions: z.array(actionSchema).min(1, "Add at least one action").max(6),
  permissions: z.array(z.enum(["create_task", "create_draft", "generate_briefing", "create_linkedin_draft", "add_note", "notify", "call_agent", "call_webhook", "write_email", "create_youtube_package"])).max(10),
  timeoutMs: z.number().int().min(5_000).max(240_000).default(60_000),
  enabled: z.boolean().default(true),
});
export type AutomationInput = z.input<typeof automationSchema>;
