import { z } from "zod";

/**
 * Client configuration rules (docs/ADMIN_CONSOLE_PROPOSAL.md 4.2 and 4.4): what GET /api/config
 * returns, when the cached copy is refreshed, and which full-screen state the app shows.
 * Pure module (no React Native imports) so it is unit tested.
 */

const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  severity: z.enum(["info", "warning", "critical"]).catch("info"),
  placement: z.enum(["banner", "home_card"]).catch("banner"),
  href: z.string().nullable().catch(null),
  dismissible: z.boolean().catch(true),
});

export const clientConfigSchema = z.object({
  configVersion: z.number(),
  maintenance: z.object({ active: z.boolean(), message: z.string().nullable(), endsAt: z.string().nullable() }),
  update: z.object({
    status: z.enum(["ok", "optional", "required"]).catch("ok"),
    latestVersion: z.string().nullable(),
    message: z.string().nullable(),
    storeUrl: z.string().nullable(),
  }),
  // One malformed announcement drops itself, not the whole configuration.
  announcements: z.array(z.unknown()).transform((list) => list.flatMap((a) => {
    const r = announcementSchema.safeParse(a);
    return r.success ? [r.data] : [];
  })),
  settings: z.record(z.unknown()).catch({}),
  flags: z.record(z.boolean()).optional().catch(undefined),
  restrictions: z.array(z.object({ feature: z.string(), expiresAt: z.string().nullable() })).optional().catch(undefined),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type Announcement = ClientConfig["announcements"][number];

export function parseConfig(raw: unknown): ClientConfig | null {
  const r = clientConfigSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Refetch on return to the foreground when the copy is older than this. */
export const FOREGROUND_MAX_AGE_MS = 5 * 60_000;
/** Refetch this often while the app is open. */
export const POLL_INTERVAL_MS = 15 * 60_000;

/** True when there is no copy, or the copy is at least `maxAgeMs` old (a clock moved back counts as stale). */
export function isStale(fetchedAt: number | null, now: number, maxAgeMs: number): boolean {
  if (fetchedAt === null) return true;
  const age = now - fetchedAt;
  return age < 0 || age >= maxAgeMs;
}

/** What the device keeps between launches. Never secrets: this is the same JSON anyone signed in receives. */
export type CachedConfig = { config: ClientConfig; fetchedAt: number; dismissedUpdateVersion: string | null };

export function parseCached(text: string | null): CachedConfig | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { config?: unknown; fetchedAt?: unknown; dismissedUpdateVersion?: unknown };
    const config = parseConfig(raw.config);
    if (!config || typeof raw.fetchedAt !== "number" || !Number.isFinite(raw.fetchedAt)) return null;
    return { config, fetchedAt: raw.fetchedAt, dismissedUpdateVersion: typeof raw.dismissedUpdateVersion === "string" ? raw.dismissedUpdateVersion : null };
  } catch {
    return null;
  }
}

/** Where the configuration in memory came from: the device cache (possibly old) or the server this run. */
export type ConfigSource = "cache" | "network";

export type UpdateBlock = { message: string | null; storeUrl: string | null };
export type MaintenanceBlock = { message: string | null; endsAt: string | null };

export type Gate = { kind: "none" } | ({ kind: "update" } & UpdateBlock) | ({ kind: "maintenance" } & MaintenanceBlock);

/**
 * Which full-screen state to show.
 * - A required update wins, whether it came from a 426 or from the configuration, even a cached copy:
 *   a mandatory update that is already known still applies offline.
 * - Maintenance comes from a 503 this run, or from configuration fetched from the server this run.
 *   A cached copy never blocks the app, so being offline never locks anyone out on old data.
 */
export function decideGate(s: { config: ClientConfig | null; source: ConfigSource | null; updateRequired: UpdateBlock | null; maintenance: MaintenanceBlock | null }): Gate {
  if (s.updateRequired) return { kind: "update", ...s.updateRequired };
  if (s.config?.update.status === "required") return { kind: "update", message: s.config.update.message, storeUrl: s.config.update.storeUrl };
  if (s.maintenance) return { kind: "maintenance", ...s.maintenance };
  if (s.config && s.source === "network" && s.config.maintenance.active) {
    return { kind: "maintenance", message: s.config.maintenance.message, endsAt: s.config.maintenance.endsAt };
  }
  return { kind: "none" };
}

/** The optional-update card shows once per version: hidden after it is dismissed for that version. */
export function showOptionalUpdate(config: ClientConfig | null, dismissedVersion: string | null): boolean {
  if (!config || config.update.status !== "optional") return false;
  const v = config.update.latestVersion ?? "";
  return dismissedVersion !== v;
}

/** Announcements still to show here: the server already drops dismissed ones; this hides them at once. */
export function visibleAnnouncements(config: ClientConfig | null, dismissedIds: readonly string[]): Announcement[] {
  if (!config) return [];
  const hidden = new Set(dismissedIds);
  return config.announcements.filter((a) => !hidden.has(a.id));
}
