"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { logActivity } from "@/lib/db/queries/activity";
import { createApiToken, revokeApiToken } from "@/lib/db/queries/tokens";
import { ALL_SCOPES } from "@/lib/security/scopes";

/** Creates a hashed MCP token; the raw value is returned once and never stored. */
export const createTokenAction = ownerAction(
  z.object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1, "Pick at least one scope"),
    expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()]),
  }),
  async (input, user) => {
    const { token, record } = await createApiToken(user.id, { name: input.name, scopes: input.scopes as never, expiresInDays: input.expiresInDays });
    await logActivity({ userId: user.id, actor: "me", tool: "token.created", inputSummary: `${input.name} (${input.scopes.length} scopes)`, outcome: "success" });
    revalidatePath("/settings/claude");
    return { token, id: record.id };
  },
);

export const revokeTokenAction = ownerAction(z.object({ id: z.string().uuid() }), async ({ id }, user) => {
  const ok = await revokeApiToken(user.id, id);
  if (!ok) throw new UserFacingError("Token not found or already revoked.");
  await logActivity({ userId: user.id, actor: "me", tool: "token.revoked", inputSummary: `id=${id}`, outcome: "success" });
  revalidatePath("/settings/claude");
});
