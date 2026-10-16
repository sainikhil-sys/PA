/** Scopes for Claude/MCP access tokens. Least privilege: nothing here can send or delete. */
export const SCOPES = {
  "tasks:read": "Read tasks and their comments",
  "tasks:write": "Create, claim and complete tasks",
  "briefing:read": "Read the daily briefing",
  "email:read": "Read email summaries (never full bodies)",
  "memory:read": "Search notes and memory",
  "memory:write": "Save notes",
} as const;

export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export function isScope(value: string): value is Scope {
  return value in SCOPES;
}

export function parseScopes(input: string | string[] | null | undefined): Scope[] {
  const parts = Array.isArray(input) ? input : (input ?? "").split(/[\s,]+/);
  return [...new Set(parts.filter(isScope))];
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}
