"use server";

import { z } from "zod";
import { ownerAction } from "@/lib/auth/action";
import { isAdmin } from "@/lib/auth/policy";
import { markAllRead, sendTelegram } from "@/lib/db/queries/notifications";

export const markNotificationsRead = ownerAction(z.object({}).optional(), async (_i, user) => {
  await markAllRead(user.id);
});

export const sendTestTelegram = ownerAction(z.object({}), async (_i, user) => {
  if (!isAdmin(user.email)) throw new Error("Telegram alerts are only available to admins");
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error("Telegram is not configured");
  await sendTelegram("Cowork test message: notifications are working.");
});
