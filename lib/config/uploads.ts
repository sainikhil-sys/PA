/**
 * Upload size limit from configuration (uploads.maxMb). Pure helpers; the routes read the value with
 * getConfigValue. The hosting body limit is about 4 MB, so the registry caps the setting at 4.
 */

const MB = 1024 * 1024;
/** Hosting body cap: no setting can raise a limit above this. */
export const HOSTING_MAX_BYTES = 4 * MB;

/** The configured limit in bytes, clamped to 1..4 MB; anything unreadable falls back to 4 MB. */
export function uploadLimitBytes(maxMb: unknown): number {
  const mb = typeof maxMb === "number" && Number.isFinite(maxMb) ? Math.floor(maxMb) : 4;
  return Math.min(HOSTING_MAX_BYTES, Math.max(1, mb) * MB);
}

/** A route's own limit (text files, recordings) never goes above the configured one. */
export function cappedLimit(routeMaxBytes: number, maxMb: unknown): number {
  return Math.min(routeMaxBytes, uploadLimitBytes(maxMb));
}

/** "4 MB", "512 KB": for messages. */
export function formatLimit(bytes: number): string {
  return bytes >= MB ? `${Math.round((bytes / MB) * 10) / 10} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function fileTooLargeMessage(bytes: number): string {
  return `Files up to ${formatLimit(bytes)}, please.`;
}
