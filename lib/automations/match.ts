import type { AutomationCondition, AutomationTrigger } from "@/lib/db/schema";

/** Pure trigger/condition matching (unit tested). */

export type AutomationEvent =
  | { type: "email"; key: string; from: string; subject: string; category: string; summary: string; emailId: string }
  | { type: "calendar_event"; key: string; title: string; start: string; eventId: string }
  | { type: "task_status"; key: string; taskId: string; to: string }
  | { type: "knowledge_item"; key: string; sourceType: string; title: string; itemId: string }
  | { type: "webhook"; key: string; payloadSummary: string }
  | { type: "news_topic"; key: string; title: string; source: string; newsId: string }
  | { type: "schedule"; key: string; at: string }
  | { type: "manual"; key: string };

const has = (hay: string | undefined, needle: string | undefined) => !needle || (hay ?? "").toLowerCase().includes(needle.toLowerCase());

export function matchesTrigger(trigger: AutomationTrigger, event: AutomationEvent): boolean {
  if (event.type === "manual") return true;
  if (trigger.type !== event.type) return false;
  switch (trigger.type) {
    case "email": {
      const e = event as Extract<AutomationEvent, { type: "email" }>;
      return has(e.from, trigger.from) && has(e.subject, trigger.subjectContains) && (!trigger.category || e.category === trigger.category);
    }
    case "calendar_event":
      return has((event as Extract<AutomationEvent, { type: "calendar_event" }>).title, trigger.titleContains);
    case "task_status":
      return (event as Extract<AutomationEvent, { type: "task_status" }>).to === trigger.to;
    case "knowledge_item":
      return !trigger.sourceType || (event as Extract<AutomationEvent, { type: "knowledge_item" }>).sourceType === trigger.sourceType;
    case "news_topic": {
      const t = (event as Extract<AutomationEvent, { type: "news_topic" }>).title.toLowerCase();
      return trigger.keywords.some((k) => k && t.includes(k.toLowerCase()));
    }
    default:
      return true;
  }
}

/** Conditions read flat string fields from the event payload. All must pass. */
export function checkConditions(conditions: AutomationCondition[], event: Record<string, unknown>): { ok: boolean; failed?: AutomationCondition } {
  for (const c of conditions) {
    const value = String(event[c.field] ?? "").toLowerCase();
    const target = c.value.toLowerCase();
    const pass = c.op === "equals" ? value === target : c.op === "contains" ? value.includes(target) : !value.includes(target);
    if (!pass) return { ok: false, failed: c };
  }
  return { ok: true };
}
