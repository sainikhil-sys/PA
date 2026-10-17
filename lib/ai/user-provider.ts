import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { UserAiProvider } from "@/lib/db/schema";
import { decrypt } from "@/lib/security/crypto";
import type { ProviderConfig } from "./providers";

export { AI_PRESET_IDS, AI_PRESETS, isSafeBaseUrl, keyHint, type AiPreset } from "./presets";

export function toProviderConfig(p: UserAiProvider): ProviderConfig {
  return { name: "own", baseURL: p.baseURL.replace(/\/$/, ""), apiKey: decrypt(p.keyEnc), fastModel: p.fastModel, smartModel: p.smartModel };
}

/** The user's own provider, if they added one in Settings → Agent. */
export async function userProvider(userId: string | null | undefined): Promise<ProviderConfig | null> {
  if (!userId) return null;
  const [row] = await db().select({ p: schema.userSettings.aiProvider }).from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).limit(1);
  if (!row?.p) return null;
  try {
    return toProviderConfig(row.p);
  } catch {
    return null; // undecryptable (rotated key): fall back to the server provider
  }
}
