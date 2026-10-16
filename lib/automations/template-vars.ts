import { truncate } from "@/lib/security/sanitize";

/** Fill {{placeholders}} from the trigger event / previous step outputs. Plain text only. */
export function fillTemplate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => truncate(String(vars[k] ?? ""), k === "agent_output" ? 1500 : 200));
}
