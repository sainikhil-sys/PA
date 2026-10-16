/** Pure helpers for voice (unit tested). */

/** Strip markdown and citations so text reads naturally aloud. */
export function toSpeakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(\d{1,2})\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spoken answers stay short: the first couple of sentences, capped. Long content stays on screen. */
export function spokenSummary(markdown: string, maxSentences = 2, maxChars = 280): { text: string; truncated: boolean } {
  const plain = toSpeakable(markdown);
  const sentences = plain.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [plain];
  let out = sentences.slice(0, maxSentences).join("").trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  return { text: out, truncated: out.length < plain.length };
}

export type ConfirmReply = "yes" | "no" | null;

/** Interpret a spoken reply to "Shall I do it?". */
export function parseConfirmation(transcript: string): ConfirmReply {
  const t = transcript.toLowerCase().trim();
  if (/^(yes|yeah|yep|sure|confirm|do it|go ahead|ok(ay)?|please do|approve)\b/.test(t)) return "yes";
  if (/^(no|nope|cancel|stop|don'?t|never mind|dismiss)\b/.test(t)) return "no";
  return null;
}
