import { API_URL } from "./config";

/** An HTTP failure with the server's own message when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isOffline() {
    return this.status === 0;
  }
}

type TokenSource = { token: () => string | null; onUnauthorized: () => void };
let auth: TokenSource = { token: () => null, onUnauthorized: () => {} };

/** Wired once by the session store, so this module stays free of React and storage. */
export function configureAuth(source: TokenSource) {
  auth = source;
}

/** For transports outside api() (the chat stream): report a rejected session the same way. */
export function reportUnauthorized() {
  if (auth.token()) auth.onUnauthorized();
}

export function authHeaders(): Record<string, string> {
  const t = auth.token();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const OFFLINE = "You're offline. Check your connection and try again.";

/** Machine codes some routes return as `error`; never shown to people as-is. */
const CODES: Record<string, string> = {
  rate_limited: "Too many requests. Wait a moment and try again.",
  forbidden: "That isn't allowed from the app.",
  unauthorized: "Your session ended. Sign in again.",
  invalid_request: "Something in that request wasn't valid. Please try again.",
  "invalid id": "That item no longer exists.",
  "not found": "That item no longer exists.",
};

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.error === "string" && b.error) {
      if (CODES[b.error]) return CODES[b.error]!;
      // Sentences written for people pass through; anything that looks like a code does not.
      if (/\s/.test(b.error) && /^[A-Z]/.test(b.error)) return b.error;
    }
  }
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "Cowork is having trouble right now. Try again in a minute.";
  return "Something went wrong. Please try again.";
}

/** JSON request to the Cowork API. 401 signs the app out (expired or revoked session). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
      headers: { Accept: "application/json", ...(init.form ? {} : init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, OFFLINE);
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401 && auth.token()) auth.onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status));
  return body as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if ((err as Error)?.name === "AbortError") return "Stopped.";
  return "Something went wrong. Please try again.";
}
