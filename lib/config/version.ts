/**
 * Version strings and client headers. Pure module (no server-only imports) so it is unit tested and
 * shared by flag targeting, the update policy and the session touch.
 */

const VERSION_RE = /^v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+].*)?$/;

/** "1.2.3" as [1, 2, 3]; missing parts are 0. Null for anything that isn't a version. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  if (!v) return null;
  const m = VERSION_RE.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** -1, 0 or 1. Pre-release and build suffixes are ignored ("1.2.0-beta" equals "1.2.0"). Invalid sorts lowest. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return 0;
}

export function isVersion(v: string): boolean {
  return parseVersion(v) !== null;
}

export const CLIENT_HEADERS = {
  platform: "x-cowork-platform",
  appVersion: "x-cowork-app-version",
  build: "x-cowork-build",
  runtime: "x-cowork-runtime",
  update: "x-cowork-update",
} as const;

export type ClientPlatform = "web" | "android";

export type ClientInfo = {
  platform: ClientPlatform | null;
  appVersion: string | null;
  /** Null when the header is missing or not a number. */
  build: number | null;
  runtimeVersion: string | null;
  updateId: string | null;
};

const SAFE_TOKEN = /^[\w.\-+:]{1,64}$/;

/** Reads the X-Cowork-* headers, keeping only well-formed values. */
export function readClientHeaders(h: Pick<Headers, "get">): ClientInfo {
  const platform = h.get(CLIENT_HEADERS.platform)?.trim().toLowerCase();
  const version = h.get(CLIENT_HEADERS.appVersion)?.trim() ?? "";
  const buildRaw = h.get(CLIENT_HEADERS.build)?.trim() ?? "";
  const runtime = h.get(CLIENT_HEADERS.runtime)?.trim() ?? "";
  const update = h.get(CLIENT_HEADERS.update)?.trim() ?? "";
  const build = /^\d{1,9}$/.test(buildRaw) ? Number(buildRaw) : null;
  return {
    platform: platform === "android" || platform === "web" ? platform : null,
    appVersion: version.length <= 32 && isVersion(version) ? version : null,
    build,
    runtimeVersion: SAFE_TOKEN.test(runtime) ? runtime : null,
    updateId: SAFE_TOKEN.test(update) ? update : null,
  };
}
