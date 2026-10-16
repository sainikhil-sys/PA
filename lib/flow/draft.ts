import type { AutomationAction, AutomationTrigger } from "@/lib/db/schema";
import type { DraftPlan, NodeId } from "./model";

/** Turn an unsaved automation plan into dashed "draft" links for the Live Link panel (pure). */
export function automationDraft(name: string, trigger: AutomationTrigger, actions: AutomationAction[]): DraftPlan {
  const edges: [NodeId, NodeId][] = [["input:automation", "agent"]];
  if (trigger.type === "email") edges.push(["agent", "gmail"]);
  if (trigger.type === "calendar_event") edges.push(["agent", "calendar"]);
  if (trigger.type === "knowledge_item") edges.push(["agent", "knowledge"]);
  if (trigger.type === "news_topic") edges.push(["agent", "news"]);
  const add = (...e: [NodeId, NodeId][]) => edges.push(...e);
  for (const a of actions) {
    switch (a.type) {
      case "call_agent":
        add(["agent", "model:fast"], ["agent", "model:smart"], ["agent", "knowledge"]);
        break;
      case "generate_briefing":
        add(["agent", "gmail"], ["agent", "calendar"], ["agent", "tasks"], ["agent", "model:smart"]);
        break;
      case "create_task":
        add(["agent", "output:tasks"]);
        break;
      case "create_draft":
        add(["agent", "gmail"], ["agent", "model:smart"], ["agent", "output:draft"]);
        break;
      case "create_linkedin_draft":
        add(["agent", "knowledge"], ["agent", "model:smart"], ["agent", "output:content"]);
        break;
      case "add_note":
        add(["agent", "output:notes"]);
        break;
      case "notify":
      case "call_webhook":
        add(["agent", "output:notify"]);
        break;
    }
  }
  const seen = new Set<string>();
  return { label: name || "Untitled automation", edges: edges.filter(([f, t]) => (seen.has(`${f}>${t}`) ? false : (seen.add(`${f}>${t}`), true))) };
}
