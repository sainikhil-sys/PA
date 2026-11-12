import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

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

/**
 * Shared rate-limit counters, used when Upstash Redis isn't configured. One row per limit and key
 * (fixed window); the atomic upsert in lib/security/ratelimit.ts makes it work across instances.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: ts("reset_at").notNull(),
  },
  (t) => [index("rate_limits_reset_idx").on(t.resetAt)],
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
    /** Latest client details from request headers (X-Cowork-*), stored during the session touch. */
    platform: text("platform"),
    appVersion: text("app_version"),
    appBuild: integer("app_build"),
    runtimeVersion: text("runtime_version"),
    updateId: text("update_id"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------- Admin console (docs/ADMIN_CONSOLE_PROPOSAL.md, section 3) ----------
/** Roles are fixed in code (lib/admin/permissions.ts); this enum only names them. */
export const adminRole = pgEnum("admin_role", ["owner", "admin", "moderator", "support", "analyst"]);

/**
 * Who holds an admin role. The owner row is written only by scripts/admin-bootstrap.mjs; other roles by
 * the owner (roles.manage). One active role per person, at most one active owner. Revoked rows stay.
 */
export const adminRoleAssignments = pgTable(
  "admin_role_assignments",
  {
    id: id(),
    userId: userId(),
    role: adminRole("role").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    /** "bootstrap" (server script) or "console". */
    source: text("source").$type<"bootstrap" | "console">().notNull(),
    note: text("note"),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("admin_role_active_user_idx").on(t.userId).where(sql`revoked_at is null`),
    uniqueIndex("admin_role_one_owner_idx").on(t.role).where(sql`role = 'owner' and revoked_at is null`),
  ],
);

/** TOTP second factor for admin work. The secret is AES-256-GCM encrypted (lib/security/crypto). */
export const adminMfa = pgTable("admin_mfa", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  totpSecretEnc: text("totp_secret_enc").notNull(),
  /** Last accepted 30-second step; a code for this step or earlier is refused (replay). */
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  /** SHA-256 hashes of single-use recovery codes; a used code is removed. */
  recoveryCodeHashes: text("recovery_code_hashes").array().notNull(),
  /** Null until the first code is confirmed; an unconfirmed secret grants nothing. */
  enabledAt: ts("enabled_at"),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  updatedAt: updatedAt(),
});

/** Short admin session created by a step-up, bound to one user session. Stored hashed. */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id(),
    userId: userId(),
    userSessionId: uuid("user_session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    method: text("method").$type<"totp" | "recovery" | "passkey">().notNull(),
    platform: text("platform").$type<"web" | "android">().notNull(),
    ipPrefix: text("ip_prefix"),
    userAgent: text("user_agent"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Absolute limit (2 hours). The idle limit (15 minutes) is checked against lastSeenAt. */
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_sessions_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Append-only admin audit trail. Triggers in the migration set prev_hash and hash on insert and reject
 * UPDATE, DELETE and TRUNCATE. No foreign keys, so deleting a user never deletes history.
 */
export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    createdAt: createdAt(),
    actorUserId: uuid("actor_user_id"),
    actorEmailHash: text("actor_email_hash"),
    actorRole: text("actor_role"),
    adminSessionId: uuid("admin_session_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    outcome: text("outcome").$type<"success" | "denied" | "failed">().notNull(),
    ipPrefix: text("ip_prefix"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    /** Set by the insert trigger. */
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().default(""),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_actor_idx").on(t.actorUserId, t.createdAt), index("audit_resource_idx").on(t.resourceType, t.resourceId)],
);

/** One-time confirmation tokens for destructive admin operations (2 minutes, bound to the exact input). */
export const adminConfirmations = pgTable(
  "admin_confirmations",
  {
    id: id(),
    userId: userId(),
    tokenHash: text("token_hash").notNull().unique(),
    action: text("action").notNull(),
    /** SHA-256 of the canonical JSON input; the commit must match it. */
    inputHash: text("input_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_confirmations_user_idx").on(t.userId)],
);

// ---------- Configuration (keys must exist in lib/config/registry.ts) ----------
export const appConfiguration = pgTable("app_configuration", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export const appConfigurationHistory = pgTable(
  "app_configuration_history",
  {
    id: id(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    value: jsonb("value").notNull(),
    previousValue: jsonb("previous_value"),
    restoredFromVersion: integer("restored_from_version"),
    actorUserId: uuid("actor_user_id"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("config_history_key_version_idx").on(t.key, t.version)],
);

// ---------- Feature flags (keys must exist in lib/flags/registry.ts) ----------
export type FlagTargeting = {
  platforms?: ("web" | "android")[];
  minAppVersion?: string;
  maxAppVersion?: string;
  segments?: ("admins" | "beta" | "new_users_30d" | "signed_up_before")[];
  signedUpBefore?: string;
  allowUserIds?: string[];
  denyUserIds?: string[];
};

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  rolloutPercent: integer("rollout_percent").notNull().default(0),
  targeting: jsonb("targeting").$type<FlagTargeting>().notNull().default({}),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
  archivedAt: ts("archived_at"),
});

export const featureFlagHistory = pgTable(
  "feature_flag_history",
  {
    id: id(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    value: jsonb("value").notNull(),
    previousValue: jsonb("previous_value"),
    restoredFromVersion: integer("restored_from_version"),
    actorUserId: uuid("actor_user_id"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("flag_history_key_version_idx").on(t.key, t.version)],
);

// ---------- Releases (the update policy is a configuration key per platform) ----------
export const applicationReleases = pgTable(
  "application_releases",
  {
    id: id(),
    platform: text("platform").$type<"android" | "web">().notNull(),
    kind: text("kind").$type<"store" | "ota">().notNull(),
    version: text("version").notNull(),
    buildNumber: integer("build_number"),
    runtimeVersion: text("runtime_version"),
    channel: text("channel").notNull().default("production"),
    updateGroupId: text("update_group_id"),
    status: text("status").$type<"draft" | "testing" | "live" | "halted" | "retired">().notNull().default("draft"),
    notes: text("notes").notNull().default(""),
    storeUrl: text("store_url"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    releasedAt: ts("released_at"),
  },
  (t) => [uniqueIndex("release_unique_idx").on(t.platform, t.kind, t.version, t.channel)],
);

// ---------- Announcements (persistent and time-boxed; broadcasts stay one-shot sends) ----------
export const systemAnnouncements = pgTable("system_announcements", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  severity: text("severity").$type<"info" | "warning" | "critical">().notNull().default("info"),
  placement: text("placement").$type<"banner" | "home_card">().notNull().default("banner"),
  /** In-app path only, same rule as broadcasts. */
  href: text("href"),
  targeting: jsonb("targeting").$type<FlagTargeting>().notNull().default({}),
  dismissible: boolean("dismissible").notNull().default(true),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  archivedAt: ts("archived_at"),
});

export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    userId: userId(),
    announcementId: uuid("announcement_id").notNull(),
    dismissedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.announcementId] }),
    foreignKey({ name: "announcement_dismissals_announcement_fk", columns: [t.announcementId], foreignColumns: [systemAnnouncements.id] }).onDelete("cascade"),
  ],
);

// ---------- Users: restrictions and deletion requests ----------
export const RESTRICTABLE_FEATURES = ["ai", "uploads", "automations", "connect", "community"] as const;
export type RestrictableFeature = (typeof RESTRICTABLE_FEATURES)[number];

export const userRestrictions = pgTable(
  "user_restrictions",
  {
    id: id(),
    userId: userId(),
    feature: text("feature").$type<RestrictableFeature>().notNull(),
    reason: text("reason").notNull(),
    expiresAt: ts("expires_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    liftedAt: ts("lifted_at"),
  },
  (t) => [index("user_restrictions_user_idx").on(t.userId)],
);

export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Kept after deletion as proof it was done. */
  emailHash: text("email_hash").notNull(),
  source: text("source").$type<"email" | "support">().notNull(),
  status: text("status").$type<"received" | "verified" | "completed" | "rejected">().notNull().default("received"),
  /** received + 30 days, as /delete-account promises. */
  dueBy: ts("due_by").notNull(),
  note: text("note"),
  recordedBy: uuid("recorded_by"),
  completedBy: uuid("completed_by"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});

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
    searchWeb: boolean;
    autoMemory: boolean;
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
  capabilities: { readEmail: true, createDrafts: true, manageTasks: true, runAutomations: true, searchKnowledge: true, searchWeb: true, autoMemory: true },
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

// ---------- Focus sessions (Today focus timer history) ----------
export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: id(),
    userId: userId(),
    /** Optional task the session was for. History survives the task being deleted. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at").notNull(),
    plannedMinutes: integer("planned_minutes").notNull(),
    /** Minutes the timer actually ran (pauses excluded), capped at planned. */
    actualMinutes: integer("actual_minutes").notNull().default(0),
    /** True when the timer ran to zero; false when stopped early. */
    completed: boolean("completed").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("focus_sessions_user_started_idx").on(t.userId, t.startedAt), index("focus_sessions_task_idx").on(t.taskId)],
);

// ---------- Meeting notes (keyed by Google Calendar event id; the calendar itself stays read-only) ----------
export type MeetingActionItem = { title: string; owner: string | null; due: string | null; proposalId: string | null };

export const meetingNotes = pgTable(
  "meeting_notes",
  {
    id: id(),
    userId: userId(),
    /** Google Calendar event id (the instance id for recurring meetings). */
    eventId: text("event_id").notNull(),
    /** Snapshot of the event when notes were first saved. Attendee names and emails are not stored. */
    eventTitle: text("event_title").notNull().default(""),
    eventStart: ts("event_start").notNull(),
    eventEnd: ts("event_end"),
    attendeeCount: integer("attendee_count").notNull().default(0),
    /** The owner's notes (may include pasted transcripts, so they are treated as untrusted when sent to a model). */
    notes: text("notes").notNull().default(""),
    summary: text("summary"),
    decisions: jsonb("decisions").$type<string[]>().notNull().default([]),
    /** Extracted action items; each one became a create_task proposal (proposalId). */
    actionItems: jsonb("action_items").$type<MeetingActionItem[]>().notNull().default([]),
    model: text("model"),
    summarizedAt: ts("summarized_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("meeting_notes_user_event_idx").on(t.userId, t.eventId), index("meeting_notes_user_start_idx").on(t.userId, t.eventStart)],
);

// ---------- Personal trackers: money and learning ----------
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    userId: userId(),
    /** Minor units (paise, cents) so sums are exact. */
    amountMinor: integer("amount_minor").notNull(),
    /** ISO 4217 code, e.g. INR, USD. */
    currency: text("currency").notNull().default("INR"),
    category: text("category").notNull().default("other"),
    merchant: text("merchant").notNull().default(""),
    note: text("note").notNull().default(""),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("expenses_user_date_idx").on(t.userId, t.spentOn), index("expenses_user_category_idx").on(t.userId, t.category)],
);

/** Optional monthly budget per category and currency. */
export const expenseBudgets = pgTable(
  "expense_budgets",
  {
    id: id(),
    userId: userId(),
    category: text("category").notNull(),
    currency: text("currency").notNull().default("INR"),
    monthlyMinor: integer("monthly_minor").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("expense_budgets_user_category_idx").on(t.userId, t.category, t.currency)],
);

export const learningItems = pgTable(
  "learning_items",
  {
    id: id(),
    userId: userId(),
    title: text("title").notNull(),
    /** course | book | skill | video | other */
    kind: text("kind").notNull().default("course"),
    /** planned | active | paused | done */
    status: text("status").notNull().default("active"),
    /** 0 to 100 */
    progress: integer("progress").notNull().default(0),
    url: text("url"),
    notes: text("notes").notNull().default(""),
    targetDate: date("target_date", { mode: "string" }),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("learning_items_user_idx").on(t.userId, t.status, t.updatedAt)],
);

/** Study sessions logged against a learning item (for weekly minutes and streaks). */
export const learningLogs = pgTable(
  "learning_logs",
  {
    id: id(),
    userId: userId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => learningItems.id, { onDelete: "cascade" }),
    minutes: integer("minutes").notNull(),
    loggedOn: date("logged_on", { mode: "string" }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("learning_logs_user_date_idx").on(t.userId, t.loggedOn), index("learning_logs_item_idx").on(t.itemId)],
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
    /** Bookmark = a note with a URL. Title/description were fetched via safeFetch: untrusted, stored and shown as plain text only. */
    url: text("url"),
    linkDescription: text("link_description"),
    /** Null when the page details could not be fetched. */
    linkFetchedAt: ts("link_fetched_at"),
    pinned: boolean("pinned").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Last mirrored into the knowledge base "Notes" source (what chat searches). Null = needs indexing. */
    indexedAt: ts("indexed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notes_user_idx").on(t.userId, t.createdAt),
    index("notes_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("notes_user_pinned_idx").on(t.userId, t.pinned, t.updatedAt),
    index("notes_user_url_idx").on(t.userId, t.url),
    index("notes_tags_idx").using("gin", t.tags),
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
    /** "settings" (typed by the owner), "chat" or "voice" (saved from the owner's own message). Never third-party content. */
    source: text("source").notNull().default("settings"),
    /** The chat it was saved from (no FK, like proposals.conversationId). */
    conversationId: uuid("conversation_id"),
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
/** One piece of a broadcast email. Text supports **bold** and [label](url) links. */
export type MailBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "list"; items: string[] }
  | { type: "button"; label: string; url: string }
  | { type: "image"; fileId: string; alt: string; href?: string }
  | { type: "divider" };
/** The designed email for a broadcast (in-app and phone use the short title/body). */
export type BroadcastEmailContent = { subject: string; preheader: string; headline: string; blocks: MailBlock[] };

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
  /** Designed email; null = the plain announcement email built from title/body. */
  email: jsonb("email").$type<BroadcastEmailContent>(),
  createdAt: createdAt(),
  finishedAt: ts("finished_at"),
});

/**
 * Images (shown inline in the email body via cid:) and documents (attached) for a broadcast.
 * Uploaded while composing (broadcast_id null), linked to the broadcast when it's sent.
 */
export const broadcastFiles = pgTable(
  "broadcast_files",
  {
    id: id(),
    broadcastId: uuid("broadcast_id").references(() => broadcasts.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    role: text("role").$type<"inline" | "attachment">().notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    /** Pixel size for images, so the email can set exact widths. */
    width: integer("width"),
    height: integer("height"),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("broadcast_files_broadcast_idx").on(t.broadcastId), index("broadcast_files_uploader_idx").on(t.uploadedBy, t.createdAt)],
);

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
/** A memory saved (or found already saved) from the owner's own message in this turn. */
export type MessageMemory = { id: string; content: string; kind: string; status: "saved" | "updated" | "exists"; /** Content before an "updated" save, for Undo. */ previous?: string };
/** One visible step of a multi-step agent turn: labels and short previews only, never full documents. */
export type AgentStepMeta = { tool: string; label: string; status: "ok" | "error" | "skipped"; summary?: string; preview?: string };
export type MessageMeta = {
  toolsUsed?: string[];
  citations?: Citation[];
  proposalIds?: string[];
  generalKnowledge?: boolean;
  attachment?: { name: string; chars: number };
  model?: string;
  runId?: string;
  /** The model failed; the text is an error notice, not an answer (excluded from history). */
  error?: boolean;
  memories?: MessageMemory[];
  /** Fixed, Cowork-written notes such as "Web search isn't set up". */
  notices?: string[];
  /** Steps the agent took this turn (max 7), shown as the step timeline. */
  steps?: AgentStepMeta[];
  /** The person pressed Stop; the text is the part written before that. */
  stopped?: boolean;
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

/**
 * Plain text extracted from a file or long paste attached to a chat message, kept so
 * follow-up turns can use it. The file itself is never stored. UNTRUSTED: only sent to
 * the model inside <source_content>; never rendered or returned to the client.
 */
export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: id(),
    userId: userId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** pdf | docx | txt | md | code | paste */
    kind: text("kind").$type<"pdf" | "docx" | "txt" | "md" | "code" | "paste">().notNull().default("txt"),
    text: text("text").notNull(),
    chars: integer("chars").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("chat_attachments_conv_idx").on(t.conversationId, t.createdAt), index("chat_attachments_message_idx").on(t.messageId)],
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
export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type FocusSession = typeof focusSessions.$inferSelect;
export type MeetingNote = typeof meetingNotes.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type ExpenseBudget = typeof expenseBudgets.$inferSelect;
export type LearningItem = typeof learningItems.$inferSelect;
export type LearningLog = typeof learningLogs.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
export type BroadcastFile = typeof broadcastFiles.$inferSelect;
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
