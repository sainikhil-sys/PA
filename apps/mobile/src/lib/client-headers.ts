/**
 * The version headers every app request carries (docs/ADMIN_CONSOLE_PROPOSAL.md 4.1). The server uses
 * them for the update policy (426), flag targeting and the version adoption chart.
 * Pure module (no Expo imports) so it is unit tested.
 */

export const CLIENT_HEADER = {
  platform: "X-Cowork-Platform",
  appVersion: "X-Cowork-App-Version",
  build: "X-Cowork-Build",
} as const;

const SAFE_VERSION = /^[\w.+-]{1,64}$/;

/**
 * Headers for this install. A missing or malformed version is left out rather than sent as junk; the
 * build goes as a whole number (Android's version code) or not at all.
 */
export function buildClientHeaders(appVersion: string | null | undefined, build: string | number | null | undefined): Record<string, string> {
  const out: Record<string, string> = { [CLIENT_HEADER.platform]: "android" };
  const v = appVersion?.trim();
  if (v && SAFE_VERSION.test(v)) out[CLIENT_HEADER.appVersion] = v;
  const n = typeof build === "number" ? build : build != null && /^\s*\d+\s*$/.test(build) ? Number(build) : NaN;
  if (Number.isSafeInteger(n) && n >= 0) out[CLIENT_HEADER.build] = String(n);
  return out;
}
