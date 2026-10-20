"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { getSettings } from "@/lib/db/queries/settings";
import { isValidIsoDate, todayIn } from "@/lib/trackers/dates";
import { CATEGORY_IDS, CURRENCY_RE, MAX_AMOUNT_MINOR } from "@/lib/trackers/money";
import {
  createExpense,
  createLearningItem,
  deleteExpense,
  deleteLearningItem,
  logLearningTime,
  setBudget,
  TrackerError,
  updateExpense,
  updateLearningItem,
} from "@/lib/trackers/queries";
import { parseExpenseLine } from "@/lib/trackers/quick-add";

const uuid = z.string().uuid();
const currency = z.string().regex(CURRENCY_RE, "Pick a currency");
const amountMinor = z.number().int("Amount must be a whole number of minor units").positive("Enter an amount above zero").max(MAX_AMOUNT_MINOR, "That amount is too large");
const isoDate = z.string().refine(isValidIsoDate, "Pick a valid date");
const category = z.enum(CATEGORY_IDS);
const kind = z.enum(["course", "book", "skill", "video", "other"]);
const status = z.enum(["planned", "active", "paused", "done"]);
const url = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Links must start with https://");

function wrap(err: unknown): never {
  if (err instanceof TrackerError) throw new UserFacingError(err.message);
  throw err;
}

/** Dates after today (in the user's timezone) are a typo more often than not. */
async function notFuture(userId: string, date: string) {
  const { timezone } = await getSettings(userId);
  if (date > todayIn(timezone)) throw new UserFacingError("That date is in the future.");
}

// ---------- Money ----------

const expenseFields = z.object({
  amountMinor,
  currency,
  category,
  merchant: z.string().trim().max(80).default(""),
  note: z.string().trim().max(200).default(""),
  spentOn: isoDate,
});

/** "450.50 groceries at DMart yesterday": parsed on the server in the user's timezone. */
export const quickAddExpenseAction = ownerAction(z.object({ text: z.string().trim().min(1, "Type an amount and what it was for").max(200), currency }), async ({ text, currency: fallback }, user) => {
  const { timezone } = await getSettings(user.id);
  const parsed = parseExpenseLine(text, { timezone, defaultCurrency: fallback });
  if (!parsed.ok) throw new UserFacingError(parsed.error);
  const row = await createExpense(user.id, parsed.value);
  revalidatePath("/trackers/money");
  return { id: row.id, ...parsed.value };
});

export const createExpenseAction = ownerAction(expenseFields, async (input, user) => {
  await notFuture(user.id, input.spentOn);
  const row = await createExpense(user.id, input);
  revalidatePath("/trackers/money");
  return { id: row.id };
});

export const updateExpenseAction = ownerAction(expenseFields.extend({ id: uuid }), async ({ id, ...input }, user) => {
  await notFuture(user.id, input.spentOn);
  await updateExpense(user.id, id, input).catch(wrap);
  revalidatePath("/trackers/money");
});

export const deleteExpenseAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await deleteExpense(user.id, id);
  revalidatePath("/trackers/money");
});

/** monthlyMinor null removes the budget. */
export const setBudgetAction = ownerAction(z.object({ category, currency, monthlyMinor: amountMinor.nullable() }), async (input, user) => {
  await setBudget(user.id, input.category, input.currency, input.monthlyMinor);
  revalidatePath("/trackers/money");
});

// ---------- Learning ----------

// No .default() here: zod 4 applies defaults inside .partial(), which would wipe notes on a status change.
const itemFields = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  kind,
  url,
  notes: z.string().trim().max(5000),
  targetDate: isoDate.nullable(),
});

export const createLearningItemAction = ownerAction(itemFields, async (input, user) => {
  const row = await createLearningItem(user.id, { ...input, url: input.url || null });
  revalidatePath("/trackers/learning");
  return { id: row.id };
});

export const updateLearningItemAction = ownerAction(
  itemFields.partial().extend({ id: uuid, status: status.optional(), progress: z.number().int().min(0).max(100).optional() }),
  async ({ id, url: link, ...patch }, user) => {
    await updateLearningItem(user.id, id, { ...patch, ...(link !== undefined ? { url: link || null } : {}) }).catch(wrap);
    revalidatePath("/trackers/learning");
  },
);

export const deleteLearningItemAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await deleteLearningItem(user.id, id);
  revalidatePath("/trackers/learning");
});

export const logLearningTimeAction = ownerAction(
  z.object({ itemId: uuid, minutes: z.number().int().min(1, "Log at least a minute").max(1440, "A day has 1440 minutes"), loggedOn: isoDate, note: z.string().trim().max(500).default("") }),
  async (input, user) => {
    await notFuture(user.id, input.loggedOn);
    await logLearningTime(user.id, input.itemId, input.minutes, input.loggedOn, input.note).catch(wrap);
    revalidatePath("/trackers/learning");
  },
);
