"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { getSettings, updateSettings } from "@/lib/db/queries/settings";
import { panelPrefsSchema } from "@/lib/flow/prefs";
import { invalidateFlowStatus } from "@/lib/flow/server";

export const saveLinkPanelPrefs = ownerAction(panelPrefsSchema.partial(), async (prefs, user) => {
  const s = await getSettings(user.id);
  await updateSettings(user.id, { linkPanel: { ...s.linkPanel, ...prefs } });
});

/**
 * On/off from the panel, only where it's safe: these map to the owner's own
 * capability / include / pause switches. Nothing here deletes or disconnects.
 */
const TOGGLES = ["gmail", "tasks", "knowledge", "output:draft", "input:automation", "drive", "notion", "slack", "github"] as const;

export const toggleFlowNode = ownerAction(z.object({ node: z.enum(TOGGLES), enabled: z.boolean() }), async ({ node, enabled }, user) => {
  const s = await getSettings(user.id);
  const caps = s.agent.capabilities;
  if (node === "gmail") await updateSettings(user.id, { agent: { capabilities: { ...caps, readEmail: enabled } } });
  else if (node === "tasks") await updateSettings(user.id, { agent: { capabilities: { ...caps, manageTasks: enabled } } });
  else if (node === "knowledge") await updateSettings(user.id, { agent: { capabilities: { ...caps, searchKnowledge: enabled } } });
  else if (node === "output:draft") await updateSettings(user.id, { agent: { capabilities: { ...caps, createDrafts: enabled } } });
  else if (node === "input:automation") await updateSettings(user.id, { automationsPaused: !enabled });
  else {
    const src = await db().query.knowledgeSources.findFirst({ where: and(eq(schema.knowledgeSources.userId, user.id), eq(schema.knowledgeSources.type, node)) });
    if (!src) throw new UserFacingError("Add this source on the Knowledge page first.");
    await db().update(schema.knowledgeSources).set({ included: enabled }).where(eq(schema.knowledgeSources.id, src.id));
  }
  invalidateFlowStatus(user.id);
  await logActivity({ userId: user.id, actor: "me", tool: "flow.toggle", inputSummary: `${node}=${enabled ? "on" : "off"}`, outcome: "success" });
  revalidatePath("/", "layout");
});
