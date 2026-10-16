import type { AgentSettings } from "@/lib/db/schema";

export const PERSONALITIES = [
  { id: "concise", label: "Concise", sample: "Two replies due. Want drafts?", prompt: "Be brief and direct. Lead with the answer. No filler." },
  { id: "warm", label: "Warm", sample: "Morning! Two people are waiting on you — shall I draft replies?", prompt: "Be warm and encouraging, while staying efficient." },
  { id: "formal", label: "Formal", sample: "You have two replies outstanding. Shall I prepare drafts?", prompt: "Be formal, precise and courteous." },
  { id: "coach", label: "Coach", sample: "Two replies due. Knock them out first, then deep work?", prompt: "Act like a supportive coach: suggest priorities and next steps." },
] as const;

const LENGTH = { short: "Keep answers under 80 words unless asked.", medium: "Keep answers under 200 words.", detailed: "Give thorough, well-structured answers." };

/** System prompt fragment describing the agent's persona (trusted, owner-configured). */
export function personaPrompt(agent: AgentSettings, ownerName: string | null): string {
  const p = PERSONALITIES.find((x) => x.id === agent.personality) ?? PERSONALITIES[0];
  return [
    `You are ${agent.name}, the personal assistant of ${ownerName ?? "the owner"}.`,
    p.prompt,
    LENGTH[agent.responseLength],
    agent.language && agent.language !== "en" ? `Reply in language code "${agent.language}".` : "",
    agent.customInstructions ? `Owner's instructions: ${agent.customInstructions.slice(0, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The things the agent can never do, shown in Settings and enforced in code. */
export const NEVER_DO = ["Send email or messages", "Post publicly", "Delete anything", "Spend money or make payments"];
