import { z } from "zod";
import type { Permission } from "@/lib/admin/permissions";

/**
 * Every configuration key Cowork knows (docs/ADMIN_CONSOLE_PROPOSAL.md 4.1). Pure module: no server
 * imports, so it is unit tested and the console can render forms from it.
 *
 * - Unknown keys are rejected on write and ignored on read.
 * - A stored value that no longer matches its schema reads as the default.
 * - Values are data only: never HTML, scripts or links to code.
 */

export type ConfigScope = "public" | "server";
export type ConfigRisk = "normal" | "destructive";

/** How the console edits a value. The zod schema stays the authority; this only picks the inputs. */
export type ConfigField =
  | { kind: "boolean"; on?: string; off?: string }
  | { kind: "tristate"; nullLabel: string; on: string; off: string }
  | { kind: "integer"; min: number; max: number; unit?: string; nullable?: boolean; nullLabel?: string }
  | { kind: "text"; max: number; multiline?: boolean; nullable?: boolean }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  | { kind: "datetime"; nullable: true }
  | { kind: "object"; fields: readonly { name: string; label: string; field: ConfigField }[] }
  | { kind: "json"; hint: string };

export type ConfigGroup = "access" | "uploads" | "maintenance" | "appearance" | "ai" | "connect" | "notifications" | "updates";

export const CONFIG_GROUPS: readonly { id: ConfigGroup; label: string; note?: string }[] = [
  { id: "access", label: "Access" },
  { id: "uploads", label: "Uploads" },
  { id: "maintenance", label: "Maintenance", note: "Owner only. Turning it on stops the app for everyone except admins." },
  { id: "appearance", label: "Appearance", note: "Choices are limited to what ships in the app. No colours or custom styles." },
  { id: "ai", label: "AI" },
  { id: "connect", label: "Connect" },
  { id: "notifications", label: "Notification defaults", note: "Defaults for new accounts. People can change their own settings." },
  { id: "updates", label: "App updates", note: "Edited on the Releases page." },
];

type EntryBase<T> = {
  key: string;
  group: ConfigGroup;
  label: string;
  description: string;
  schema: z.ZodType<T>;
  default: T;
  scope: ConfigScope;
  /** Permission needed to change it. */
  permission: Permission;
  risk: ConfigRisk;
  /** Audit redaction: stored as "[redacted]" in before/after. */
  secret?: boolean;
  personal?: boolean;
  /** What reads it today, or null when nothing does yet (shown in the console so nobody expects an effect). */
  readBy: string | null;
  field: ConfigField;
  /** Edited only through its own console card (maintenance, update policy), not the generic editor. */
  dedicated?: boolean;
};

export type ConfigEntry<T = unknown> = EntryBase<T>;

function entry<T>(e: EntryBase<T>): ConfigEntry<T> {
  return e;
}

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !/[<>]/.test(s), "Plain text only, without < or >.");

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url("Use a full link that starts with https://")
  .refine((u) => u.startsWith("https://"), "Use a link that starts with https://");

// ---------- Update policy ----------

export const updatePolicySchema = z
  .object({
    /** Builds below this get 426 Upgrade Required. 0 means no minimum. */
    minBuild: z.number().int().min(0).max(1_000_000_000),
    latestVersion: z
      .string()
      .trim()
      .max(32)
      .regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, "Use a version like 1.2.0")
      .nullable(),
    latestBuild: z.number().int().min(1).max(1_000_000_000).nullable(),
    /** "required" makes the latest build the minimum. */
    mode: z.enum(["optional", "required"]),
    message: plainText(300).nullable(),
    storeUrl: httpsUrl.nullable(),
  })
  .refine((p) => p.mode === "optional" || p.latestBuild !== null, { message: "A required update needs the latest build number.", path: ["latestBuild"] });

export type UpdatePolicy = z.infer<typeof updatePolicySchema>;

export const DEFAULT_UPDATE_POLICY: UpdatePolicy = { minBuild: 0, latestVersion: null, latestBuild: null, mode: "optional", message: null, storeUrl: null };

/** The build every app request must reach: the minimum, or the latest one when the update is required. */
export function effectiveMinBuild(p: UpdatePolicy): number {
  return p.mode === "required" && p.latestBuild ? Math.max(p.minBuild, p.latestBuild) : p.minBuild;
}

/** What the app should show. A missing build header counts as build 0 (proposal 4.3). */
export function updateStatus(p: UpdatePolicy, build: number | null): "ok" | "optional" | "required" {
  const b = build ?? 0;
  if (b < effectiveMinBuild(p)) return "required";
  if (p.latestBuild && b < p.latestBuild) return "optional";
  return "ok";
}

// ---------- AI price table (console estimates only) ----------

export const priceTableSchema = z
  .record(
    z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\w.\-/:]+$/, "Model ids use letters, numbers and . - / : only"),
    z.object({ inputPerMillion: z.number().min(0).max(10_000), outputPerMillion: z.number().min(0).max(10_000) }).strict(),
  )
  .refine((r) => Object.keys(r).length <= 100, "Up to 100 models.");

// ---------- The registry ----------

const boolField = { kind: "boolean", on: "On", off: "Off" } as const;

export const CONFIG_ENTRIES: readonly ConfigEntry[] = [
  // Access
  entry<boolean | null>({
    key: "registration.open",
    group: "access",
    label: "New sign-ups",
    description: "Whether new people can create an account. Closed stops new accounts only: existing accounts still sign in. Follow server setting uses SIGNUP_MODE.",
    schema: z.boolean().nullable(),
    default: null,
    scope: "public",
    permission: "config.write",
    risk: "normal",
    readBy: "Sign-in (email code requests and checks)",
    field: { kind: "tristate", nullLabel: "Follow server setting", on: "Open", off: "Closed" },
  }),

  // Uploads
  entry<number>({
    key: "uploads.maxMb",
    group: "uploads",
    label: "Largest upload",
    description: "Largest file people can attach or add to Knowledge. The hosting limit is about 4 MB.",
    schema: z.number().int().min(1).max(4),
    default: 4,
    scope: "public",
    permission: "config.write",
    risk: "normal",
    readBy: "Chat attachments, Knowledge uploads and voice recordings",
    field: { kind: "integer", min: 1, max: 4, unit: "MB" },
  }),

  // Maintenance (owner only; edited through the maintenance card)
  entry<boolean>({
    key: "maintenance.active",
    group: "maintenance",
    label: "Maintenance mode",
    description: "When on, people see a maintenance screen and the API answers 503. Admins still get in.",
    schema: z.boolean(),
    default: false,
    scope: "server",
    permission: "maintenance.write",
    risk: "destructive",
    readBy: "API guard, server actions and the web app layout",
    field: boolField,
    dedicated: true,
  }),
  entry<string | null>({
    key: "maintenance.message",
    group: "maintenance",
    label: "Maintenance message",
    description: "Shown on the maintenance screen.",
    schema: plainText(300).nullable(),
    default: null,
    scope: "server",
    permission: "maintenance.write",
    risk: "destructive",
    readBy: "Maintenance screen and 503 responses",
    field: { kind: "text", max: 300, multiline: true, nullable: true },
    dedicated: true,
  }),
  entry<string | null>({
    key: "maintenance.endsAt",
    group: "maintenance",
    label: "Expected end",
    description: "When you expect to finish. Sent as Retry-After.",
    schema: z.string().datetime({ offset: true }).nullable(),
    default: null,
    scope: "server",
    permission: "maintenance.write",
    risk: "destructive",
    readBy: "Maintenance screen and 503 responses",
    field: { kind: "datetime", nullable: true },
    dedicated: true,
  }),
  entry<boolean>({
    key: "maintenance.pauseJobs",
    group: "maintenance",
    label: "Pause background jobs",
    description: "Stops the job dispatcher: no automations, briefings or mail sync until it is off.",
    schema: z.boolean(),
    default: false,
    scope: "server",
    permission: "maintenance.write",
    risk: "destructive",
    readBy: "Job dispatcher",
    field: boolField,
    dedicated: true,
  }),

  // Appearance
  entry<"system" | "light" | "dark">({
    key: "appearance.defaultScheme",
    group: "appearance",
    label: "Default colour scheme",
    description: "The scheme the app starts with before someone picks their own.",
    schema: z.enum(["system", "light", "dark"]),
    default: "system",
    scope: "public",
    permission: "appearance.write",
    risk: "normal",
    readBy: null,
    field: {
      kind: "choice",
      options: [
        { value: "system", label: "Follow the device" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
  }),
  entry<string | null>({
    key: "appearance.loginNotice",
    group: "appearance",
    label: "Sign-in notice",
    description: "A short line shown on the sign-in screen.",
    schema: plainText(200).nullable(),
    default: null,
    scope: "public",
    permission: "appearance.write",
    risk: "normal",
    readBy: null,
    field: { kind: "text", max: 200, nullable: true },
  }),
  entry<string | null>({
    key: "appearance.onboardingNotice",
    group: "appearance",
    label: "Onboarding notice",
    description: "A short line shown during first-run setup.",
    schema: plainText(200).nullable(),
    default: null,
    scope: "public",
    permission: "appearance.write",
    risk: "normal",
    readBy: null,
    field: { kind: "text", max: 200, nullable: true },
  }),

  // AI capability switches and limits (edited on the AI page; ai.write). Product switches: admins are not exempt.
  ...(
    [
      ["chat", "Chat", 'The assistant chat. Off answers with a plain "not available right now" message.', "Chat API and every chat turn"],
      ["voice", "Voice", 'Speaking to the assistant and hearing replies. Off answers with a plain "not available right now" message.', "Voice transcription and speech APIs, spoken chat turns"],
      ["research", "Research", "Web research in chat. Off: chat still answers, without the web, and says so.", "Chat turns that plan a web search"],
      ["documents", "Document analysis", 'Reading attached documents and Knowledge files. Off answers with a plain "not available right now" message.', "Chat attachments, Knowledge uploads, chat turns with a document"],
      ["automations", "Automations", "Automations that use AI don't run while this is off, and say why. Automations without AI steps keep running.", "Automation runs, test runs and re-runs"],
    ] as const
  ).map(([k, label, description, readBy]) =>
    entry<boolean>({
      key: `ai.${k}`,
      group: "ai",
      label,
      description,
      schema: z.boolean(),
      default: true,
      scope: "public",
      permission: "ai.write",
      risk: "normal",
      readBy,
      field: boolField,
    }),
  ),
  entry<number | null>({
    key: "ai.dailyTokenLimitPerUser",
    group: "ai",
    label: "Daily AI limit per person",
    description: "Tokens one person can use per day (UTC) on the server's AI. Calls on their own key don't count. Empty means no limit.",
    schema: z.number().int().min(1000).max(100_000_000).nullable(),
    default: null,
    scope: "server",
    permission: "ai.write",
    risk: "normal",
    readBy: "AI router, before every call on the server's AI",
    field: { kind: "integer", min: 1000, max: 100_000_000, unit: "tokens", nullable: true, nullLabel: "No limit" },
  }),
  entry<z.infer<typeof priceTableSchema>>({
    key: "ai.priceTable",
    group: "ai",
    label: "Price table",
    description: "Price per million tokens by model, in US dollars. Used for cost estimates in the console only.",
    schema: priceTableSchema,
    default: {},
    scope: "server",
    permission: "ai.write",
    risk: "normal",
    readBy: "Cost estimates on the AI console page",
    field: { kind: "json", hint: '{ "model-id": { "inputPerMillion": 0.5, "outputPerMillion": 1.5 } }' },
  }),

  // Connect
  ...(
    [
      ["discovery", "Nearby discovery", "Finding people nearby."],
      ["messaging", "Messaging", "Offline messages."],
      ["files", "File sharing", "Sending files to people nearby."],
      ["walkie", "Walkie", "Push to talk."],
      ["calls", "Calls", "Offline voice calls."],
    ] as const
  ).map(([k, label, description]) =>
    entry<boolean>({
      key: `connect.${k}`,
      group: "connect",
      label,
      description: `${description} Phones apply it at their next config fetch.`,
      schema: z.boolean(),
      default: true,
      scope: "public",
      permission: "config.write",
      risk: "normal",
      readBy: null,
      field: boolField,
    }),
  ),
  entry<number>({
    key: "connect.fileMaxMb",
    group: "connect",
    label: "Largest Connect file",
    description: "Largest file one person can send to another nearby.",
    schema: z.number().int().min(1).max(2048),
    default: 100,
    scope: "public",
    permission: "config.write",
    risk: "normal",
    readBy: null,
    field: { kind: "integer", min: 1, max: 2048, unit: "MB" },
  }),
  entry<number>({
    key: "connect.groupMaxSize",
    group: "connect",
    label: "Largest Connect group",
    description: "Most people in one Connect group or call.",
    schema: z.number().int().min(2).max(64),
    default: 8,
    scope: "public",
    permission: "config.write",
    risk: "normal",
    readBy: null,
    field: { kind: "integer", min: 2, max: 64, unit: "people" },
  }),

  // Notification defaults for new accounts
  ...(
    [
      ["inApp", "In-app notifications", true],
      ["push", "Push notifications", true],
      ["email", "Email alerts", true],
      ["emailDigest", "Email digest", true],
    ] as const
  ).map(([k, label, def]) =>
    entry<boolean>({
      key: `notifications.default.${k}`,
      group: "notifications",
      label,
      description: `Whether ${label.toLowerCase()} start on for a new account.`,
      schema: z.boolean(),
      default: def,
      scope: "server",
      permission: "config.write",
      risk: "normal",
      readBy: "New account settings",
      field: boolField,
    }),
  ),

  // Update policy (edited on the Releases page; delivered as the "update" block of /api/config)
  entry<UpdatePolicy>({
    key: "updates.android",
    group: "updates",
    label: "Android update policy",
    description: "Minimum supported build, latest version and the update message.",
    schema: updatePolicySchema,
    default: DEFAULT_UPDATE_POLICY,
    scope: "server",
    permission: "releases.write",
    risk: "normal",
    readBy: "API guard (426 for older builds) and /api/config",
    field: {
      kind: "object",
      fields: [
        { name: "minBuild", label: "Minimum build", field: { kind: "integer", min: 0, max: 1_000_000_000 } },
        { name: "latestVersion", label: "Latest version", field: { kind: "text", max: 32, nullable: true } },
        { name: "latestBuild", label: "Latest build", field: { kind: "integer", min: 1, max: 1_000_000_000, nullable: true, nullLabel: "Not set" } },
        {
          name: "mode",
          label: "Latest update is",
          field: {
            kind: "choice",
            options: [
              { value: "optional", label: "Optional" },
              { value: "required", label: "Required" },
            ],
          },
        },
        { name: "message", label: "Message", field: { kind: "text", max: 300, multiline: true, nullable: true } },
        { name: "storeUrl", label: "Store link", field: { kind: "text", max: 500, nullable: true } },
      ],
    },
    dedicated: true,
  }),
];

export const CONFIG: ReadonlyMap<string, ConfigEntry> = new Map(CONFIG_ENTRIES.map((e) => [e.key, e]));

export function configEntry(key: string): ConfigEntry | undefined {
  return CONFIG.get(key);
}

/** The value to use for a stored row: the parsed value, or the default when it no longer validates. */
export function parseStored(key: string, raw: unknown): unknown {
  const e = CONFIG.get(key);
  if (!e) return undefined;
  const r = e.schema.safeParse(raw);
  return r.success ? r.data : e.default;
}

export type WriteCheck = { ok: true; entry: ConfigEntry; value: unknown } | { ok: false; error: string };

/** Validates a write against the registry: unknown keys and values that fail the schema are rejected. */
export function validateWrite(key: string, value: unknown): WriteCheck {
  const e = CONFIG.get(key);
  if (!e) return { ok: false, error: "That setting doesn't exist." };
  const r = e.schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${e.label}: ${where}${issue?.message ?? "not a valid value"}` };
  }
  return { ok: true, entry: e, value: r.data };
}

/** Builds a key->value map from stored rows: unknown keys ignored, invalid values replaced by defaults. */
export function resolveValues(rows: readonly { key: string; value: unknown }[]): Map<string, unknown> {
  const out = new Map<string, unknown>(CONFIG_ENTRIES.map((e) => [e.key, e.default]));
  for (const r of rows) if (CONFIG.has(r.key)) out.set(r.key, parseStored(r.key, r.value));
  return out;
}

/** Public settings for clients, nested by key ("uploads.maxMb" -> { uploads: { maxMb } }). */
export function publicSettings(values: ReadonlyMap<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of CONFIG_ENTRIES) {
    if (e.scope !== "public") continue;
    const parts = e.key.split(".");
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = values.has(e.key) ? values.get(e.key) : e.default;
  }
  return out;
}

/** Audit copy of a value: secret or personal keys are never stored in the audit log. */
export function auditValue(entry: ConfigEntry, value: unknown): unknown {
  return entry.secret || entry.personal ? "[redacted]" : value;
}

/** Notification settings a new account starts with (notifications.default.*). Existing accounts keep theirs. */
export function notificationDefaultsFrom(values: ReadonlyMap<string, unknown>) {
  const on = (k: string) => values.get(`notifications.default.${k}`) !== false;
  return { notifyInApp: on("inApp"), notifyPush: on("push"), notifyEmail: on("email"), notifyEmailDigest: on("emailDigest") };
}

export type Maintenance = { active: boolean; message: string | null; endsAt: string | null; pauseJobs: boolean };

export function maintenanceFrom(values: ReadonlyMap<string, unknown>): Maintenance {
  return {
    active: values.get("maintenance.active") === true,
    message: (values.get("maintenance.message") as string | null) ?? null,
    endsAt: (values.get("maintenance.endsAt") as string | null) ?? null,
    pauseJobs: values.get("maintenance.pauseJobs") === true,
  };
}

export const DEFAULT_MAINTENANCE_MESSAGE = "Cowork is down for maintenance. Try again in a little while.";

/** Seconds for Retry-After: until endsAt (at least a minute, at most a day), or five minutes. */
export function retryAfterSeconds(endsAt: string | null, now = Date.now()): number {
  if (!endsAt) return 300;
  const s = Math.ceil((new Date(endsAt).getTime() - now) / 1000);
  if (!Number.isFinite(s)) return 300;
  return Math.min(86_400, Math.max(60, s));
}

/**
 * Which permission and risk a change needs. Maintenance and pausing jobs are owner-only and need a
 * confirmation. Raising the minimum app build, or making the latest update required, is owner-only
 * (releases.mandatory) with a confirmation; other update policy edits need releases.write.
 */
export function classifyChange(key: string, next: unknown, prev: unknown): { permission: Permission; risk: ConfigRisk } | null {
  const e = CONFIG.get(key);
  if (!e) return null;
  if (key === "updates.android") {
    const n = updatePolicySchema.safeParse(next);
    const p = updatePolicySchema.safeParse(prev);
    const before = p.success ? effectiveMinBuild(p.data) : 0;
    const after = n.success ? effectiveMinBuild(n.data) : 0;
    return after > before ? { permission: "releases.mandatory", risk: "destructive" } : { permission: "releases.write", risk: "normal" };
  }
  return { permission: e.permission, risk: e.risk };
}
