export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** SWR fetcher: JSON, same-origin, throws on non-2xx. */
export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!res.ok) {
    let message = "Request failed";
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {}
    throw new FetchError(message, res.status);
  }
  return res.json() as Promise<T>;
}
