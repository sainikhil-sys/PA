/** Response shapes of the Cowork API (app/api/mobile/** and the shared /api routes on the server). */

export type Me = {
  email: string;
  name: string | null;
  timezone: string;
  agentName: string;
  onboarded: boolean;
  pendingApprovals: number;
  unreadNotifications: number;
};

export type TaskStatus = "todo" | "in_progress" | "needs_review" | "done";

export type TaskSummary = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  dueDate: string | null;
  scheduledAt?: string | null;
  assignee: "me" | "agent" | "claude" | "system";
  recurring?: boolean;
};

export type TaskDetail = TaskSummary & {
  description: string;
  durationMinutes: number | null;
  remindAt: string | null;
  completedAt: string | null;
  resultMarkdown: string | null;
};

export type Today = {
  date: string;
  timezone: string;
  agentName: string;
  briefing: { date: string; isToday: boolean; headline: string; summary: string; priorities: string[] } | null;
  calendarConnected: boolean;
  events: { title: string; start: string; end: string; location: string | null }[];
  tasks: TaskSummary[];
  review: TaskSummary[];
  mail: { id: string; from: string; subject: string; summary: string; category: string | null; receivedAt: string }[];
  pendingApprovals: number;
};

export type Approval = {
  id: string;
  kind: string;
  label: string;
  summary: string;
  source: string;
  conversationId: string | null;
  createdAt: string;
};

export type Conversation = { id: string; title: string; updatedAt: string; createdAt: string };

export type Citation = { n: number; title: string; url?: string | null; source?: string };

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta: { proposalIds?: string[]; citations?: Citation[]; error?: boolean; attachment?: { name: string } } & Record<string, unknown>;
};

export type StoredProposal = { id: string; kind: string; summary: string; status: string };

export type ConversationDetail = { convo: Conversation; messages: StoredMessage[]; proposals: StoredProposal[] };

export type ChatEvent =
  | { type: "meta"; conversationId: string; runId: string; userMessageId: string }
  | { type: "tool"; tool: string; label: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "text"; delta: string }
  | { type: "proposal"; proposal: { id: string; kind: string; label: string; summary: string } }
  | { type: "done"; messageId: string; generalKnowledge: boolean; model?: string }
  | { type: "error"; message: string };

export type Memory = { id: string; content: string; kind: string; updatedAt: string };

export type DocumentItem = { id: string; title: string; url: string | null; chars: number; sourceId: string; updatedAt: string };

export type AppNotification = { id: string; kind: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };

export type ActivityEntry = { id: string; actor: string; tool: string; inputSummary: string | null; outcome: string; createdAt: string };

export type Integration = {
  id: string;
  name: string;
  category: string;
  status: "connected" | "error" | "not_connected" | string;
  account: string | null;
  lastSyncAt: string | null;
  error: string | null;
};

export type PhoneDevice = { id: string; name: string; model: string | null; paused: boolean; lastSeenAt: string | null };
