import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { UserAiProvider } from "@/lib/db/schema";
import { decrypt } from "@/lib/security/crypto";
import type { ProviderConfig } from "./providers";

/** Providers a user can bring their own key for. All speak the OpenAI chat API. */
export const AI_PRESETS = {
  openai: { label: "OpenAI (ChatGPT)", baseURL: "https://api.openai.com/v1", fastModel: "gpt-4.1-mini", smartModel: "gpt-4.1", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", fastModel: "gemini-2.5-flash", smartModel: "gemini-2.5-pro", keyUrl: "https://aistudio.google.com/apikey" },
  anthropic: { label: "Anthropic (Claude)", baseURL: "https://api.anthropic.com/v1", fastModel: "claude-haiku-5-5", smartModel: "claude-sonnet-5-5", keyUrl: "https://console.anthropic.com/settings/keys" },
  groq: { label: "Groq", baseURL: "https://api.groq.com/openai/v1", fastModel: "llama-3.1-8b-instant", smartModel: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys" },
  openrouter: { label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", fastModel: "openai/gpt-4.1-mini", smartModel: "anthropic/claude-sonnet-5-5", keyUrl: "https://openrouter.ai/keys" },
  custom: { label: "Other (OpenAI-compatible)", baseURL: "", fastModel: "", smartModel: "", keyUrl: "" },
} as const;
export type AiPreset = keyof typeof AI_PRESETS;

/** Only public HTTPS endpoints: a user-supplied URL must never reach internal addresses. */
export function isSafeBaseUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\[?[0-9a-f:]+\]?$/.test(h)) return false;
  if (/^(\d+\.){3}\d+$/.test(h)) return false; // raw IPs (incl. 10.x, 127.x, 169.254.x, 192.168.x)
  return h.includes(".");
}

export function keyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : "…";
}

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
