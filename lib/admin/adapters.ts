import "server-only";
import type { z } from "zod";
import { errorJson, isSameOrigin, json } from "@/lib/security/request";
import { runOp, type OpDef, type OpFailure } from "./op";

/** What web server actions return. `code` lets the client react (step_up_required, confirm_required). */
export type AdminActionResult<R> = { ok: true; data: R } | { ok: false; error: string; code: string; confirm?: OpFailure["confirm"] };

/** Server action adapter: the console's buttons call this; it only runs the shared op. */
export function adminAction<S extends z.ZodType, R>(def: OpDef<S, R>) {
  return async (input: z.input<S>, confirmToken?: string): Promise<AdminActionResult<R>> => {
    const r = await runOp(def, input, { platform: "web", confirmToken: confirmToken ?? null });
    if (r.ok) return r;
    // A signed-in person without a role sees the same message as a missing action.
    return { ok: false, error: r.error, code: r.code, ...(r.confirm ? { confirm: r.confirm } : {}) };
  };
}

/** Header that carries a confirmation token on the commit call of a destructive operation. */
export const CONFIRM_HEADER = "x-cowork-confirm";

/**
 * Route handler adapter for /api/admin/*. GET reads input from the query string, other methods from a
 * JSON body. Cookie requests that change state must be same-origin (CSRF); the app's Bearer requests
 * can't be forged by a browser. Responses never include secrets: only what the op returns.
 */
export function adminRoute<S extends z.ZodType, R>(def: OpDef<S, R>, method: "GET" | "POST" | "PATCH" | "DELETE") {
  return async (req: Request, ctx?: { params?: Promise<Record<string, string>> }): Promise<Response> => {
    if (req.method !== method) return errorJson(405, "Method not allowed", { code: "method_not_allowed" });
    const bearer = /^Bearer /.test(req.headers.get("authorization") ?? "");
    if (method !== "GET" && !bearer && !isSameOrigin(req)) return errorJson(403, "forbidden", { code: "forbidden" });
    const params = ctx?.params ? await ctx.params : {};
    let body: unknown = {};
    if (method === "GET") {
      body = Object.fromEntries(new URL(req.url).searchParams);
    } else {
      if (Number(req.headers.get("content-length") ?? 0) > 256 * 1024) return errorJson(413, "That request is too large.", { code: "too_large" });
      const text = await req.text();
      if (text.length > 256 * 1024) return errorJson(413, "That request is too large.", { code: "too_large" });
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          return errorJson(400, "Send a JSON body.", { code: "invalid_input" });
        }
      }
    }
    const input = body && typeof body === "object" && !Array.isArray(body) ? { ...(body as object), ...params } : body;
    const r = await runOp(def, input, { platform: bearer ? "android" : "web", confirmToken: req.headers.get(CONFIRM_HEADER) });
    if (r.ok) return json({ data: r.data }, { headers: { "cache-control": "no-store" } });
    if (r.status === 404) return new Response("Not found", { status: 404 });
    return errorJson(r.status, r.error, { code: r.code, ...(r.confirm ? { confirm: r.confirm } : {}) });
  };
}
