/** Bring-your-own-key presets and checks. Pure (no server-only imports) so they can be unit tested. */

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
export const AI_PRESET_IDS = Object.keys(AI_PRESETS) as [AiPreset, ...AiPreset[]];

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
