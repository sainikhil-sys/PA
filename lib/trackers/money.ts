/**
 * Money helpers (pure, no server imports, unit-tested). Amounts are always
 * integers in the currency's minor unit, so sums are exact. Different
 * currencies are never added together.
 */

/** Largest single amount we accept, in minor units. */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

/** Currencies offered in the picker. Any valid ISO 4217 code is still accepted on the server. */
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "JPY", "AED", "SGD", "AUD", "CAD", "CHF"] as const;

export const CURRENCY_RE = /^[A-Z]{3}$/;

export const CATEGORIES = [
  { id: "food", label: "Food and drinks", words: ["coffee", "tea", "lunch", "dinner", "breakfast", "snack", "snacks", "cafe", "restaurant", "food", "pizza", "burger", "swiggy", "zomato", "starbucks", "chai", "biryani", "meal"] },
  { id: "groceries", label: "Groceries", words: ["grocery", "groceries", "vegetables", "veggies", "fruits", "milk", "dmart", "bigbasket", "blinkit", "zepto", "supermarket", "instamart"] },
  { id: "transport", label: "Transport", words: ["uber", "ola", "rapido", "taxi", "cab", "auto", "metro", "bus", "train", "fuel", "petrol", "diesel", "parking", "toll"] },
  { id: "shopping", label: "Shopping", words: ["amazon", "flipkart", "myntra", "clothes", "shoes", "shirt", "shopping", "gift", "gadget"] },
  { id: "bills", label: "Bills and rent", words: ["rent", "electricity", "water", "internet", "wifi", "broadband", "phone", "mobile", "recharge", "bill", "bills", "gas", "subscription", "netflix", "spotify", "emi", "insurance"] },
  { id: "health", label: "Health", words: ["doctor", "medicine", "medicines", "pharmacy", "hospital", "gym", "dentist", "clinic", "health", "apollo"] },
  { id: "fun", label: "Fun", words: ["movie", "movies", "cinema", "concert", "game", "games", "party", "drinks", "beer", "bar", "pvr"] },
  { id: "travel", label: "Travel", words: ["flight", "hotel", "trip", "travel", "airbnb", "booking", "visa", "holiday"] },
  { id: "learning", label: "Learning", words: ["course", "book", "books", "udemy", "coursera", "class", "tuition", "fees", "workshop"] },
  { id: "other", label: "Other", words: [] },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** Best guess from free text; "other" when nothing matches. */
export function guessCategory(text: string): CategoryId {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    const direct = CATEGORIES.find((c) => c.id === w);
    if (direct) return direct.id;
  }
  for (const c of CATEGORIES) {
    if (c.words.some((k) => words.includes(k))) return c.id;
  }
  return "other";
}

/** Minor-unit digits of a currency from Intl (INR 2, USD 2, JPY 0). */
export function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Fixed locale per currency so server and client render the same string. */
function localeFor(currency: string): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

/** 45050 INR -> "₹450.50"; 1500 JPY -> "¥1,500". */
export function formatMoney(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(localeFor(currency), { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** Plain decimal string for inputs and CSV: 45050 INR -> "450.50", 1500 JPY -> "1500". */
export function fromMinor(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const base = 10 ** digits;
  return `${sign}${Math.floor(abs / base)}.${String(abs % base).padStart(digits, "0")}`;
}

/**
 * Parses "450.50", "1,200" or "1200" into minor units without floating point.
 * Returns null for anything that isn't a positive amount within the limit, or
 * that has more decimals than the currency allows.
 */
export function toMinor(input: string, currency: string): number | null {
  const s = input.trim().replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const digits = fractionDigits(currency);
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > digits) return null;
  const minor = Number(m[1]) * 10 ** digits + (frac ? Number(frac.padEnd(digits, "0")) : 0);
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** Sums rows per currency, never mixing currencies. Sorted by currency code. */
export function totalsByCurrency(rows: { amountMinor: number; currency: string }[]): { currency: string; minor: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amountMinor);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor }));
}
