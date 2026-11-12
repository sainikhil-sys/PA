"use client";

/** Same-origin JSON calls to the feed API, with the API's own message on failure. */
export async function call<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await res.json().catch(() => null)) as (T & { message?: string; error?: string }) | null;
    if (!res.ok) return { ok: false, error: json?.message ?? json?.error ?? "Something went wrong. Try again." };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "You're offline. Check your connection and try again." };
  }
}
