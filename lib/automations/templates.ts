import type { AutomationAction, AutomationCondition, AutomationTrigger } from "@/lib/db/schema";

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

/** Starting points. Every action here is internal (drafts, tasks, notes, notifications). */
export const TEMPLATES: AutomationTemplate[] = [
  {
    id: "morning-briefing",
    name: "Morning briefing",
    description: "Generate your briefing on weekday mornings and notify you.",
    trigger: { type: "schedule", cron: "30 7 * * 1-5", text: "every weekday at 7:30am" },
    conditions: [],
    actions: [{ type: "generate_briefing" }, { type: "notify", title: "Your briefing is ready", body: "Open Today to see it." }],
  },
  {
    id: "inbox-triage",
    name: "Inbox triage",
    description: "Every two hours on weekdays, summarize what needs a reply.",
    trigger: { type: "schedule", cron: "0 9-17/2 * * 1-5", text: "every 2 hours on weekdays" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "Summarize emails that need a reply, most urgent first, in 3 bullets." }, { type: "notify", title: "Inbox triage", body: "{{agent_output}}" }],
  },
  {
    id: "meeting-follow-up",
    name: "Meeting follow-up",
    description: "When a meeting is about to start, add a follow-up task.",
    trigger: { type: "calendar_event" },
    conditions: [],
    actions: [{ type: "create_task", title: "Follow up: {{title}}", description: "Send notes and next steps after the meeting." }],
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    description: "Friday afternoon recap saved to your knowledge base.",
    trigger: { type: "schedule", cron: "0 16 * * 5", text: "every friday at 4pm" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "Write a short weekly review: what got done, what's open, what to focus on next week." }, { type: "add_note", title: "Weekly review", content: "{{agent_output}}" }],
  },
  {
    id: "news-to-ideas",
    name: "News digest to LinkedIn ideas",
    description: "When a headline matches your topics, draft a post for review.",
    trigger: { type: "news_topic", keywords: ["AI", "remote work"] },
    conditions: [],
    actions: [{ type: "create_linkedin_draft", prompt: "My take on: {{title}}" }],
  },
  {
    id: "overdue-nudge",
    name: "Overdue task nudge",
    description: "Each morning, a gentle note about overdue tasks.",
    trigger: { type: "schedule", cron: "0 9 * * *", text: "every day at 9am" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "List my overdue tasks in one short paragraph and suggest which to do first." }, { type: "notify", title: "Overdue tasks", body: "{{agent_output}}" }],
  },
];

export const ACTION_LABEL: Record<AutomationAction["type"], string> = {
  create_task: "Create task",
  create_draft: "Create Gmail draft",
  generate_briefing: "Generate briefing",
  create_linkedin_draft: "Create LinkedIn draft",
  add_note: "Add note to knowledge base",
  notify: "Notify me",
  call_agent: "Ask the agent",
  call_webhook: "Call webhook",
};

export const TRIGGER_LABEL: Record<AutomationTrigger["type"], string> = {
  schedule: "On a schedule",
  email: "New email matching rules",
  calendar_event: "Upcoming calendar event",
  task_status: "Task status changes",
  knowledge_item: "New knowledge item",
  webhook: "Incoming webhook",
  news_topic: "News topic match",
};
