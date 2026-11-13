import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { emailInDomain } from "@/lib/anonymous/identity";
import { UserFacingError } from "@/lib/auth/action";
import { schema } from "@/lib/db";
import { adminOp } from "../op";

/**
 * Business verification (decision N3): an organization's admin asks from an account whose sign-in
 * email is at the organization's domain; an admin with network.verify approves or rejects it here.
 * Each decision writes an audit row in the same transaction.
 */
export const decideVerificationOp = adminOp({
  action: "business.verification.decide",
  resourceType: "organization",
  permission: "network.verify",
  kind: "write",
  input: z.object({
    verificationId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(500).default(""),
  }),
  run: async ({ verificationId, decision, note }, { user, tx, record }) => {
    const [v] = await tx
      .update(schema.orgVerifications)
      .set({ status: decision, reviewNote: note || null, reviewedBy: user.id, reviewedAt: new Date() })
      .where(and(eq(schema.orgVerifications.id, verificationId), eq(schema.orgVerifications.status, "pending")))
      .returning();
    if (!v) throw new UserFacingError("Someone already reviewed this request.");
    const [org] = await tx.select().from(schema.organizations).where(eq(schema.organizations.id, v.orgId)).limit(1);
    if (!org) throw new UserFacingError("That organization no longer exists.");
    if (decision === "approved" && !emailInDomain(v.email, org.emailDomain)) throw new UserFacingError("The requester's email isn't at the organization's domain, so it can't be approved.");
    await tx
      .update(schema.organizations)
      .set(decision === "approved" ? { verification: "verified", verifiedAt: new Date(), verifiedBy: user.id, updatedAt: new Date() } : { verification: "rejected", updatedAt: new Date() })
      .where(eq(schema.organizations.id, v.orgId));
    record({ resourceId: v.orgId, before: { verification: org.verification }, after: { verification: decision === "approved" ? "verified" : "rejected" }, reason: note || null });
  },
});

/** Suspend or restore an organization (it can't post, quote or approve while suspended). */
export const setOrganizationStatusOp = adminOp({
  action: "business.organization.status",
  resourceType: "organization",
  permission: "network.verify",
  kind: "write",
  input: z.object({ orgId: z.string().uuid(), status: z.enum(["active", "suspended"]), reason: z.string().trim().min(5, "Say why (at least 5 characters).").max(500) }),
  run: async ({ orgId, status, reason }, { tx, record }) => {
    const [org] = await tx.select({ status: schema.organizations.status }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
    if (!org || org.status === "removed") throw new UserFacingError("That organization no longer exists.");
    await tx.update(schema.organizations).set({ status, updatedAt: new Date() }).where(eq(schema.organizations.id, orgId));
    record({ resourceId: orgId, before: { status: org.status }, after: { status }, reason });
  },
});
