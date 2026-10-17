"use server";

import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { modelFor } from "@/lib/ai/providers";
import { AI_PRESETS, isSafeBaseUrl, keyHint } from "@/lib/ai/user-provider";
import { ownerAction } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { errMessage } from "@/lib/log";
import { encrypt } from "@/lib/security/crypto";

const model = z.string().trim().min(1).max(120).regex(/^[\w./:@-]+$/, "Model names use letters, numbers, dots, dashes, slashes or colons");

/** Save the user's own AI key. It's tested with a tiny prompt first, then stored encrypted. */
export const saveAiKey = ownerAction(
  z.object({
    preset: z.enum(Object.keys(AI_PRESETS) as [keyof typeof AI_PRESETS, ...(keyof typeof AI_PRESETS)[]]),
    apiKey: z.string().trim().min(8).max(400),
    baseURL: z.string().trim().max(300).optional(),
    fastModel: model,
    smartModel: model,
  }),
  async (input, user) => {
    const baseURL = (input.preset === "custom" ? input.baseURL ?? "" : AI_PRESETS[input.preset].baseURL).replace(/\/$/, "");
    if (!isSafeBaseUrl(baseURL)) throw new Error("Use a public https:// API address");
    const config = { name: "own", baseURL, apiKey: input.apiKey, fastModel: input.fastModel, smartModel: input.smartModel };
    try {
      await generateText({ model: modelFor(config, "fast").model, prompt: "Reply with the single word: ok", maxRetries: 0, abortSignal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new Error(`That key didn't work: ${errMessage(err).slice(0, 160)}`);
    }
    await db()
      .update(schema.userSettings)
      .set({ aiProvider: { preset: input.preset, baseURL, fastModel: input.fastModel, smartModel: input.smartModel, keyEnc: encrypt(input.apiKey), keyHint: keyHint(input.apiKey), addedAt: new Date().toISOString() } })
      .where(eq(schema.userSettings.userId, user.id));
    await logActivity({ userId: user.id, actor: "me", tool: "settings.ai_key_saved", inputSummary: input.preset, outcome: "success" });
    revalidatePath("/settings/agent");
  },
);

export const removeAiKey = ownerAction(z.object({}), async (_i, user) => {
  await db().update(schema.userSettings).set({ aiProvider: null }).where(eq(schema.userSettings.userId, user.id));
  await logActivity({ userId: user.id, actor: "me", tool: "settings.ai_key_removed", outcome: "success" });
  revalidatePath("/settings/agent");
});
