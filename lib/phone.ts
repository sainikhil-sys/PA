/** Phone link: pure helpers shared by the API and the UI (no server-only imports, unit tested). */

export type PhoneEventKind = "call" | "sms" | "whatsapp" | "notification";

const WHATSAPP = new Set(["com.whatsapp", "com.whatsapp.w4b"]);
const DIALERS = new Set(["com.google.android.dialer", "com.android.dialer", "com.samsung.android.incallui", "com.android.incallui", "com.android.server.telecom", "com.samsung.android.dialer", "com.oneplus.dialer", "com.miui.voip", "com.android.phone"]);
const SMS = new Set(["com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging", "com.oneplus.mms", "com.miui.mms"]);

/** Android's Notification.category ("call", "msg", ...) wins when the app sends one. */
export function classifyPhoneEvent(pkg: string, category?: string | null): PhoneEventKind {
  if (WHATSAPP.has(pkg)) return "whatsapp";
  if (category === "call" || category === "missed_call" || DIALERS.has(pkg)) return "call";
  if (SMS.has(pkg)) return "sms";
  return "notification";
}

/** Readable 6-character pairing code (no 0/O/1/I to avoid typos). */
export const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function normalizePairCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function isPairCode(code: string): boolean {
  return code.length === 6 && [...code].every((c) => PAIR_ALPHABET.includes(c));
}

/**
 * Link that opens WhatsApp. A phone number in international format (+country code) in the title
 * opens that chat; otherwise it opens WhatsApp itself. Messages are never sent for you.
 */
export function whatsappLink(title: string): string {
  const digits = title.replace(/[^\d+]/g, "");
  const n = digits.replace(/^\+/, "");
  return title.trim().startsWith("+") && /^\d{8,15}$/.test(n) && digits.length >= title.replace(/\s/g, "").length - 2 ? `https://wa.me/${n}` : "https://wa.me/";
}

/** "Tel" link for a caller shown as a number; contact names can't be dialed from here. */
export function callBackLink(title: string): string | null {
  const t = title.replace(/[\s()-]/g, "");
  return /^\+?\d{6,15}$/.test(t) ? `tel:${t}` : null;
}

export const KIND_LABEL: Record<PhoneEventKind, string> = { call: "Call", sms: "SMS", whatsapp: "WhatsApp", notification: "App" };
