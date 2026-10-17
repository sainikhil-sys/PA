import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Every table carries user_id so the data model is multi-user ready.
 * A single-user allowlist (ALLOWED_EMAILS) is enforced on top of that.
 */

export const EMBEDDING_DIMENSIONS = 1024;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// ---------- Enums ----------
export const emailCategory = pgEnum("email_category", ["URGENT", "REPLY_NEEDED", "FYI", "NEWSLETTER", "SPAM"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "needs_review", "done"]);
export const actor = pgEnum("actor", ["me", "agent", "claude", "system"]);
export const tokenKind = pgEnum("token_kind", ["manual", "oauth"]);
export const activityOutcome = pgEnum("activity_outcome", ["success", "error", "denied"]);
export const jobStatus = pgEnum("job_status", ["pending", "running", "succeeded", "failed"]);
export const commentKind = pgEnum("comment_kind", ["comment", "change_request", "result"]);
export const proposalStatus = pgEnum("proposal_status", ["pending", "approved", "dismissed", "executed", "failed"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "dead"]);

// ---------- Users, sessions, settings ----------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  role: text("role"),
  bio: text("bio"),
  onboardedAt: ts("onboarded_at"),
  /** Set by an admin: the account can't sign in and background work skips it. */
  disabledAt: ts("disabled_at"),
  createdAt: createdAt(),
});

/** One-time sign-in codes. Only an HMAC of (email, code) is stored. */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    emailHash: text("email_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("otp_email_idx").on(t.emailHash, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: userId(),
    /** SHA-256 of the cookie value; the raw token only lives in the httpOnly cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ipPrefix: text("ip_prefix"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export type AgentSettings = {
  name: string;
  avatar: string;
  personality: "concise" | "warm" | "formal" | "coach";
  customInstructions: string;
  language: string;
  responseLength: "short" | "medium" | "detailed";
  voice: string;
  speechRate: number;
  proactivity: "ask" | "nudge" | "proactive";
  capabilities: {
    readEmail: boolean;
    createDrafts: boolean;
    manageTasks: boolean;
    runAutomations: boolean;
    searchKnowledge: boolean;
  };
};

export const DEFAULT_AGENT: AgentSettings = {
  name: "Ada",
  avatar: "orb",
  personality: "concise",
  customInstructions: "",
  language: "en",
  responseLength: "short",
  voice: "",
  speechRate: 1,
  proactivity: "nudge",
  capabilities: { readEmail: true, createDrafts: true, manageTasks: true, runAutomations: true, searchKnowledge: true },
};

export type RoomSettings = { wallpaper?: string; customWallpaper?: string; spotifyUrl?: string; youtubeUrl?: string; focusMinutes?: number; dim?: number };

export type UserAiProvider = { preset: string; baseURL: string; fastModel: string; smartModel: string; keyEnc: string; keyHint: string; addedAt: string };

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  language: text("language").notNull().default("en"),
  dateFormat: text("date_format").notNull().default("MMM d, yyyy"),
  timeFormat: text("time_format").notNull().default("24h"),
  briefingTime: text("briefing_time").notNull().default("07:00"),
  newsTopics: text("news_topics").array().notNull().default(sql`'{world,technology,business}'::text[]`),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  notifyEmailDigest: boolean("notify_email_digest").notNull().default(true),
  /** Email for urgent mail, reminders and automation alerts. */
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifyTelegram: boolean("notify_telegram").notNull().default(false),
  /** Push to paired phones/browsers. */
  notifyPush: boolean("notify_push").notNull().default(true),
  fontScale: text("font_scale").notNull().default("md"),
  density: text("density").notNull().default("comfortable"),
  reduceMotion: boolean("reduce_motion").notNull().default(false),
  automationsPaused: boolean("automations_paused").notNull().default(false),
  agent: jsonb("agent").$type<AgentSettings>().notNull().default(DEFAULT_AGENT),
  /** Live Link panel preferences (mode, position, opacity…), persisted per user. */
  linkPanel: jsonb("link_panel").$type<Record<string, unknown>>().notNull().default({}),
  /** The user's own AI provider (OpenAI-compatible). Key is AES-256-GCM encrypted; never sent to the client. */
  aiProvider: jsonb("ai_provider").$type<UserAiProvider | null>(),
  /** Today "room": wallpaper, music and video widgets. */
  room: jsonb("room").$type<RoomSettings>().notNull().default({}),
  /** Order of the Today cards (card ids), set by dragging. Empty = default order. */
  todayLayout: jsonb("today_layout").$type<string[]>().notNull().default([]),
  updatedAt: updatedAt(),
});

// ---------- Integrations (OAuth/API tokens encrypted at rest) ----------
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("connected"),
    accountLabel: text("account_label"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_user_provider_idx").on(t.userId, t.provider)],
);

// ---------- Email ----------
export const emails = pgTable(
  "emails",
  {
    id: id(),
    userId: userId(),
    gmailId: text("gmail_id").notNull(),
    threadId: text("thread_id").notNull(),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    subject: text("subject").notNull().default(""),
    /** Gmail's own short snippet. Full bodies are never persisted. */
    snippet: text("snippet").notNull().default(""),
    receivedAt: ts("received_at").notNull(),
    labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
    category: emailCategory("category"),
    summary: text("summary"),
    priority: integer("priority"),
    actionRequired: boolean("action_required").notNull().default(false),
    classifiedAt: ts("classified_at"),
    classifyAttempts: integer("classify_attempts").notNull().default(0),
    draftId: text("draft_id"),
    draftCreatedAt: ts("draft_created_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("emails_user_gmail_idx").on(t.userId, t.gmailId),
    index("emails_user_received_idx").on(t.userId, t.receivedAt),
    index("emails_user_category_idx").on(t.userId, t.category),
  ],
);

// ---------- Briefings ----------
export type BriefingContent = {
  headline: string;
  summary: string;
  priorities: string[];
  meetings: { title: string; start: string; end: string; location?: string | null }[];
  emails: { id: string; subject: string; from: string; category: string; summary: string }[];
  deadlines: { title: string; due: string }[];
};

export const briefings = pgTable(
  "briefings",
  {
    id: id(),
    userId: userId(),
    date: date("date", { mode: "string" }).notNull(),
    content: jsonb("content").$type<BriefingContent>().notNull(),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("briefings_user_date_idx").on(t.userId, t.date)],
);

// ---------- Tasks ----------
export type TaskArtifact = { title: string; url?: string; content?: string };
export type Recurrence = { freq: "daily" | "weekly" | "monthly"; interval: number; byWeekday?: number[]; time?: string };

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: userId(),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatus("status").notNull().default("todo"),
    /** 0 none, 1 low, 2 medium, 3 high */
    priority: integer("priority").notNull().default(0),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    assignee: actor("assignee").notNull().default("me"),
    createdBy: actor("created_by").notNull().default("me"),
    dueDate: date("due_date", { mode: "string" }),
    scheduledAt: ts("scheduled_at"),
    durationMinutes: integer("duration_minutes"),
    recurrence: jsonb("recurrence").$type<Recurrence>(),
    remindAt: ts("remind_at"),
    reminderSentAt: ts("reminder_sent_at"),
    position: doublePrecision("position").notNull().default(0),
    claimedAt: ts("claimed_at"),
    claimedByTokenId: uuid("claimed_by_token_id"),
    resultMarkdown: text("result_markdown"),
    artifacts: jsonb("artifacts").$type<TaskArtifact[]>(),
    resultAt: ts("result_at"),
    completedAt: ts("completed_at"),
    sourceEmailId: uuid("source_email_id").references(() => emails.id, { onDelete: "set null" }),
    /** Imported from another tool, e.g. "asana:1203" or "linear:ENG-12" (dedupe key). */
    externalRef: text("external_ref"),
    externalUrl: text("external_url"),
    /** Agile: sprint and story points. */
    sprintId: uuid("sprint_id"),
    points: integer("points"),
    /** External AI agent working this task ("chatgpt" | "gemini" | "claude"), via Agents. */
    agentProvider: text("agent_provider"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_user_sprint_idx").on(t.userId, t.sprintId),
    uniqueIndex("tasks_user_external_idx").on(t.userId, t.externalRef),
    index("tasks_user_status_idx").on(t.userId, t.status, t.position),
    index("tasks_user_scheduled_idx").on(t.userId, t.scheduledAt),
    index("tasks_parent_idx").on(t.parentId),
  ],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: id(),
    userId: userId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    author: actor("author").notNull(),
    kind: commentKind("kind").notNull().default("comment"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId, t.createdAt)],
);

// ---------- Agents (ChatGPT / Gemini / Claude by API key) and sprints ----------
export const agentConnectors = pgTable(
  "agent_connectors",
  {
    id: id(),
    userId: userId(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    keyEnc: text("key_enc").notNull(),
    keyHint: text("key_hint").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agent_connectors_user_provider_idx").on(t.userId, t.provider)],
);

export const sprints = pgTable(
  "sprints",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    /** planned | active | closed */
    status: text("status").notNull().default("planned"),
    createdAt: createdAt(),
  },
  (t) => [index("sprints_user_idx").on(t.userId, t.startDate)],
);

// ---------- Notes & agent memory ----------
export const notes = pgTable(
  "notes",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    source: actor("source").notNull().default("me"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notes_user_idx").on(t.userId, t.createdAt),
    index("notes_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** What the agent remembers about the owner. Visible, editable and deletable in Settings. */
export const memories = pgTable(
  "memories",
  {
    id: id(),
    userId: userId(),
    content: text("content").notNull(),
    kind: text("kind").notNull().default("preference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memories_user_idx").on(t.userId)],
);

// ---------- Claude connection: tokens & OAuth ----------
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    kind: tokenKind("kind").notNull().default("manual"),
    oauthClientId: text("oauth_client_id"),
    scopes: text("scopes").array().notNull(),
    expiresAt: ts("expires_at"),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  registration: text("registration").notNull().default("dynamic"),
  createdAt: createdAt(),
});

export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  userId: userId(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scopes: text("scopes").array().notNull(),
  resource: text("resource"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  id: id(),
  userId: userId(),
  tokenHash: text("token_hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  scopes: text("scopes").array().notNull(),
  resource: text("resource"),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

// ---------- Activity, notifications, observability ----------
export const activityLog = pgTable(
  "activity_log",
  {
    id: id(),
    userId: userId(),
    actor: actor("actor").notNull(),
    tool: text("tool").notNull(),
    inputSummary: text("input_summary").notNull().default(""),
    outcome: activityOutcome("outcome").notNull(),
    detail: text("detail"),
    tokenId: uuid("token_id"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_user_created_idx").on(t.userId, t.createdAt)],
);

// ---------- Devices (Web Push) and phone pairing ----------
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: userId(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    label: text("label").notNull().default("Device"),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [index("push_user_idx").on(t.userId)],
);

/** Single-use, 10-minute QR tokens that sign a phone in to the account that showed the code. */
export const pairTokens = pgTable("pair_tokens", {
  id: id(),
  userId: userId(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

// ---------- Phone link (Android companion app forwards the phone's notifications) ----------
export const phoneDevices = pgTable(
  "phone_devices",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    model: text("model"),
    /** sha256 of the device's secret token (the app keeps the token). */
    tokenHash: text("token_hash").notNull().unique(),
    battery: integer("battery"),
    charging: boolean("charging"),
    /** Paused: the app keeps running but Cowork ignores what it sends. */
    paused: boolean("paused").notNull().default(false),
    lastSeenAt: ts("last_seen_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("phone_devices_user_idx").on(t.userId)],
);

/** One-time 6-character codes shown in Cowork and typed or scanned in the phone app (10 minutes). */
export const phonePairCodes = pgTable("phone_pair_codes", {
  id: id(),
  userId: userId(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** Calls, messages and app notifications from a linked phone. Kept 3 days, then deleted. */
export const phoneEvents = pgTable(
  "phone_events",
  {
    id: id(),
    userId: userId(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => phoneDevices.id, { onDelete: "cascade" }),
    /** call | sms | whatsapp | notification */
    kind: text("kind").notNull(),
    appPackage: text("app_package").notNull(),
    appName: text("app_name").notNull(),
    title: text("title").notNull().default(""),
    text: text("text").notNull().default(""),
    /** Android notification key, to drop duplicates. */
    externalKey: text("external_key"),
    postedAt: ts("posted_at").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("phone_events_user_idx").on(t.userId, t.postedAt), uniqueIndex("phone_events_dedupe_idx").on(t.deviceId, t.externalKey)],
);

// ---------- Admin broadcasts ----------
export const broadcasts = pgTable("broadcasts", {
  id: id(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  channels: text("channels").array().notNull(),
  status: text("status").notNull().default("queued"),
  recipients: integer("recipients").notNull().default(0),
  sentInApp: integer("sent_in_app").notNull().default(0),
  sentEmail: integer("sent_email").notNull().default(0),
  sentPush: integer("sent_push").notNull().default(0),
  /** Last processed user id, so a long send resumes across job runs. */
  cursor: text("cursor"),
  createdAt: createdAt(),
  finishedAt: ts("finished_at"),
});

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: userId(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    dedupeKey: text("dedupe_key"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_idx").on(t.userId, t.dedupeKey),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    taskKind: text("task_kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    ok: boolean("ok").notNull(),
    attempts: integer("attempts").notNull().default(1),
    durationMs: integer("duration_ms").notNull(),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** "server" (Cowork's key) or "own" (the user's key from Settings). */
    keySource: text("key_source").notNull().default("server"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_runs_created_idx").on(t.createdAt), index("ai_runs_user_idx").on(t.userId, t.createdAt)],
);

// ---------- Jobs (failed = dead letter, re-runnable) ----------
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    userId: userId(),
    type: text("type").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_dedupe_idx")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('pending','running')`),
  ],
);

// ---------- Chat ----------
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull().default("New chat"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)],
);

export type Citation = { n: number; title: string; url?: string | null; sourceType: string; itemId?: string };
export type MessageMeta = {
  toolsUsed?: string[];
  citations?: Citation[];
  proposalIds?: string[];
  generalKnowledge?: boolean;
  attachment?: { name: string; chars: number };
  model?: string;
  runId?: string;
};

export const messages = pgTable(
  "messages",
  {
    id: id(),
    userId: userId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").$type<MessageMeta>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conv_idx").on(t.conversationId, t.createdAt)],
);

// ---------- Approval queue ----------
export type ProposalKind = "create_task" | "create_draft" | "schedule_task" | "run_automation" | "create_linkedin_draft" | "add_note" | "notify";

export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    userId: userId(),
    source: text("source").notNull(),
    kind: text("kind").$type<ProposalKind>().notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: proposalStatus("status").notNull().default("pending"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    conversationId: uuid("conversation_id"),
    automationRunId: uuid("automation_run_id"),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("proposals_user_status_idx").on(t.userId, t.status, t.createdAt)],
);

// ---------- Automations ----------
export type AutomationTrigger =
  | { type: "schedule"; cron: string; text?: string }
  | { type: "email"; from?: string; subjectContains?: string; category?: string }
  | { type: "calendar_event"; titleContains?: string }
  | { type: "task_status"; to: string }
  | { type: "knowledge_item"; sourceType?: string }
  | { type: "webhook" }
  | { type: "news_topic"; keywords: string[] };

export type AutomationCondition = { field: string; op: "contains" | "equals" | "not_contains"; value: string };
export type AutomationAction =
  | { type: "create_task"; title: string; description?: string }
  | { type: "create_draft"; instructions?: string }
  | { type: "generate_briefing" }
  | { type: "create_linkedin_draft"; prompt?: string }
  | { type: "add_note"; title: string; content?: string }
  | { type: "notify"; title: string; body?: string }
  | { type: "call_agent"; prompt: string }
  | { type: "call_webhook"; url: string }
  | { type: "write_email"; to: string; subject?: string; instructions: string }
  | { type: "create_youtube_package"; topic: string };

export type RunStep = {
  index: number;
  action: string;
  status: "ok" | "skipped" | "error" | "dry_run" | "queued_for_approval";
  message: string;
  output?: string;
  at: string;
};

export const automations = pgTable(
  "automations",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    template: text("template"),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    conditions: jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull(),
    /** Which action types this automation may perform. */
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    timeoutMs: integer("timeout_ms").notNull().default(60_000),
    webhookSecretHash: text("webhook_secret_hash"),
    lastRunAt: ts("last_run_at"),
    nextRunAt: ts("next_run_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automations_user_idx").on(t.userId), index("automations_next_run_idx").on(t.enabled, t.nextRunAt)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    userId: userId(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** Idempotency key: the same trigger event never runs twice. */
    runKey: text("run_key").notNull(),
    status: runStatus("status").notNull().default("queued"),
    dryRun: boolean("dry_run").notNull().default(false),
    event: jsonb("event").$type<Record<string, unknown>>().notNull().default({}),
    steps: jsonb("steps").$type<RunStep[]>().notNull().default([]),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("automation_runs_key_idx").on(t.automationId, t.runKey),
    index("automation_runs_user_idx").on(t.userId, t.createdAt),
  ],
);

// ---------- Knowledge base ----------
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: id(),
    userId: userId(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    included: boolean("included").notNull().default(true),
    status: text("status").notNull().default("idle"),
    itemCount: integer("item_count").notNull().default(0),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("knowledge_sources_user_idx").on(t.userId)],
);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: id(),
    userId: userId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    mimeType: text("mime_type"),
    contentHash: text("content_hash").notNull(),
    chars: integer("chars").notNull().default(0),
    sourceUpdatedAt: ts("source_updated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("knowledge_items_source_ext_idx").on(t.sourceId, t.externalId), index("knowledge_items_user_idx").on(t.userId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    userId: userId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    idx: integer("idx").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', content)`),
    createdAt: createdAt(),
  },
  (t) => [
    index("knowledge_chunks_item_idx").on(t.itemId),
    index("knowledge_chunks_user_idx").on(t.userId),
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
    index("knowledge_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ---------- News ----------
export const newsItems = pgTable(
  "news_items",
  {
    id: id(),
    userId: userId(),
    urlHash: text("url_hash").notNull(),
    url: text("url").notNull(),
    sourceName: text("source_name").notNull(),
    title: text("title").notNull(),
    /** One-line summary from the feed's own description (truncated). Never full articles. */
    summary: text("summary").notNull().default(""),
    /** Lead image from the feed (https only). Served to the browser through /api/news/[id]/image. */
    imageUrl: text("image_url"),
    category: text("category").notNull(),
    publishedAt: ts("published_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("news_user_url_idx").on(t.userId, t.urlHash), index("news_user_published_idx").on(t.userId, t.publishedAt)],
);

// ---------- Content (LinkedIn) ----------
export const ideas = pgTable(
  "ideas",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    hook: text("hook"),
    body: text("body").notNull().default(""),
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    status: text("status").notNull().default("new"),
    suggestedFor: date("suggested_for", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [index("ideas_user_idx").on(t.userId, t.createdAt)],
);

export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: id(),
    userId: userId(),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("linkedin"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("draft"),
    writtenBy: actor("written_by").notNull().default("agent"),
    /** Hash of the exact body that was approved; any edit invalidates approval. */
    approvedHash: text("approved_hash"),
    scheduledFor: ts("scheduled_for"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_drafts_user_idx").on(t.userId, t.updatedAt)],
);

// ---------- Tracing (shared by chat, voice, automations, MCP and jobs) ----------
/**
 * One row per step of a run. Metadata and counts only — never email bodies,
 * tokens or document text. The future Flow page and Live Link panel read these.
 */
export const traceSpans = pgTable(
  "trace_spans",
  {
    id: id(),
    userId: userId(),
    runId: uuid("run_id").notNull(),
    parentId: uuid("parent_id"),
    /** chat | voice | automation | mcp | job */
    runKind: text("run_kind").notNull(),
    /** What started the run: text, voice, schedule, email, webhook, claude, manual… */
    trigger: text("trigger").notNull(),
    /** Graph node id, e.g. agent, model:smart, gmail, calendar, knowledge, tasks, approval, output:draft */
    node: text("node").notNull(),
    /** Plain-English, content-free description: "Read 12 emails". */
    label: text("label").notNull(),
    /** running | ok | error | blocked | waiting | dry_run */
    status: text("status").notNull().default("running"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
  },
  (t) => [index("trace_spans_user_started_idx").on(t.userId, t.startedAt), index("trace_spans_run_idx").on(t.runId)],
);

export type TraceSpan = typeof traceSpans.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskComment = typeof taskComments.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type ActivityEntry = typeof activityLog.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Briefing = typeof briefings.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type NewsItem = typeof newsItems.$inferSelect;
export type Idea = typeof ideas.$inferSelect;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type EmailCategory = (typeof emailCategory.enumValues)[number];
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type Actor = (typeof actor.enumValues)[number];
