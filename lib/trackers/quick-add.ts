import { addDays, isValidIsoDate, todayIn, weekday } from "./dates";
import { type CategoryId, guessCategory, toMinor } from "./money";

/**
 * One-line expense entry (pure, unit-tested). Examples:
 *   "120 coffee"                          -> 120.00 in the default currency, food, today
 *   "450.50 groceries at DMart yesterday" -> groceries, merchant DMart, yesterday
 *   "$12 lunch at Subway friday"          -> 12.00 USD, the most recent Friday
 */
export type ParsedExpense = {
  amountMinor: number;
  currency: string;
  category: CategoryId;
  merchant: string;
  note: string;
  spentOn: string;
};

const SYMBOLS: Record<string, string> = { "₹": "INR", rs: "INR", "rs.": "INR", $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
const CODES = ["INR", "USD", "EUR", "GBP", "JPY", "AED", "SGD", "AUD", "CAD", "CHF"];
const DAYS: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

function tidy(s: string): string {
  return s.replace(/\s{2,}/g, " ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").trim();
}

export function parseExpenseLine(
  input: string,
  opts: { timezone: string; defaultCurrency: string; now?: Date },
): { ok: true; value: ParsedExpense } | { ok: false; error: string } {
  const today = todayIn(opts.timezone, opts.now);
  let text = ` ${input.trim()} `;

  // Date words first so "at DMart yesterday" leaves just the merchant.
  let spentOn = today;
  const iso = /\s(\d{4}-\d{2}-\d{2})(?=\s)/.exec(text);
  const rel = /\s(?:on\s+)?(today|yesterday|day before yesterday)(?=[\s,.]|$)/i.exec(text);
  const day = /\s(last\s+|on\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)(?=[\s,.]|$)/i.exec(text);
  if (iso && iso[1]! <= today && isValidIsoDate(iso[1]!)) {
    spentOn = iso[1]!;
    text = text.replace(iso[0], " ");
  } else if (rel) {
    const w = rel[1]!.toLowerCase();
    spentOn = w === "today" ? today : addDays(today, w === "yesterday" ? -1 : -2);
    text = text.replace(rel[0], " ");
  } else if (day) {
    const target = DAYS[day[2]!.toLowerCase()]!;
    let back = (weekday(today) - target + 7) % 7;
    if (back === 0 && day[1]?.trim().toLowerCase() === "last") back = 7;
    spentOn = addDays(today, -back);
    text = text.replace(day[0], " ");
  }

  // Currency: a symbol stuck to the amount, or a code anywhere.
  let currency = opts.defaultCurrency;
  const code = new RegExp(`\\s(${CODES.join("|")})(?=\\s)`, "i").exec(text);
  if (code) {
    currency = code[1]!.toUpperCase();
    text = text.replace(code[0], " ");
  }

  const amt = /\s(₹|rs\.?|\$|€|£|¥)?\s?(\d[\d,]*(?:\.\d+)?)(?=\s)/i.exec(text);
  if (!amt) return { ok: false, error: "Start with an amount, like 120 coffee." };
  if (amt[1]) currency = SYMBOLS[amt[1].toLowerCase()] ?? currency;
  text = text.replace(amt[0], " ");
  const amountMinor = toMinor(amt[2]!, currency);
  if (amountMinor === null) return { ok: false, error: "That amount doesn't look right." };

  // Merchant: whatever follows "at" or "@".
  let merchant = "";
  const at = /\s(?:at|@)\s+(.+)$/i.exec(text);
  if (at) {
    merchant = tidy(at[1]!).slice(0, 80);
    text = text.slice(0, at.index);
  }

  const note = tidy(text).slice(0, 200);
  return { ok: true, value: { amountMinor, currency, category: guessCategory(`${note} ${merchant}`), merchant, note, spentOn } };
}
