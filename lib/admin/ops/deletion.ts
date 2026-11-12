import "server-only";
import { deleteAccountData } from "@/lib/auth/delete-account";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { emailHash } from "../core";
import { adminOp } from "../op";

/**
 * Account deletion requests that arrive outside the app (email to support). /delete-account promises
 * "within 30 days", so dueBy = received + 30 days. Support records, verifies or rejects; only the owner
 * completes, which deletes the account and keeps the request row (with its email hash) as proof.
 */

export const DELETION_DUE_DAYS = 30;
const DAY = 86_400_000;
const uuid = z.string().uuid();
const note = z.string().trim().max(1000);
const OPEN = ["received", "verified"] as const;

export function deletionDueBy(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + DELETION_DUE_DAYS * DAY);
}

export function isOverdue(r: { status: string; dueBy: Date | string }, now: Date = new Date()): boolean {
  return (OPEN as readonly string[]).includes(r.status) && new Date(r.dueBy).getTime() < now.getTime();
}

/**
 * Deletes the account exactly as Settings > Delete account (app/actions/settings.ts deleteAccount) and
 * the app (DELETE /api/mobile/me) do: remove the users row; everything the person owns cascades from it.
 * Audit rows and this request have no cascading foreign key, so they stay.
 */
const deleteAccountRow = deleteAccountData;

export async function listDeletionRequests() {
  const r = schema.accountDeletionRequests;
  const rows = await db()
    .select({
      id: r.id,
      userId: r.userId,
      email: schema.users.email,
      source: r.source,
      status: r.status,
      dueBy: r.dueBy,
      note: r.note,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    })
    .from(r)
    .leftJoin(schema.users, eq(schema.users.id, r.userId))
    .orderBy(sql`case when ${r.status} in ('received','verified') then 0 else 1 end`, asc(r.dueBy), desc(r.createdAt))
    .limit(200);
  const now = new Date();
  return rows.map((x) => ({
    ...x,
    overdue: isOverdue(x, now),
    daysLeft: Math.ceil((x.dueBy.getTime() - now.getTime()) / DAY),
    dueBy: x.dueBy.toISOString(),
    createdAt: x.createdAt.toISOString(),
    completedAt: x.completedAt?.toISOString() ?? null,
  }));
}
export type DeletionRequestRow = Awaited<ReturnType<typeof listDeletionRequests>>[number];

export const listDeletionRequestsOp = adminOp({
  action: "deletion.list",
  resourceType: "deletion_request",
  permission: "users.deletion_request",
  kind: "read",
  input: z.object({}),
  run: () => listDeletionRequests(),
});

export const recordDeletionRequestOp = adminOp({
  action: "deletion.record",
  resourceType: "deletion_request",
  permission: "users.deletion_request",
  kind: "write",
  input: z.object({
    email: z.string().trim().toLowerCase().email("Enter the address the request came from").max(320),
    source: z.enum(["email", "support"]).default("email"),
    /** When the request arrived (defaults to now). The 30 days run from here. */
    receivedAt: z.coerce
      .date()
      .refine((d) => d.getTime() <= Date.now() + 60_000, "The received date can't be in the future")
      .refine((d) => d.getTime() > Date.now() - 365 * DAY, "The received date must be within the last year")
      .optional(),
    note: note.optional(),
  }),
  run: async ({ email, source, receivedAt, note: n }, { user, tx, record }) => {
    const hash = emailHash(email);
    const [open] = await tx
      .select({ id: schema.accountDeletionRequests.id })
      .from(schema.accountDeletionRequests)
      .where(and(eq(schema.accountDeletionRequests.emailHash, hash), inArray(schema.accountDeletionRequests.status, [...OPEN])))
      .limit(1);
    if (open) throw new UserFacingError("There's already an open request for this address.");
    const [account] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const received = receivedAt ?? new Date();
    const [row] = await tx
      .insert(schema.accountDeletionRequests)
      .values({ userId: account?.id ?? null, emailHash: hash, source, status: "received", dueBy: deletionDueBy(received), note: n || null, recordedBy: user.id, createdAt: received })
      .returning({ id: schema.accountDeletionRequests.id, dueBy: schema.accountDeletionRequests.dueBy });
    record({ resourceId: row!.id, after: { status: "received", source, accountFound: Boolean(account), dueBy: row!.dueBy.toISOString() }, reason: n || null });
    return { id: row!.id, accountFound: Boolean(account), dueBy: row!.dueBy.toISOString() };
  },
});

async function loadRequest(tx: Pick<ReturnType<typeof db>, "select">, id: string) {
  const [r] = await tx
    .select({ id: schema.accountDeletionRequests.id, status: schema.accountDeletionRequests.status, userId: schema.accountDeletionRequests.userId, emailHash: schema.accountDeletionRequests.emailHash, note: schema.accountDeletionRequests.note })
    .from(schema.accountDeletionRequests)
    .where(eq(schema.accountDeletionRequests.id, id))
    .limit(1);
  if (!r) throw new UserFacingError("That request no longer exists.");
  return r;
}

const appendNote = (prev: string | null, add: string | undefined) => (add ? (prev ? `${prev}\n${add}` : add).slice(0, 4000) : prev);

/** The person confirmed the request from the address they sign in with. */
export const verifyDeletionRequestOp = adminOp({
  action: "deletion.verify",
  resourceType: "deletion_request",
  permission: "users.deletion_request",
  kind: "write",
  input: z.object({ id: uuid, note: note.optional() }),
  run: async ({ id, note: n }, { tx, record }) => {
    const r = await loadRequest(tx, id);
    if (r.status !== "received") throw new UserFacingError(r.status === "verified" ? "That request is already verified." : "Only a new request can be verified.");
    if (!r.userId) throw new UserFacingError("No account uses this address, so there's nothing to delete. Reject the request with a note instead.");
    await tx.update(schema.accountDeletionRequests).set({ status: "verified", note: appendNote(r.note, n) }).where(eq(schema.accountDeletionRequests.id, id));
    record({ resourceId: id, before: { status: r.status }, after: { status: "verified" }, reason: n ?? null });
  },
});

export const rejectDeletionRequestOp = adminOp({
  action: "deletion.reject",
  resourceType: "deletion_request",
  permission: "users.deletion_request",
  kind: "write",
  input: z.object({ id: uuid, note: z.string().trim().min(3, "Say why it was rejected").max(1000) }),
  run: async ({ id, note: n }, { tx, record }) => {
    const r = await loadRequest(tx, id);
    if (!(OPEN as readonly string[]).includes(r.status)) throw new UserFacingError("That request is already closed.");
    await tx.update(schema.accountDeletionRequests).set({ status: "rejected", note: appendNote(r.note, n) }).where(eq(schema.accountDeletionRequests.id, id));
    record({ resourceId: id, before: { status: r.status }, after: { status: "rejected" }, reason: n });
  },
});

/**
 * runOp calls summary() outside its error handling, so a refusal there would surface as a crash.
 * Return the plain reason instead; the commit then refuses with the same message.
 */
export function refusal(err: unknown): string {
  if (err instanceof UserFacingError) return `This can't go ahead: ${err.message}`;
  throw err;
}

const completeInput = z.object({
  id: uuid,
  /** The owner types the account's email address; it must match the request. */
  confirmEmail: z.string().trim().toLowerCase().email("Type the account's email address to confirm").max(320),
});

async function completionTarget(tx: Pick<ReturnType<typeof db>, "select">, input: z.infer<typeof completeInput>, actorId: string) {
  const r = await loadRequest(tx, input.id);
  if (r.status !== "verified") throw new UserFacingError(r.status === "received" ? "Verify the request before deleting the account." : "That request is already closed.");
  if (emailHash(input.confirmEmail) !== r.emailHash) throw new UserFacingError("That email doesn't match the request.");
  if (!r.userId) throw new UserFacingError("This account no longer exists.");
  if (r.userId === actorId) throw new UserFacingError("Delete your own account from Settings.");
  const [account] = await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, r.userId)).limit(1);
  if (!account) throw new UserFacingError("This account no longer exists.");
  const [role] = await tx
    .select({ role: schema.adminRoleAssignments.role })
    .from(schema.adminRoleAssignments)
    .where(and(eq(schema.adminRoleAssignments.userId, r.userId), isNull(schema.adminRoleAssignments.revokedAt)))
    .limit(1);
  if (role) throw new UserFacingError("This account holds an admin role. Remove the role first.");
  return { request: r, account };
}

/** Owner only, destructive (summary and a second call) and needs a fresh unlock. */
export const completeDeletionRequestOp = adminOp({
  action: "deletion.complete",
  resourceType: "deletion_request",
  permission: "users.delete",
  kind: "write",
  risk: "destructive",
  freshStepUp: true,
  input: completeInput,
  summary: async (input, user) => {
    const t = await completionTarget(db(), input, user.id).catch(refusal);
    if (typeof t === "string") return t;
    const { account } = t;
    return `Delete the account ${account.email} and all of its data: chats, memories, tasks, notes, documents, automations, connected services and sessions. This can't be undone.`;
  },
  run: async (input, { user, tx, record }) => {
    const { request, account } = await completionTarget(tx, input, user.id);
    const now = new Date();
    // Mark first: the user_id foreign key is "set null", so the row keeps only the hash as proof.
    await tx.update(schema.accountDeletionRequests).set({ status: "completed", completedBy: user.id, completedAt: now }).where(eq(schema.accountDeletionRequests.id, request.id));
    await deleteAccountRow(account.id, tx);
    record({ resourceId: request.id, before: { status: "verified", accountId: account.id }, after: { status: "completed", accountDeleted: true, completedAt: now.toISOString() } });
    return { completedAt: now.toISOString() };
  },
});
