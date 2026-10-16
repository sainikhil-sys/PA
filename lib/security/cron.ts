import { safeEqual } from "./crypto";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Every cron route must check it. */
export function verifyCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret}`);
}

export function unauthorizedCron(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
