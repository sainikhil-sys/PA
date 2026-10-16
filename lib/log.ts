import { redactSecrets } from "@/lib/security/sanitize";

/**
 * Structured JSON logging. NEVER pass email bodies, tokens, API keys or prompts.
 * String fields are run through secret redaction as a safety net.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) safe[k] = typeof v === "string" ? redactSecrets(v).slice(0, 500) : v;
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

export function errMessage(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}
