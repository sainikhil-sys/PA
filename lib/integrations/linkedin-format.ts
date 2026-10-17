/**
 * LinkedIn's "little text" format treats these characters as markup; escape
 * them so the post reads exactly as approved.
 */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

/** API versions are YYYYMM and each is supported for about a year; default to ~3 months ago. */
export function linkedinVersion(now = new Date()): string {
  if (process.env.LINKEDIN_API_VERSION) return process.env.LINKEDIN_API_VERSION;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
