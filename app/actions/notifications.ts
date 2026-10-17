"use server";

import { z } from "zod";
import { ownerAction } from "@/lib/auth/action";
import { markAllRead, sendTelegram } from "@/lib/db/queries/notifications";

export const markNotificationsRead = ownerAction(z.object({}).optional(), async (_i, user) => {
  await markAllRead(user.id);
});

export const sendTestTelegram = ownerAction(z.object({}), async () => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error("Telegram is not configured");
  await sendTelegram("Cowork test message: notifications are working.");
});
