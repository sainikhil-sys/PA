"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { updateSettings } from "@/lib/db/queries/settings";
import { isValidTimezone } from "@/lib/time";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const tz = z.string().refine(isValidTimezone, "Unknown timezone");

export const saveProfile = ownerAction(
  z.object({
    name: z.string().trim().min(1, "Add your name").max(80),
    role: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(1000).optional(),
    timezone: tz.optional(),
    language: z.string().max(10).optional(),
    dateFormat: z.enum(["MMM d, yyyy", "d MMM yyyy", "yyyy-MM-dd", "MM/dd/yyyy"]).optional(),
    timeFormat: z.enum(["12h", "24h"]).optional(),
  }),
  async (input, user) => {
    await db().update(schema.users).set({ name: input.name, role: input.role ?? null, bio: input.bio ?? null }).where(eq(schema.users.id, user.id));
    const { name: _n, role: _r, bio: _b, ...settings } = input;
    if (Object.keys(settings).length) await updateSettings(user.id, settings);
    revalidatePath("/", "layout");
  },
);

const agentSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  avatar: z.enum(["orb", "ring", "spark", "leaf"]).optional(),
  personality: z.enum(["concise", "warm", "formal", "coach"]).optional(),
  customInstructions: z.string().max(2000).optional(),
  language: z.string().max(10).optional(),
  responseLength: z.enum(["short", "medium", "detailed"]).optional(),
  voice: z.string().max(100).optional(),
  speechRate: z.number().min(0.5).max(2).optional(),
  proactivity: z.enum(["ask", "nudge", "proactive"]).optional(),
  capabilities: z
    .object({
      readEmail: z.boolean(),
      createDrafts: z.boolean(),
      manageTasks: z.boolean(),
      runAutomations: z.boolean(),
      searchKnowledge: z.boolean(),
    })
    .partial()
    .optional(),
});

export const saveAgentSettings = ownerAction(agentSchema, async (input, user) => {
  await updateSettings(user.id, { agent: input as never });
  revalidatePath("/settings/agent");
});

export const savePreferences = ownerAction(
  z.object({
    briefingTime: hhmm.optional(),
    newsTopics: z.array(z.string().max(30)).max(12).optional(),
    quietHoursStart: hhmm.nullable().optional(),
    quietHoursEnd: hhmm.nullable().optional(),
    notifyInApp: z.boolean().optional(),
    notifyEmailDigest: z.boolean().optional(),
    notifyTelegram: z.boolean().optional(),
    fontScale: z.enum(["sm", "md", "lg"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    reduceMotion: z.boolean().optional(),
    automationsPaused: z.boolean().optional(),
  }),
  async (input, user) => {
    await updateSettings(user.id, input);
    if (input.automationsPaused !== undefined) {
      await logActivity({ userId: user.id, actor: "me", tool: input.automationsPaused ? "automations.paused" : "automations.resumed", outcome: "success" });
    }
    revalidatePath("/", "layout");
  },
);

export const completeOnboarding = ownerAction(z.object({}), async (_i, user) => {
  await db().update(schema.users).set({ onboardedAt: new Date() }).where(eq(schema.users.id, user.id));
  revalidatePath("/", "layout");
});
