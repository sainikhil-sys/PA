import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { getSettings, updateSettings } from "@/lib/db/queries/settings";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** Where Cowork may reach you, and quiet hours (same settings as the website's notification preferences). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const s = await getSettings(g.user.id);
  return Response.json(
    {
      notifyPush: s.notifyPush,
      notifyInApp: s.notifyInApp,
      notifyEmail: s.notifyEmail,
      notifyEmailDigest: s.notifyEmailDigest,
      quietHoursStart: s.quietHoursStart,
      quietHoursEnd: s.quietHoursEnd,
      timezone: s.timezone,
    },
    { headers: noStore },
  );
}

const patchSchema = z
  .object({
    notifyPush: z.boolean().optional(),
    notifyInApp: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
    notifyEmailDigest: z.boolean().optional(),
    quietHoursStart: hhmm.nullable().optional(),
    quietHoursEnd: hhmm.nullable().optional(),
  })
  // Quiet hours need both ends or neither.
  .refine((p) => (p.quietHoursStart === undefined) === (p.quietHoursEnd === undefined) && (p.quietHoursStart === null) === (p.quietHoursEnd === null), "Set both a start and an end for quiet hours.");

export async function PATCH(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Please check your input.");
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length) await updateSettings(g.user.id, patch);
  return Response.json({ ok: true }, { headers: noStore });
}
