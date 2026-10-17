/** External AI agents a user can hand tasks to, using their own API keys. Pure, client-safe. */
export const AGENT_CONNECTORS = {
  chatgpt: { name: "ChatGPT", logo: "openai", preset: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4.1", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { name: "Gemini", logo: "googlegemini", preset: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro", keyUrl: "https://aistudio.google.com/apikey" },
  claude: { name: "Claude", logo: "claude", preset: "anthropic", baseURL: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", keyUrl: "https://console.anthropic.com/settings/keys" },
} as const;

export type AgentProvider = keyof typeof AGENT_CONNECTORS;
export const AGENT_PROVIDERS = Object.keys(AGENT_CONNECTORS) as [AgentProvider, ...AgentProvider[]];

export function isAgentProvider(v: unknown): v is AgentProvider {
  return typeof v === "string" && v in AGENT_CONNECTORS;
}
