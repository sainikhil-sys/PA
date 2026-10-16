import { describe, expect, it } from "vitest";
import { checkConditions, matchesTrigger } from "@/lib/automations/match";
import { describeCron, nextCronRun, scheduleToCron } from "@/lib/automations/schedule";
import { fillTemplate } from "@/lib/automations/template-vars";
import { TEMPLATES } from "@/lib/automations/templates";
import { automationSchema } from "@/lib/automations/validate";
import { backoffMs, shouldRetry } from "@/lib/jobs/backoff";

describe("schedules", () => {
  it("turns plain words into cron", () => {
    expect(scheduleToCron("every weekday at 9am")).toBe("0 9 * * 1-5");
    expect(scheduleToCron("every monday 9:30am")).toBe("30 9 * * 1");
    expect(scheduleToCron("every day at 7pm")).toBe("0 19 * * *");
    expect(scheduleToCron("every 2 minutes")).toBe("*/5 * * * *"); // clamped to Vercel granularity
    expect(scheduleToCron("hourly")).toBe("0 * * * *");
    expect(scheduleToCron("0 16 * * 5")).toBe("0 16 * * 5");
    expect(scheduleToCron("whenever")).toBeNull();
  });
  it("evaluates next runs in the owner's timezone", () => {
    const next = nextCronRun("0 9 * * 1-5", "Asia/Kolkata", new Date("2026-10-16T04:00:00Z")); // Fri 09:30 IST
    expect(next?.toISOString()).toBe("2026-10-19T03:30:00.000Z"); // Mon 09:00 IST
  });
  it("describes cron for humans", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Every weekday at 09:00");
  });
});

describe("triggers and conditions", () => {
  it("matches email rules", () => {
    const ev = { type: "email" as const, key: "1", from: "Anita <anita@acme.com>", subject: "Invoice due", category: "URGENT", summary: "", emailId: "e1" };
    expect(matchesTrigger({ type: "email", from: "acme.com", category: "URGENT" }, ev)).toBe(true);
    expect(matchesTrigger({ type: "email", subjectContains: "contract" }, ev)).toBe(false);
    expect(matchesTrigger({ type: "task_status", to: "done" }, ev)).toBe(false);
  });
  it("matches news keywords case-insensitively", () => {
    expect(matchesTrigger({ type: "news_topic", keywords: ["ai"] }, { type: "news_topic", key: "n", title: "New AI model", source: "X", newsId: "n" })).toBe(true);
  });
  it("checks all conditions", () => {
    expect(checkConditions([{ field: "subject", op: "contains", value: "invoice" }], { subject: "Invoice due" }).ok).toBe(true);
    expect(checkConditions([{ field: "from", op: "not_contains", value: "acme" }], { from: "anita@acme.com" }).ok).toBe(false);
  });
});

describe("builder validation", () => {
  it("accepts every template", () => {
    for (const t of TEMPLATES) {
      const r = automationSchema.safeParse({ name: t.name, trigger: t.trigger, conditions: t.conditions, actions: t.actions, permissions: t.actions.map((a) => a.type) });
      expect(r.success, t.id).toBe(true);
    }
  });
  it("has no send/post/delete action and requires https webhooks", () => {
    const bad = automationSchema.safeParse({ name: "x", trigger: { type: "webhook" }, actions: [{ type: "send_email" }], permissions: [] });
    expect(bad.success).toBe(false);
    const http = automationSchema.safeParse({ name: "x", trigger: { type: "webhook" }, actions: [{ type: "call_webhook", url: "http://example.com" }], permissions: ["call_webhook"] });
    expect(http.success).toBe(false);
  });
  it("parses natural-language schedules during validation", () => {
    const r = automationSchema.parse({ name: "x", trigger: { type: "schedule", text: "every friday at 4pm" }, actions: [{ type: "notify", title: "hi" }], permissions: ["notify"] });
    expect(r.trigger).toMatchObject({ type: "schedule", cron: "0 16 * * 5" });
  });
});

describe("templating and retries", () => {
  it("fills placeholders as truncated plain text", () => {
    expect(fillTemplate("Follow up: {{title}} ({{missing}})", { title: "Q4 sync" })).toBe("Follow up: Q4 sync ()");
  });
  it("backs off exponentially with a cap", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
    expect(shouldRetry(2, 3)).toBe(true);
    expect(shouldRetry(3, 3)).toBe(false);
  });
});
