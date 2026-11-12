import * as Application from "expo-application";
import { buildClientHeaders } from "./client-headers";
import { API_URL } from "./config";

/** An HTTP failure with the server's own message when it sent one, plus its machine `code` and body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly data: unknown = null,
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

/**
 * Full-screen states the server can put the app in: 426 update_required and 503 maintenance
 * (docs/ADMIN_CONSOLE_PROPOSAL.md 4.4). Wired once by the config store, like configureAuth.
 */
export type GateBody = { message: string | null; storeUrl?: string | null; endsAt?: string | null };
type GateSink = { updateRequired: (b: GateBody) => void; maintenance: (b: GateBody) => void };
let gate: GateSink = { updateRequired: () => {}, maintenance: () => {} };
export function configureGate(sink: GateSink) {
  gate = sink;
}

/** The machine `code` of an error body, if any. */
export function codeOf(body: unknown): string | null {
  const c = body && typeof body === "object" ? (body as { code?: unknown }).code : null;
  return typeof c === "string" ? c : null;
}

/** For every transport: report a 426 or a maintenance 503 so the app shows its full-screen state. */
export function reportGate(status: number, body: unknown) {
  const code = codeOf(body);
  const b = (body && typeof body === "object" ? body : {}) as { message?: unknown; storeUrl?: unknown; endsAt?: unknown };
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (status === 426 && code === "update_required") gate.updateRequired({ message: str(b.message), storeUrl: str(b.storeUrl) });
  else if (status === 503 && code === "maintenance") gate.maintenance({ message: str(b.message), endsAt: str(b.endsAt) });
}

/** Version and platform headers, the same for the life of the install. */
const CLIENT_HEADERS = buildClientHeaders(Application.nativeApplicationVersion, Application.nativeBuildVersion);

/** Headers every request to the Cowork API carries: the version headers, then the session. */
export function authHeaders(): Record<string, string> {
  const t = auth.token();
  return t ? { ...CLIENT_HEADERS, Authorization: `Bearer ${t}` } : { ...CLIENT_HEADERS };
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

/** A sentence for people from an error body: known codes are translated, raw codes never shown. */
export function messageFrom(body: unknown, status: number): string {
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
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; form?: FormData; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
      headers: { Accept: "application/json", ...(init.form ? {} : init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...authHeaders(), ...init.headers },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, OFFLINE);
  }
  const body: unknown = await res.json().catch(() => null);
  const code = codeOf(body);
  // Admin routes also answer 401 for an ended admin session or a wrong admin code; the person is still
  // signed in then, so only "unauthorized" (no session) from those routes signs the app out.
  const sessionEnded = !path.startsWith("/api/admin/") || code === "unauthorized";
  if (res.status === 401 && auth.token() && sessionEnded) auth.onUnauthorized();
  reportGate(res.status, body);
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status), code, body);
  return body as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if ((err as Error)?.name === "AbortError") return "Stopped.";
  return "Something went wrong. Please try again.";
}
