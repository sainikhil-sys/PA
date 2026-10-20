const SOURCE: Record<string, string> = { chat: "Chat", voice: "Voice", automation: "Automation", mcp: "Claude", claude: "Claude" };

/** Where a proposal came from, as the user knows it. */
export function sourceLabel(source: string): string {
  return SOURCE[source] ?? (source ? source.charAt(0).toUpperCase() + source.slice(1) : "Cowork");
}
