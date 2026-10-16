import "server-only";
import { listImportantEmails } from "@/lib/db/queries/emails";
import { needsReview } from "@/lib/db/queries/tasks";

/** Empty-state prompts based on the owner's real data. */
export async function suggestedPrompts(userId: string): Promise<string[]> {
  const [emails, review] = await Promise.all([listImportantEmails(userId, 5).catch(() => []), needsReview(userId, 3).catch(() => [])]);
  const out = ["What did I miss today?"];
  if (emails[0]) out.push(`Draft a reply to the last email from ${emails[0].fromName?.split(" ")[0] ?? emails[0].fromEmail}`);
  if (review.length) out.push("Summarize the results waiting for my review");
  out.push("What's on my calendar tomorrow?", "Add a task to review my inbox every Monday 9am", "Draft a LinkedIn post from my notes");
  return out.slice(0, 4);
}
