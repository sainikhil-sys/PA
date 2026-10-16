import { z } from "zod";

/**
 * The agent never calls tools freely. A small planner (FAST model, structured
 * output) decides which READ-ONLY sources to consult and which ACTIONS to
 * PROPOSE. Proposals become confirmation cards; nothing executes without a click.
 */

export const SOURCES = ["gmail", "calendar", "tasks", "knowledge", "news", "briefing"] as const;
export type SourceId = (typeof SOURCES)[number];

export const ACTION_KINDS = ["create_task", "create_draft", "schedule_task", "run_automation", "create_linkedin_draft", "add_note"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

const action = z.object({
  kind: z.enum(ACTION_KINDS),
  title: z.string().max(200).optional(),
  when: z.string().max(100).optional(),
  details: z.string().max(1000).optional(),
  email_hint: z.string().max(200).optional(),
  automation_name: z.string().max(100).optional(),
});
export type PlannedAction = z.infer<typeof action>;

export const planSchema = z.object({
  sources: z.array(z.enum(SOURCES)).max(6).default([]),
  search_query: z.string().max(300).default(""),
  actions: z.array(action).max(3).default([]),
});
export type Plan = z.infer<typeof planSchema>;

export const PLAN_PROMPT = (message: string, hasAttachment: boolean) => `Decide how to answer the owner's message. Return ONLY JSON:
{"sources": [subset of "gmail","calendar","tasks","knowledge","news","briefing"], "search_query": "keywords for the knowledge base", "actions": [{"kind": "create_task|create_draft|schedule_task|run_automation|create_linkedin_draft|add_note", "title": "...", "when": "natural language time", "details": "...", "email_hint": "sender or subject", "automation_name": "..."}]}

Rules:
- Pick only the sources needed. "what did I miss" -> gmail, calendar, tasks. Questions about documents/notes -> knowledge.
- Add an action ONLY if the owner clearly asks you to do something (add, create, draft, schedule, remind, run, save). Otherwise "actions": [].
- Never propose sending, posting, deleting or paying.
${hasAttachment ? "- The owner attached a document; it is included separately." : ""}

Examples:
"what's my day" -> {"sources":["calendar","tasks","gmail"],"search_query":"","actions":[]}
"add a task to call Ravi tomorrow at 5" -> {"sources":[],"search_query":"","actions":[{"kind":"create_task","title":"Call Ravi","when":"tomorrow at 5"}]}
"draft a reply to the last email from Anita" -> {"sources":["gmail"],"search_query":"","actions":[{"kind":"create_draft","email_hint":"Anita"}]}
"draft a post about remote work from my notes" -> {"sources":["knowledge"],"search_query":"remote work","actions":[{"kind":"create_linkedin_draft","title":"Remote work","details":"Use my notes"}]}

Message: """${message.slice(0, 2000)}"""`;

/** Deterministic fallback when the planner model is unavailable or invalid. */
export function heuristicPlan(message: string): Plan {
  const m = message.toLowerCase();
  const sources = new Set<SourceId>();
  if (/\b(email|emails|inbox|mail|reply|replies|sender|from)\b/.test(m)) sources.add("gmail");
  if (/\b(meeting|meetings|calendar|schedule|agenda|today|tomorrow|day|week)\b/.test(m)) sources.add("calendar");
  if (/\b(task|tasks|todo|to-do|overdue|priorit)/.test(m)) sources.add("tasks");
  if (/\b(news|headline|world|happening)\b/.test(m)) sources.add("news");
  if (/\b(briefing|summary|miss|missed)\b/.test(m)) {
    sources.add("gmail");
    sources.add("calendar");
    sources.add("tasks");
  }
  if (/\b(note|notes|doc|docs|document|knowledge|drive|notion|wiki|file|according)\b/.test(m) || sources.size === 0) sources.add("knowledge");

  const actions: PlannedAction[] = [];
  const task = /\b(?:add|create|make)\s+(?:a\s+)?(?:task|todo|reminder)\s+(?:to\s+)?(.+)$|\bremind me to\s+(.+)$/i.exec(message);
  if (task) actions.push({ kind: "create_task", title: (task[1] ?? task[2] ?? "").trim().slice(0, 200) });
  const draft = /\bdraft (?:a )?(?:reply|response) to (?:the )?(?:last )?(?:email )?(?:from )?(.+)$/i.exec(message);
  if (draft) {
    actions.push({ kind: "create_draft", email_hint: draft[1]!.trim().slice(0, 200) });
    sources.add("gmail");
  }
  const post = /\b(?:draft|write) (?:a )?(?:linkedin )?post about (.+)$/i.exec(message);
  if (post) actions.push({ kind: "create_linkedin_draft", title: post[1]!.trim().slice(0, 200) });
  const auto = /\brun (?:my )?(.+?) automation\b/i.exec(message);
  if (auto) actions.push({ kind: "run_automation", automation_name: auto[1]!.trim() });
  const note = /\b(?:save|add) (?:a )?note[:\s]+(.+)$/i.exec(message);
  if (note) actions.push({ kind: "add_note", title: note[1]!.trim().slice(0, 80), details: note[1]!.trim() });
  return { sources: [...sources], search_query: message.slice(0, 200), actions: actions.slice(0, 3) };
}

/** Owner capability switches (Settings > Agent) always win over the planner. */
export function applyCapabilities(plan: Plan, caps: { readEmail: boolean; createDrafts: boolean; manageTasks: boolean; runAutomations: boolean; searchKnowledge: boolean }): Plan {
  return {
    ...plan,
    sources: plan.sources.filter((s) => (s === "gmail" ? caps.readEmail : s === "knowledge" ? caps.searchKnowledge : true)),
    actions: plan.actions.filter((a) =>
      a.kind === "create_draft" ? caps.createDrafts && caps.readEmail : a.kind === "run_automation" ? caps.runAutomations : a.kind === "create_task" || a.kind === "schedule_task" ? caps.manageTasks : true,
    ),
  };
}
