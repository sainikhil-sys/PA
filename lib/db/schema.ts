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
  /** Date of birth ("YYYY-MM-DD"), set once. Decides teen protections (lib/safety/age.ts); never shown to others. */
  birthDate: date("birth_date", { mode: "string" }),
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

// ---------- Social: people, friends, person-to-person chats (Chats tab) ----------
/**
 * Opting in to Chats. A person without a row can't be found, added or messaged. The handle is
 * public to other Cowork users; the email address never is.
 */
export const socialProfiles = pgTable(
  "social_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lowercase, 3 to 24 of a-z 0-9 _ . (see lib/social/rules.ts). */
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    /** Others can find this person by handle search. Off: only people who already know them (friends). */
    searchable: boolean("searchable").notNull().default(true),
    /** Friends see "Active now" while the app is open. */
    showPresence: boolean("show_presence").notNull().default(true),
    /** Others see when their messages were read. Off also hides others' read marks from this person. */
    readReceipts: boolean("read_receipts").notNull().default(true),
    /** Lock-screen notifications show the message text. Off by default: name only. */
    pushPreview: boolean("push_preview").notNull().default(false),
    /** Followers need approval, and posts default to followers only. Always on for teens (13 to 17). */
    privateAccount: boolean("private_account").notNull().default(false),
    lastActiveAt: ts("last_active_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("social_profiles_handle_idx").on(t.handle)],
);

/**
 * One row per pair of people: a pending request or an accepted friendship. `userLow` < `userHigh`
 * (uuid order) so a pair can only have one row; `requesterId` says who asked. Declined and
 * cancelled requests are deleted.
 */
export const friendships = pgTable(
  "friendships",
  {
    id: id(),
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<"pending" | "accepted">().notNull().default("pending"),
    createdAt: createdAt(),
    respondedAt: ts("responded_at"),
  },
  (t) => [uniqueIndex("friendships_pair_idx").on(t.userLow, t.userHigh), index("friendships_high_idx").on(t.userHigh, t.status)],
);

/** A block hides both people from each other and stops direct messages either way. */
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("user_blocks_blocked_idx").on(t.blockedId)],
);

/** A person-to-person conversation: `direct` (two people) or `group`. Never mixed with AI chats. */
export const dmThreads = pgTable(
  "dm_threads",
  {
    id: id(),
    kind: text("kind").$type<"direct" | "group">().notNull(),
    /** Groups only. */
    title: text("title"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Direct only: "<low uuid>:<high uuid>", so a pair has exactly one direct thread. */
    directKey: text("direct_key"),
    lastMessageAt: ts("last_message_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dm_threads_direct_idx").on(t.directKey), index("dm_threads_last_idx").on(t.lastMessageAt)],
);

export const dmMembers = pgTable(
  "dm_members",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => dmThreads.id, { onDelete: "cascade" }),
    userId: userId(),
    role: text("role").$type<"owner" | "admin" | "member">().notNull().default("member"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    /** Set when the person leaves or is removed; they keep no access after it. */
    leftAt: ts("left_at"),
    /** Highest message seq this person's app has received. */
    deliveredSeq: bigint("delivered_seq", { mode: "number" }).notNull().default(0),
    /** Highest message seq this person has seen on screen. */
    readSeq: bigint("read_seq", { mode: "number" }).notNull().default(0),
    typingAt: ts("typing_at"),
    mutedAt: ts("muted_at"),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] }), index("dm_members_user_idx").on(t.userId)],
);

export const dmMessages = pgTable(
  "dm_messages",
  {
    id: id(),
    /** Global, increasing: the cursor for "messages since" polling and for read and delivery marks. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => dmThreads.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
    /** Made on the phone before sending, so a retried send never creates a second message. */
    clientId: text("client_id").notNull(),
    kind: text("kind").$type<"text" | "system">().notNull().default("text"),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id"),
    editedAt: ts("edited_at"),
    /** Deleted for everyone: the body is cleared and the row stays as a "Message deleted" marker. */
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("dm_messages_thread_seq_idx").on(t.threadId, t.seq),
    uniqueIndex("dm_messages_client_idx").on(t.senderId, t.clientId),
    index("dm_messages_body_fts_idx").using("gin", sql`to_tsvector('simple', ${t.body})`),
  ],
);

/** One reaction per person per kind per message. Kinds are a fixed set drawn as icons (no emoji). */
export const dmReactions = pgTable(
  "dm_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => dmMessages.id, { onDelete: "cascade" }),
    userId: userId(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.kind] })],
);

/** Reports of people or messages, reviewed in the admin console. */
export const userReports = pgTable(
  "user_reports",
  {
    id: id(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    threadId: uuid("thread_id").references(() => dmThreads.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => dmMessages.id, { onDelete: "set null" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    details: text("details"),
    /** Copy of the reported message text at report time, so deleting it later doesn't erase evidence. */
    snapshot: text("snapshot"),
    status: text("status").$type<"open" | "actioned" | "dismissed">().notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("user_reports_status_idx").on(t.status, t.createdAt)],
);

// ---------- Media (B3): files in Cloudflare R2, rows here ----------

/**
 * One uploaded file. The bytes live in a private R2 bucket under `key`; the app uploads them
 * directly with a short-lived signed link, then confirms. Nothing is readable until `status` is
 * "ready" and moderation hasn't flagged it.
 */
export const media = pgTable(
  "media",
  {
    id: id(),
    userId: userId(),
    kind: text("kind").$type<"image" | "video" | "audio">().notNull(),
    contentType: text("content_type").notNull(),
    /** Declared before upload; checked against the stored object on confirm. */
    sizeBytes: integer("size_bytes").notNull(),
    key: text("key").notNull(),
    status: text("status").$type<"uploading" | "ready" | "removed">().notNull().default("uploading"),
    moderation: text("moderation").$type<"pending" | "ok" | "flagged">().notNull().default("pending"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    readyAt: ts("ready_at"),
  },
  (t) => [uniqueIndex("media_key_idx").on(t.key), index("media_user_idx").on(t.userId, t.createdAt), index("media_status_idx").on(t.status, t.createdAt)],
);

// ---------- Social graph and posts (B4) ----------

/**
 * Following someone. Public profiles: accepted at once. Private profiles (all teens, and adults
 * who choose it): a request the person accepts.
 */
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<"accepted" | "requested">().notNull().default("accepted"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index("follows_followee_idx").on(t.followeeId, t.status)],
);

/**
 * A post. `visibility` decides who may see it; `status` is "held" while moderation reviews it
 * (only the author sees it then) and "removed" when an admin takes it down.
 */
export const posts = pgTable(
  "posts",
  {
    id: id(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    visibility: text("visibility").$type<"public" | "followers" | "friends">().notNull().default("public"),
    /** Posted in a Space: the Space's rules decide who sees it, not `visibility`. */
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    /** "announcement": only owners and moderators of the Space can post one. "poll": has a post_polls row. */
    kind: text("kind").$type<"post" | "announcement" | "poll" | "question">().notNull().default("post"),
    /** Pinned to the top of its Space by an owner or moderator. */
    pinnedAt: ts("pinned_at"),
    /** Written in an anonymous Space: shown as this pseudonym. The author is never sent to clients. */
    anonIdentityId: uuid("anon_identity_id").references(() => anonIdentities.id, { onDelete: "set null" }),
    status: text("status").$type<"published" | "held" | "removed">().notNull().default("published"),
    /** Kept up to date by the service, so feeds never count rows. */
    commentCount: integer("comment_count").notNull().default(0),
    reactionCount: integer("reaction_count").notNull().default(0),
    createdAt: createdAt(),
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("posts_author_idx").on(t.authorId, t.createdAt),
    index("posts_recent_idx").on(t.createdAt),
    index("posts_space_idx").on(t.spaceId, t.createdAt),
    index("posts_body_fts_idx").using("gin", sql`to_tsvector('simple', ${t.body})`),
  ],
);

/** Images or a video attached to a post, in order. */
export const postMedia = pgTable(
  "post_media",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.mediaId] })],
);

/** A comment, or a reply to one (`parentId`, one level deep). */
export const comments = pgTable(
  "comments",
  {
    id: id(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    anonIdentityId: uuid("anon_identity_id").references(() => anonIdentities.id, { onDelete: "set null" }),
    status: text("status").$type<"published" | "held" | "removed">().notNull().default("published"),
    createdAt: createdAt(),
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("comments_post_idx").on(t.postId, t.createdAt), index("comments_author_idx").on(t.authorId)],
);

/** One reaction per person per kind per post (the same fixed, icon-drawn set as Chats). */
export const postReactions = pgTable(
  "post_reactions",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: userId(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId, t.kind] }), index("post_reactions_user_idx").on(t.userId)],
);

/** Posts someone saved for later. Private to them. */
export const savedPosts = pgTable(
  "saved_posts",
  {
    userId: userId(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

/** "Not interested" and hidden posts: never shown to that person again. */
export const hiddenPosts = pgTable(
  "hidden_posts",
  {
    userId: userId(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

// ---------- Spaces (B5): communities ----------

export const SPACE_CATEGORIES = ["university", "professional", "gaming", "technology", "entertainment", "interest", "local", "other"] as const;

/**
 * A community. Public Spaces can be read by anyone signed in (joining is open or by request);
 * private Spaces only by members. `audience` "adults" keeps everyone under 18 out. A Space with
 * `expiresAt` is temporary and becomes read-only after that time.
 */
export const spaces = pgTable(
  "spaces",
  {
    id: id(),
    /** Lowercase, 3 to 40 of a-z 0-9 and hyphens; the Space's address. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    rules: text("rules").notNull().default(""),
    category: text("category").$type<(typeof SPACE_CATEGORIES)[number]>().notNull().default("interest"),
    visibility: text("visibility").$type<"public" | "private">().notNull().default("public"),
    joinPolicy: text("join_policy").$type<"open" | "request" | "invite">().notNull().default("open"),
    audience: text("audience").$type<"all" | "adults">().notNull().default("all"),
    /** Anonymous Space: every post and comment shows a per-Space pseudonym, never the account. Adults only. */
    anonymous: boolean("anonymous").notNull().default(false),
    /**
     * Only accounts whose sign-in email is at this domain (or a subdomain) can join, e.g. "stanford.edu".
     * Sign-in is by email code, so the account email is already proven.
     */
    emailDomain: text("email_domain"),
    status: text("status").$type<"active" | "archived" | "removed">().notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    memberCount: integer("member_count").notNull().default(0),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("spaces_slug_idx").on(t.slug), index("spaces_category_idx").on(t.category, t.memberCount), index("spaces_name_fts_idx").using("gin", sql`to_tsvector('simple', ${t.name} || ' ' || ${t.description})`)],
);

/** Membership: role, and whether it's a pending request or a ban (banned people can't rejoin). */
export const spaceMembers = pgTable(
  "space_members",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: userId(),
    role: text("role").$type<"owner" | "moderator" | "member">().notNull().default("member"),
    status: text("status").$type<"active" | "requested" | "banned">().notNull().default("active"),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] }), index("space_members_user_idx").on(t.userId, t.status)],
);

/** Invite links: a random code, optional expiry and use limit. */
export const spaceInvites = pgTable(
  "space_invites",
  {
    code: text("code").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("space_invites_space_idx").on(t.spaceId)],
);

export const spaceEvents = pgTable(
  "space_events",
  {
    id: id(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Free text: a room, an address or a link. Never geocoded. */
    location: text("location").notNull().default(""),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
  },
  (t) => [index("space_events_space_idx").on(t.spaceId, t.startsAt)],
);

export const eventRsvps = pgTable(
  "event_rsvps",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => spaceEvents.id, { onDelete: "cascade" }),
    userId: userId(),
    status: text("status").$type<"going" | "maybe" | "not_going">().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

/** A poll attached to a post (posts.kind = "poll"). Options are fixed once posted. */
export const postPolls = pgTable("post_polls", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  options: jsonb("options").$type<string[]>().notNull(),
  multiple: boolean("multiple").notNull().default(false),
  closesAt: ts("closes_at"),
});

export const pollVotes = pgTable(
  "poll_votes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => postPolls.postId, { onDelete: "cascade" }),
    userId: userId(),
    option: integer("option").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId, t.option] })],
);

/**
 * A person's pseudonym in one anonymous Space ("Quiet Heron 42"). Stable inside that Space, different
 * in every other Space, so posts can't be linked across Spaces. Which account a pseudonym belongs
 * to is readable only by the server and, through an audited console action, by admins with
 * anonymous.reveal.
 */
export const anonIdentities = pgTable(
  "anon_identities",
  {
    id: id(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: userId(),
    alias: text("alias").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("anon_identities_member_idx").on(t.spaceId, t.userId), uniqueIndex("anon_identities_alias_idx").on(t.spaceId, t.alias)],
);

export type AnonIdentity = typeof anonIdentities.$inferSelect;

export type Space = typeof spaces.$inferSelect;
export type SpaceMember = typeof spaceMembers.$inferSelect;
export type SpaceEvent = typeof spaceEvents.$inferSelect;

// ---------- Moments (B6): stories that last 24 hours ----------

/**
 * A Moment: a photo, a video, or text on a colour, for 24 hours. After `expiresAt` only its author
 * can see it (their archive); the server stops issuing media links for it to anyone else.
 * Audience: accepted followers, or only the author's close friends.
 */
export const moments = pgTable(
  "moments",
  {
    id: id(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    /** Caption, or the text of a text-only Moment. */
    body: text("body").notNull().default(""),
    /** Text-only Moments: a design token name for the background (never a raw colour). */
    background: text("background"),
    audience: text("audience").$type<"followers" | "close_friends">().notNull().default("followers"),
    status: text("status").$type<"published" | "held" | "removed">().notNull().default("published"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("moments_author_idx").on(t.authorId, t.createdAt), index("moments_expires_idx").on(t.expiresAt)],
);

/** Who saw a Moment (only its author can list them). */
export const momentViews = pgTable(
  "moment_views",
  {
    momentId: uuid("moment_id")
      .notNull()
      .references(() => moments.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.momentId, t.viewerId] })],
);

/** Replies and reactions to a Moment. Private: only the Moment's author and the sender see them. */
export const momentReplies = pgTable(
  "moment_replies",
  {
    id: id(),
    momentId: uuid("moment_id")
      .notNull()
      .references(() => moments.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"reply" | "reaction">().notNull(),
    /** The text of a reply, or the reaction kind (the fixed, icon-drawn set). */
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("moment_replies_moment_idx").on(t.momentId, t.createdAt)],
);

/** Close friends: a private list; the people on it are never told. */
export const closeFriends = pgTable(
  "close_friends",
  {
    userId: userId(),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.friendId] })],
);

export type Moment = typeof moments.$inferSelect;

// ---------- Startup network ----------

/**
 * A person's professional presentation: headline, skills, what they're open to. Separate from
 * users.role and users.bio (which belong to the private assistant). Shown on their profile only
 * to the audience they choose. Skills are lowercase tags so matching is exact.
 */
export const proProfiles = pgTable(
  "pro_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    headline: text("headline").notNull().default(""),
    about: text("about").notNull().default(""),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    interests: text("interests").array().notNull().default(sql`'{}'::text[]`),
    /** What they're open to: co-founding, collaborating, mentoring others, finding a mentor. */
    openTo: text("open_to").array().notNull().default(sql`'{}'::text[]`),
    location: text("location").notNull().default(""),
    links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
    visibility: text("visibility").$type<"everyone" | "followers" | "hidden">().notNull().default("everyone"),
    updatedAt: updatedAt(),
  },
  (t) => [index("pro_profiles_skills_idx").using("gin", t.skills), index("pro_profiles_open_idx").using("gin", t.openTo)],
);

/**
 * A startup or idea. Its discussions, pitch sessions and files live in a linked private Space
 * (created with it), so everything that works in Spaces works here.
 */
export const startups = pgTable(
  "startups",
  {
    id: id(),
    slug: text("slug").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    oneLiner: text("one_liner").notNull(),
    description: text("description").notNull().default(""),
    stage: text("stage").$type<"idea" | "prototype" | "launched" | "revenue">().notNull().default("idea"),
    industry: text("industry").notNull().default(""),
    /** Roles they're looking for, e.g. "technical co-founder". */
    lookingFor: text("looking_for").array().notNull().default(sql`'{}'::text[]`),
    skillsNeeded: text("skills_needed").array().notNull().default(sql`'{}'::text[]`),
    spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "set null" }),
    visibility: text("visibility").$type<"public" | "private">().notNull().default("public"),
    status: text("status").$type<"active" | "archived" | "removed">().notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("startups_slug_idx").on(t.slug),
    index("startups_owner_idx").on(t.ownerId),
    index("startups_skills_idx").using("gin", t.skillsNeeded),
    index("startups_text_idx").using("gin", sql`to_tsvector('simple', ${t.name} || ' ' || ${t.oneLiner} || ' ' || ${t.industry})`),
  ],
);

export const startupMembers = pgTable(
  "startup_members",
  {
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    userId: userId(),
    role: text("role").$type<"founder" | "cofounder" | "member" | "mentor" | "advisor">().notNull().default("member"),
    title: text("title").notNull().default(""),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.startupId, t.userId] }), index("startup_members_user_idx").on(t.userId)],
);

/** Someone asking to join as a co-founder, collaborator or mentor. The founders accept or decline. */
export const startupInterests = pgTable(
  "startup_interests",
  {
    id: id(),
    startupId: uuid("startup_id")
      .notNull()
      .references(() => startups.id, { onDelete: "cascade" }),
    userId: userId(),
    kind: text("kind").$type<"cofounder" | "collaborate" | "mentor">().notNull(),
    message: text("message").notNull().default(""),
    status: text("status").$type<"pending" | "accepted" | "declined" | "withdrawn">().notNull().default("pending"),
    createdAt: createdAt(),
    respondedAt: ts("responded_at"),
  },
  (t) => [index("startup_interests_startup_idx").on(t.startupId, t.status), uniqueIndex("startup_interests_open_idx").on(t.startupId, t.userId).where(sql`status = 'pending'`)],
);

export type ProProfile = typeof proProfiles.$inferSelect;
export type Startup = typeof startups.$inferSelect;

// ---------- Business network ----------

/**
 * An organization: a company that buys, supplies or partners. Verified when someone with a sign-in
 * email at its domain asks and an admin approves it in the console (decision N3). Only verified
 * organizations can post requirements or send quotes.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    industry: text("industry").notNull().default(""),
    /** What it does on Cowork: buys, supplies, looks for partners (any of them). */
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    country: text("country").notNull().default(""),
    city: text("city").notNull().default(""),
    website: text("website").notNull().default(""),
    /** The work-email domain it claims, e.g. "acme.com". */
    emailDomain: text("email_domain").notNull(),
    verification: text("verification").$type<"unverified" | "pending" | "verified" | "rejected">().notNull().default("unverified"),
    verifiedAt: ts("verified_at"),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<"active" | "suspended" | "removed">().notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug), index("organizations_verification_idx").on(t.verification, t.createdAt), index("organizations_roles_idx").using("gin", t.roles)],
);

/** People who act for an organization. Representatives can quote and message; admins also approve deals. */
export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: userId(),
    role: text("role").$type<"owner" | "admin" | "representative">().notNull().default("representative"),
    title: text("title").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("org_members_user_idx").on(t.userId)],
);

/** A verification request and its review (kept as history). */
export const orgVerifications = pgTable(
  "org_verifications",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    /** The requester's sign-in email at request time; its domain must match the organization's. */
    email: text("email").notNull(),
    note: text("note").notNull().default(""),
    status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("org_verifications_status_idx").on(t.status, t.createdAt), uniqueIndex("org_verifications_open_idx").on(t.orgId).where(sql`status = 'pending'`)],
);

/** A partnership request from one organization to another. */
export const orgPartnerships = pgTable(
  "org_partnerships",
  {
    id: id(),
    fromOrgId: uuid("from_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    toOrgId: uuid("to_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    message: text("message").notNull().default(""),
    status: text("status").$type<"pending" | "accepted" | "declined">().notNull().default("pending"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    respondedAt: ts("responded_at"),
  },
  (t) => [uniqueIndex("org_partnerships_pair_idx").on(t.fromOrgId, t.toOrgId), index("org_partnerships_to_idx").on(t.toOrgId, t.status)],
);

/** A procurement requirement (request for quotes) posted by a verified buyer. */
export const requirements = pgTable(
  "requirements",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default(""),
    quantity: text("quantity").notNull().default(""),
    /** Optional budget the buyer chooses to show, in minor units. */
    budgetMinor: bigint("budget_minor", { mode: "number" }),
    currency: text("currency").notNull().default("USD"),
    deadline: ts("deadline"),
    status: text("status").$type<"open" | "closed" | "awarded" | "cancelled">().notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("requirements_org_idx").on(t.orgId, t.createdAt), index("requirements_open_idx").on(t.status, t.createdAt)],
);

/** A supplier's quote for a requirement. The current terms; every change is a quote_versions row. */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").$type<"submitted" | "shortlisted" | "accepted" | "rejected" | "withdrawn">().notNull().default("submitted"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    deliveryDays: integer("delivery_days"),
    terms: text("terms").notNull().default(""),
    validUntil: ts("valid_until"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quotes_supplier_idx").on(t.requirementId, t.supplierOrgId), index("quotes_supplier_org_idx").on(t.supplierOrgId)],
);

export const quoteVersions = pgTable(
  "quote_versions",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    deliveryDays: integer("delivery_days"),
    terms: text("terms").notNull().default(""),
    /** Which side proposed these terms in the negotiation. */
    proposedBy: text("proposed_by").$type<"buyer" | "supplier">().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.quoteId, t.version] })],
);

/** The conversation between buyer and supplier about one quote (and its deal). */
export const quoteMessages = pgTable(
  "quote_messages",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("quote_messages_quote_idx").on(t.quoteId, t.createdAt)],
);

/**
 * A deal, opened when a buyer accepts a quote. It becomes "agreed" only after an admin of each
 * organization approves the terms (an approval record with an audit trail, not a legal signature).
 */
export const deals = pgTable(
  "deals",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** The quote version both sides are approving. */
    termsVersion: integer("terms_version").notNull(),
    status: text("status").$type<"awaiting_approval" | "agreed" | "in_progress" | "completed" | "cancelled">().notNull().default("awaiting_approval"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("deals_quote_idx").on(t.quoteId), index("deals_buyer_idx").on(t.buyerOrgId), index("deals_supplier_idx").on(t.supplierOrgId)],
);

export const dealApprovals = pgTable(
  "deal_approvals",
  {
    id: id(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    termsVersion: integer("terms_version").notNull(),
    decision: text("decision").$type<"approved" | "rejected">().notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("deal_approvals_deal_idx").on(t.dealId, t.createdAt)],
);

export const dealMilestones = pgTable(
  "deal_milestones",
  {
    id: id(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    status: text("status").$type<"pending" | "done">().notNull().default("pending"),
    doneAt: ts("done_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("deal_milestones_deal_idx").on(t.dealId)],
);

export const dealMeetings = pgTable(
  "deal_meetings",
  {
    id: id(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    /** A room, an address or a meeting link. */
    location: text("location").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
  },
  (t) => [index("deal_meetings_deal_idx").on(t.dealId, t.startsAt)],
);

export type Organization = typeof organizations.$inferSelect;
export type Deal = typeof deals.$inferSelect;

export type Media = typeof media.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;

export type SocialProfile = typeof socialProfiles.$inferSelect;
export type DmThread = typeof dmThreads.$inferSelect;
export type DmMember = typeof dmMembers.$inferSelect;
export type DmMessage = typeof dmMessages.$inferSelect;
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
