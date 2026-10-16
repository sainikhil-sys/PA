/** Exponential backoff with a cap: 30s, 60s, 120s, ... up to 1 hour. */
export function backoffMs(attempts: number, baseMs = 30_000, capMs = 3_600_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempts - 1));
}

export function nextRunAt(attempts: number, now = Date.now()): Date {
  return new Date(now + backoffMs(attempts));
}

/** True when a failed attempt should be retried rather than marked permanently failed. */
export function shouldRetry(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts;
}
