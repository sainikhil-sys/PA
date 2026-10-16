"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { draftReply } from "@/lib/agents/emailAgent";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { logActivity } from "@/lib/db/queries/activity";
import { getEmail } from "@/lib/db/queries/emails";
import { createTask } from "@/lib/db/queries/tasks";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { processJobs } from "@/lib/jobs/handlers";
import { enqueue } from "@/lib/jobs/queue";
import { NoProviderError } from "@/lib/ai/router";
import { Trace } from "@/lib/trace";

const uuid = z.string().uuid();

/** Creates a Gmail DRAFT for review. Nothing is ever sent. */
export const generateDraftAction = ownerAction(z.object({ id: uuid, instructions: z.string().max(500).optional() }), async ({ id, instructions }, user) => {
  const email = await getEmail(user.id, id);
  if (!email) throw new UserFacingError("That email is no longer available.");
  const trace = new Trace(user.id, "chat", "manual");
  try {
    const res = await trace.span("output:draft", "Drafting a reply", () => draftReply(user, email, instructions), () => ({ label: "Draft reply created in Gmail", status: "waiting" }));
    await logActivity({ userId: user.id, actor: "agent", tool: "gmail.draft_created", inputSummary: `email=${id}`, outcome: "success" });
    revalidatePath("/inbox");
    revalidatePath("/");
    return { draftId: res.draftId };
  } catch (err) {
    if (err instanceof GoogleNotConnectedError || err instanceof NoProviderError) throw new UserFacingError(err.message);
    throw err;
  }
});

export const makeTaskFromEmailAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  const email = await getEmail(user.id, id);
  if (!email) throw new UserFacingError("That email is no longer available.");
  const task = await createTask(user.id, {
    title: `Follow up: ${email.subject}`.slice(0, 200),
    description: email.summary ?? email.snippet,
    createdBy: "me",
    sourceEmailId: email.id,
    priority: email.category === "URGENT" ? 3 : 2,
  });
  revalidatePath("/tasks");
  revalidatePath("/");
  return { id: task.id };
});

export const syncInboxNowAction = ownerAction(z.object({}), async (_i, user) => {
  await enqueue(user.id, "sync_inbox", {}, { dedupeKey: `sync:${user.id}:manual:${Math.floor(Date.now() / 60_000)}` });
  const result = await processJobs({ budgetMs: 45_000, types: ["sync_inbox", "classify_emails"] });
  revalidatePath("/inbox");
  return result;
});
