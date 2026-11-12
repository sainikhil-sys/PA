import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { setBirthDate } from "@/lib/safety/birthdate";

export const dynamic = "force-dynamic";

/**
 * PUT { birthDate: "YYYY-MM-DD" }: set once. 200 { ageGroup }; 400 invalid; 409 already set;
 * 403 { code: "under_age" } means the account was deleted and the app should sign out.
 */
export async function PUT(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ birthDate: z.string().trim().max(10) }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Enter your date of birth.");
  const r = await setBirthDate(g.user, parsed.data.birthDate);
  if (!r.ok) return Response.json({ ok: false, message: r.message, code: r.code }, { status: r.status, headers: noStore });
  return Response.json({ ageGroup: r.group }, { headers: noStore });
}
