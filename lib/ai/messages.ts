/**
 * What people see when Cowork's AI can't answer. Never names a model, provider or internal setting:
 * the assistant is one Cowork identity (see docs/COWORK_V2_AUDIT.md, branding policy).
 * Never mentions the console or who changed a setting either.
 */
export const AI_UNAVAILABLE = "Cowork's assistant isn't available right now. Try again in a few minutes.";
export const AI_NO_RESPONSE = "Cowork didn't get an answer this time. Please try again.";

/** Capabilities the console can switch off for everyone (configuration keys ai.<capability>). */
export const AI_CAPABILITIES = ["chat", "voice", "research", "documents", "automations"] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

/** Shown when a capability is switched off. Research is a notice inside a chat answer, not a refusal of the chat. */
export const AI_FEATURE_OFF: Record<AiCapability, string> = {
  chat: "Chat with Cowork's assistant isn't available right now. Try again later.",
  voice: "Voice isn't available right now. You can type your message instead.",
  research: "Web research isn't available right now, so this answer doesn't use the web.",
  documents: "Reading documents isn't available right now. Try again later.",
  automations: "This automation uses Cowork's assistant, which isn't available for automations right now, so it didn't run.",
};

/** Shown when a person has used their daily allowance (ai.dailyTokenLimitPerUser). */
export const AI_DAILY_LIMIT = "You've reached today's limit for Cowork's assistant. It resets at midnight UTC.";
