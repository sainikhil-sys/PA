import { z } from "zod";
import { heuristicMemories, MEMORY_KINDS } from "./memory-rank";

/**
 * The agent never calls tools freely. A small planner (FAST model, structured
 * output) decides which READ-ONLY sources to consult and which ACTIONS to
 * PROPOSE. Proposals become confirmation cards; nothing executes without a click.
 */

/** "web" is honoured only in chat (gatherContext allowWeb); automations never search the web. */
export const SOURCES = ["gmail", "calendar", "tasks", "knowledge", "news", "briefing", "web"] as const;
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

const memoryItem = z.object({
  content: z.string().trim().min(3).max(300),
  kind: z.enum(MEMORY_KINDS).default("preference"),
});

export const planSchema = z.object({
  sources: z.array(z.enum(SOURCES)).max(7).default([]),
  search_query: z.string().max(300).default(""),
  actions: z.array(action).max(3).default([]),
  /**
   * Lasting facts or preferences the owner stated about themselves. Acted on ONLY
   * by chat (the planner sees only the owner's own words); automations ignore it.
   */
  remember: z.array(memoryItem).max(3).default([]),
});
export type Plan = z.infer<typeof planSchema>;

export const PLAN_PROMPT = (message: string, hasAttachment: boolean) => `Decide how to answer the owner's message. Return ONLY JSON:
{"sources": [subset of "gmail","calendar","tasks","knowledge","news","briefing","web"], "search_query": "keywords for the knowledge base or the web", "actions": [{"kind": "create_task|create_draft|schedule_task|run_automation|create_linkedin_draft|add_note", "title": "...", "when": "natural language time", "details": "...", "email_hint": "sender or subject", "automation_name": "..."}], "remember": [{"content": "short first-person statement", "kind": "preference|fact|person|project"}]}

Rules:
- Pick only the sources needed. "what did I miss" -> gmail, calendar, tasks. Questions about documents/notes/bookmarks/saved links -> knowledge.
- "web" only when the answer needs current or online information (recent events, releases, prices, opening hours) or the owner asks to search, look up or research online. Put a short web search query in "search_query".
- Add an action ONLY if the owner clearly asks you to do something (add, create, draft, schedule, remind, run, save). Otherwise "actions": [].
- Never propose sending, posting, deleting or paying.
- "remember" ONLY when the owner states a lasting preference or fact about themselves or explicitly asks you to remember something ("remember that...", "I prefer...", "from now on..."). Write each as a short first-person statement in their words. "remember to <do something>" is a task, not a memory. Never include passwords, codes or account numbers. Otherwise "remember": [].
${hasAttachment ? "- The owner attached a document; it is included separately." : ""}

Examples:
"what's my day" -> {"sources":["calendar","tasks","gmail"],"search_query":"","actions":[],"remember":[]}
"add a task to call Ravi tomorrow at 5" -> {"sources":[],"search_query":"","actions":[{"kind":"create_task","title":"Call Ravi","when":"tomorrow at 5"}],"remember":[]}
"draft a reply to the last email from Anita" -> {"sources":["gmail"],"search_query":"","actions":[{"kind":"create_draft","email_hint":"Anita"}],"remember":[]}
"draft a post about remote work from my notes" -> {"sources":["knowledge"],"search_query":"remote work","actions":[{"kind":"create_linkedin_draft","title":"Remote work","details":"Use my notes"}],"remember":[]}
"what's the latest on the EU AI Act" -> {"sources":["web"],"search_query":"EU AI Act latest","actions":[],"remember":[]}
"remember that I prefer meetings after 10am" -> {"sources":[],"search_query":"","actions":[],"remember":[{"content":"I prefer meetings after 10am","kind":"preference"}]}

Message: """${message.slice(0, 2000)}"""`;

const WEB_CUE = /\b(search (?:the )?(?:web|internet|online)|look (?:it |this |that )?up|google (?:it|for|this)|on the (?:web|internet)|online|research|latest (?:news|version|release|on|about)|what'?s new (?:in|with))\b/;

/** The message without a leading "search the web for" / "look up" / "google" cue. */
function webQuery(message: string): string {
  return message
    .replace(/^\s*(?:please\s+)?(?:(?:can|could) you\s+)?(?:search (?:the )?(?:web|internet|online)(?: for)?|look up|google(?: for)?)[\s:,]*/i, "")
    .trim()
    .slice(0, 200);
}

/** Deterministic fallback when the planner model is unavailable or invalid. */
export function heuristicPlan(message: string): Plan {
  const m = message.toLowerCase();
  const remember = heuristicMemories(message);
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
  if (WEB_CUE.test(m)) sources.add("web");
  if (/\b(note|notes|bookmark|bookmarks|saved|doc|docs|document|knowledge|drive|notion|wiki|file|according)\b/.test(m) || (sources.size === 0 && remember.length === 0)) sources.add("knowledge");

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
  return { sources: [...sources], search_query: sources.has("web") ? webQuery(message) : message.slice(0, 200), actions: actions.slice(0, 3), remember };
}

/** Owner capability switches (Settings > Agent) always win over the planner. New keys are optional so older settings objects keep working. */
export function applyCapabilities(
  plan: Plan,
  caps: { readEmail: boolean; createDrafts: boolean; manageTasks: boolean; runAutomations: boolean; searchKnowledge: boolean; searchWeb?: boolean; autoMemory?: boolean },
): Plan {
  return {
    ...plan,
    remember: caps.autoMemory === false ? [] : plan.remember,
    sources: plan.sources.filter((s) => (s === "gmail" ? caps.readEmail : s === "knowledge" ? caps.searchKnowledge : s === "web" ? caps.searchWeb !== false : true)),
    actions: plan.actions.filter((a) =>
      a.kind === "create_draft" ? caps.createDrafts && caps.readEmail : a.kind === "run_automation" ? caps.runAutomations : a.kind === "create_task" || a.kind === "schedule_task" ? caps.manageTasks : true,
    ),
  };
}
