import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { getSession } from "@/lib/auth/session";
import { db, type DB } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { errMessage, log } from "@/lib/log";
import { randomToken } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/ratelimit";
import { getAdminSession, type AdminSession } from "./admin-session";
import { writeAudit } from "./audit";
import { consumeConfirmation, issueConfirmation } from "./confirm";
import { emailHash, ipPrefix, OWNER_FRESH_MS } from "./core";
import { can, type AdminRole, type Permission } from "./permissions";
import { getAdminRole } from "./roles";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type OpCtx = {
  user: User;
  role: AdminRole;
  adminSession: AdminSession;
  userSessionId: string;
  platform: "web" | "android";
  /** The transaction the change and its audit row share (or the plain connection when `transaction: false`). */
  tx: Tx | DB;
  /** What the audit row should say about the change. Call once, from inside run. */
  record: (r: { resourceId?: string | null; before?: unknown; after?: unknown; reason?: string | null }) => void;
};

export type OpDef<S extends z.ZodType, R> = {
  /** Audit action name, e.g. "user.suspend". Also the name in the route inventory. */
  action: string;
  resourceType: string;
  permission: Permission;
  input: S;
  /** "destructive" needs a one-time confirmation token bound to the exact input (prepare, then commit). */
  risk?: "normal" | "destructive";
  /** Plain description shown before a destructive commit, e.g. "Suspend ana@... and sign them out of 3 devices". */
  summary?: (input: z.infer<S>, user: User) => Promise<string> | string;
  /** Reads are not audited. Writes always are. */
  kind: "read" | "write";
  /** Default true for writes. False when run calls slow external services (AI, mail) and must not hold a transaction. */
  transaction?: boolean;
  /** Owner-only sensitive operations: the step-up must be under 10 minutes old. */
  freshStepUp?: boolean;
  run: (input: z.infer<S>, ctx: OpCtx) => Promise<R>;
};

export type OpFailure = { ok: false; status: 400 | 401 | 403 | 404 | 409 | 429 | 500; code: string; error: string; confirm?: { summary: string; token: string } };
export type OpResult<R> = { ok: true; data: R } | OpFailure;

const fail = (status: OpFailure["status"], code: string, error: string, extra: Partial<OpFailure> = {}): OpFailure => ({ ok: false, status, code, error, ...extra });

/** Every admin operation is declared once with this and run through the same checks, whatever the client. */
export function adminOp<S extends z.ZodType, R>(def: OpDef<S, R>): OpDef<S, R> {
  if (def.risk === "destructive" && !def.summary) throw new Error(`${def.action}: destructive operations need a summary`);
  return def;
}

/**
 * The request pipeline (docs/ADMIN_CONSOLE_PROPOSAL.md 2.5):
 * session -> role (else 404) -> admin session (else 401 step_up_required) -> permission (else 403, audited)
 * -> input (else 400) -> rate limit -> confirmation for destructive ops (409) -> transaction with audit row.
 */
export async function runOp<S extends z.ZodType, R>(def: OpDef<S, R>, rawInput: unknown, opts: { platform: "web" | "android"; confirmToken?: string | null }): Promise<OpResult<R>> {
  const session = await getSession();
  if (!session) return fail(401, "unauthorized", "Your session ended. Sign in again.");
  const user = session.user;
  const role = await getAdminRole(user);
  if (!role) return fail(404, "not_found", "Not found");
  const adminSession = await getAdminSession();
  if (!adminSession) return fail(401, "step_up_required", "Your admin session ended. Unlock the console to continue.");

  const h = await headers();
  const meta = { ipPrefix: ipPrefix(h.get("x-forwarded-for")?.split(",")[0]?.trim()), userAgent: h.get("user-agent"), requestId: h.get("x-vercel-id") ?? randomToken(9) };
  const actor = { actorUserId: user.id, actorEmailHash: emailHash(user.email), actorRole: role, adminSessionId: adminSession.id, ...meta };

  if (!can(role, def.permission)) {
    await writeAudit({ ...actor, action: def.action, resourceType: def.resourceType, outcome: "denied", reason: `missing ${def.permission}` }).catch(() => {});
    return fail(403, "forbidden", "Your role can't do this.");
  }
  if (def.freshStepUp && Date.now() - adminSession.createdAt.getTime() > OWNER_FRESH_MS) {
    return fail(401, "step_up_required", "This needs a fresh unlock. Lock the console and unlock it again, then retry.");
  }
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the input and try again.");
  const input = parsed.data as z.infer<S>;
  if (!(await rateLimit("admin", user.id)).success) return fail(429, "rate_limited", "You're going a little fast. Try again in a moment.");

  if (def.risk === "destructive") {
    if (!opts.confirmToken) {
      let summary: string;
      try {
        summary = await def.summary!(input, user);
      } catch (err) {
        if (err instanceof UserFacingError) return fail(400, "rejected", err.message);
        log.error("admin.op_summary_failed", { action: def.action, error: errMessage(err) });
        return fail(500, "error", "Something went wrong. Nothing was changed. Try again.");
      }
      const token = await issueConfirmation(user.id, def.action, input);
      return fail(409, "confirm_required", summary, { confirm: { summary, token } });
    }
    if (!(await consumeConfirmation(user.id, def.action, input, opts.confirmToken))) {
      return fail(409, "confirm_invalid", "That confirmation expired or doesn't match. Start again.");
    }
  }

  let recorded: Parameters<OpCtx["record"]>[0] = {};
  const record: OpCtx["record"] = (r) => {
    recorded = r;
  };
  const audit = (executor?: Tx | DB) =>
    writeAudit({ ...actor, action: def.action, resourceType: def.resourceType, resourceId: recorded.resourceId ?? null, before: recorded.before, after: recorded.after, reason: recorded.reason ?? null, outcome: "success" }, executor);

  try {
    if (def.kind === "read") {
      return { ok: true, data: await def.run(input, { user, role, adminSession, userSessionId: session.sessionId, platform: opts.platform, tx: db(), record }) };
    }
    if (def.transaction === false) {
      const data = await def.run(input, { user, role, adminSession, userSessionId: session.sessionId, platform: opts.platform, tx: db(), record });
      await audit();
      return { ok: true, data };
    }
    const data = await db().transaction(async (tx) => {
      const out = await def.run(input, { user, role, adminSession, userSessionId: session.sessionId, platform: opts.platform, tx, record });
      await audit(tx);
      return out;
    });
    return { ok: true, data };
  } catch (err) {
    const userFacing = err instanceof UserFacingError;
    if (def.kind === "write") {
      await writeAudit({ ...actor, action: def.action, resourceType: def.resourceType, resourceId: recorded.resourceId ?? null, outcome: "failed", reason: userFacing ? err.message : "error" }).catch(() => {});
    }
    if (userFacing) return fail(400, "rejected", err.message);
    log.error("admin.op_failed", { action: def.action, error: errMessage(err) });
    return fail(500, "error", def.transaction === false ? "Something went wrong. Check what happened before you try again." : "Something went wrong. Nothing was changed. Try again.");
  }
}
