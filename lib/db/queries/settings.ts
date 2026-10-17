import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { DEFAULT_AGENT, type AgentSettings, type UserSettings } from "@/lib/db/schema";

/** Memoized per request (React cache) so cards on one page share a single settings read. */
export const getSettings = cache(loadSettings);

async function loadSettings(userId: string): Promise<UserSettings> {
  const s = await db().query.userSettings.findFirst({ where: eq(schema.userSettings.userId, userId) });
  if (s) return { ...s, agent: { ...DEFAULT_AGENT, ...s.agent, capabilities: { ...DEFAULT_AGENT.capabilities, ...s.agent?.capabilities } } };
  const [created] = await db().insert(schema.userSettings).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await db().query.userSettings.findFirst({ where: eq(schema.userSettings.userId, userId) }))!;
}

export type SettingsPatch = Partial<Omit<UserSettings, "userId" | "updatedAt" | "agent">> & { agent?: Partial<AgentSettings> };

export async function updateSettings(userId: string, patch: SettingsPatch) {
  const current = await getSettings(userId);
  const { agent, ...rest } = patch;
  await db()
    .update(schema.userSettings)
    .set({ ...rest, ...(agent ? { agent: { ...current.agent, ...agent, capabilities: { ...current.agent.capabilities, ...agent.capabilities } } } : {}) })
    .where(eq(schema.userSettings.userId, userId));
}

export async function getIntegration(userId: string, provider: string) {
  return db().query.integrations.findFirst({
    where: and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, provider)),
  });
}

export async function listIntegrations(userId: string) {
  const rows = await db()
    .select({
      provider: schema.integrations.provider,
      status: schema.integrations.status,
      accountLabel: schema.integrations.accountLabel,
      scopes: schema.integrations.scopes,
      lastSyncAt: schema.integrations.lastSyncAt,
      lastError: schema.integrations.lastError,
    })
    .from(schema.integrations)
    .where(eq(schema.integrations.userId, userId));
  return rows;
}

export async function getGoogleStatus(userId: string) {
  const a = await getIntegration(userId, "google");
  if (!a || a.status === "disconnected") return { connected: false as const };
  return { connected: a.status === "connected", email: a.accountLabel, scopes: a.scopes, lastSyncAt: a.lastSyncAt, lastError: a.lastError };
}
