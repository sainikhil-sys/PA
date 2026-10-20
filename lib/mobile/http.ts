import "server-only";

/** Shared bits for the Android app's endpoints under /api/mobile. */
export const noStore = { "cache-control": "no-store" } as const;

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function fail(status: number, message: string): Response {
  return Response.json({ ok: false, message }, { status, headers: noStore });
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
