import { z } from "zod";

/** Live Link panel preferences, persisted per user (user_settings.link_panel). */
export const panelPrefsSchema = z.object({
  mode: z.enum(["floating", "right", "bottom", "minimized"]).default("floating"),
  opacity: z.number().min(0.4).max(1).default(0.72),
  clickThrough: z.boolean().default(false),
  paused: z.boolean().default(false),
  followLatest: z.boolean().default(true),
  listView: z.boolean().default(false),
  x: z.number().int().min(0).max(10_000).default(24),
  y: z.number().int().min(0).max(10_000).default(88),
  w: z.number().int().min(320).max(1200).default(560),
  h: z.number().int().min(260).max(1000).default(520),
  dockWidth: z.number().int().min(320).max(420).default(380),
  activeWindowSec: z.number().int().min(5).max(120).default(15),
});
export type PanelPrefs = z.infer<typeof panelPrefsSchema>;

export function parsePrefs(raw: unknown): PanelPrefs {
  const r = panelPrefsSchema.safeParse(raw ?? {});
  return r.success ? r.data : panelPrefsSchema.parse({});
}
