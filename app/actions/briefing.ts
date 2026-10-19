"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateDailyBriefing } from "@/lib/agents/briefingAgent";
import { NoProviderError } from "@/lib/ai/router";
import { ownerAction, UserFacingError } from "@/lib/auth/action";

/** Build (or rebuild) today's briefing now instead of waiting for the morning run. */
export const generateBriefingNow = ownerAction(z.object({}), async (_i, user) => {
  await generateDailyBriefing(user, { force: true }).catch((err: unknown) => {
    if (err instanceof NoProviderError) throw new UserFacingError("Connect an AI provider in Settings > Agent to generate a briefing.");
    throw err;
  });
  revalidatePath("/");
});
