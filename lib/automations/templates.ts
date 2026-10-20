import type { AutomationAction, AutomationCondition, AutomationTrigger } from "@/lib/db/schema";

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  /** Integrations this recipe combines (catalog ids); shown on each integration's page. */
  uses?: string[];
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
  // ---- Integration recipes: integrations working together ----
  {
    id: "urgent-mail-to-task",
    name: "Urgent email → task + phone alert",
    description: "When Gmail gets an urgent email, add a reply task and alert your phone.",
    trigger: { type: "email", category: "URGENT" },
    conditions: [],
    actions: [{ type: "create_task", title: "Reply: {{subject}}", description: "From {{from}}. {{summary}}" }, { type: "notify", title: "Urgent: {{subject}}", body: "{{summary}}" }],
    uses: ["gmail"],
  },
  {
    id: "meeting-prep-brief",
    name: "Meeting prep from mail and docs",
    description: "Before a calendar meeting, brief you from related emails and Drive, Notion or GitHub notes.",
    trigger: { type: "calendar_event" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "I have a meeting soon: {{title}}. Using my recent email and my knowledge (Drive, Notion, GitHub), give me 3 bullets of context and 2 questions to ask." }, { type: "notify", title: "Prep: {{title}}", body: "{{agent_output}}" }],
    uses: ["googlecalendar", "gmail", "googledrive", "notion", "github", "zoom"],
  },
  {
    id: "new-doc-digest",
    name: "New document → summary note",
    description: "When a new Drive, Notion, Slack or GitHub item is indexed, save a short summary as a note.",
    trigger: { type: "knowledge_item" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "Summarize the new item \"{{title}}\" from my knowledge in 3 bullets with any action items." }, { type: "add_note", title: "Summary: {{title}}", content: "{{agent_output}}" }],
    uses: ["googledrive", "googledocs", "googlesheets", "notion", "slack", "github", "figma", "youtube"],
  },
  {
    id: "daily-standup",
    name: "Daily stand-up",
    description: "Weekday mornings: yesterday, today and blockers from your tasks (including Asana and Linear) and calendar.",
    trigger: { type: "schedule", cron: "45 8 * * 1-5", text: "every weekday at 8:45am" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "Write my stand-up: what I finished yesterday, what I'm doing today (tasks incl. Asana/Linear and meetings), and any blockers. Keep it under 120 words." }, { type: "notify", title: "Your stand-up", body: "{{agent_output}}" }],
    uses: ["asana", "linear", "googlecalendar", "github"],
  },
  {
    id: "weekly-business-pulse",
    name: "Weekly business pulse",
    description: "Monday recap of last week's Stripe payments and your HubSpot contacts, saved as a note.",
    trigger: { type: "schedule", cron: "0 9 * * 1", text: "every monday at 9am" },
    conditions: [],
    actions: [{ type: "call_agent", prompt: "From my HubSpot and Stripe knowledge, summarize last week: new contacts, payments, anything that needs follow-up." }, { type: "add_note", title: "Business pulse", content: "{{agent_output}}" }],
    uses: ["hubspot", "stripe"],
  },
  {
    id: "news-to-linkedin",
    name: "News → LinkedIn draft",
    description: "When a headline matches your topics, draft a LinkedIn post for you to approve.",
    trigger: { type: "news_topic", keywords: ["AI", "productivity"] },
    conditions: [],
    actions: [{ type: "create_linkedin_draft", prompt: "My take on: {{title}}" }],
    uses: ["linkedin", "canva"],
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
  write_email: "Write an email (Gmail draft)",
  create_youtube_package: "Create a YouTube video package",
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
