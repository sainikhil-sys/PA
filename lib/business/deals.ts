import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { moderateText } from "@/lib/moderation/text";
import { SocialError } from "@/lib/social/service";
import { orgRole, requireBusiness, requireOrgRole, requireVerified } from "./orgs";

/**
 * Procurement and deals. A verified buyer posts a requirement; verified suppliers quote; either side
 * proposes new terms (each a quote version) and they talk in the quote's thread; the buyer accepts a
 * quote, which opens a deal; the deal is agreed only when an admin of each organization approves the
 * same terms version. Approvals are records with an audit trail, not legal signatures.
 */

const r = schema.requirements;
const q = schema.quotes;
const d = schema.deals;
const CURRENCY = /^[A-Z]{3}$/;

async function moderated(userId: string, text: string, what: string) {
  if (!text.trim()) return;
  const v = await moderateText(userId, text);
  if (v.verdict === "flagged") throw new SocialError(422, `That ${what} can't be sent. Keep it within the rules.`);
}

function money(amountMinor: number, currency: string) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new SocialError(400, "Enter an amount greater than zero.");
  if (!CURRENCY.test(currency)) throw new SocialError(400, "Use a 3-letter currency code, like USD or INR.");
}

// ---------- Requirements ----------

export type RequirementInput = { title: string; description?: string; category?: string; quantity?: string; budgetMinor?: number | null; currency?: string; deadline?: Date | null };

export async function createRequirement(user: User, orgId: string, input: RequirementInput) {
  const { org } = await requireOrgRole(user, orgId);
  requireVerified(org);
  const title = input.title.trim();
  if (title.length < 5 || title.length > 140) throw new SocialError(400, "Give it a title of 5 to 140 characters.");
  const currency = (input.currency ?? "USD").toUpperCase();
  if (!CURRENCY.test(currency)) throw new SocialError(400, "Use a 3-letter currency code, like USD or INR.");
  if (input.budgetMinor !== undefined && input.budgetMinor !== null && (!Number.isSafeInteger(input.budgetMinor) || input.budgetMinor <= 0)) throw new SocialError(400, "Enter a budget greater than zero, or leave it empty.");
  if (input.deadline && input.deadline.getTime() < Date.now()) throw new SocialError(400, "The deadline can't be in the past.");
  const description = (input.description ?? "").trim().slice(0, 5000);
  await moderated(user.id, `${title}\n${description}`, "requirement");
  const [row] = await db()
    .insert(r)
    .values({ orgId, createdBy: user.id, title, description, category: (input.category ?? "").trim().slice(0, 60), quantity: (input.quantity ?? "").trim().slice(0, 120), budgetMinor: input.budgetMinor ?? null, currency, deadline: input.deadline ?? null })
    .returning({ id: r.id });
  return row!.id;
}

/** Open requirements from active, verified buyers. */
export async function openRequirements(user: User, opts: { q?: string; category?: string; offset?: number } = {}) {
  await requireBusiness(user);
  const text = (opts.q ?? "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  const offset = Math.min(Math.max(opts.offset ?? 0, 0), 400);
  const rows = await db()
    .select({ id: r.id, title: r.title, category: r.category, quantity: r.quantity, budgetMinor: r.budgetMinor, currency: r.currency, deadline: r.deadline, createdAt: r.createdAt, orgName: schema.organizations.name, orgSlug: schema.organizations.slug })
    .from(r)
    .innerJoin(schema.organizations, eq(schema.organizations.id, r.orgId))
    .where(
      and(
        eq(r.status, "open"),
        eq(schema.organizations.status, "active"),
        eq(schema.organizations.verification, "verified"),
        or(isNull(r.deadline), sql`${r.deadline} > now()`),
        text ? or(ilike(r.title, `%${text}%`), ilike(r.description, `%${text}%`), ilike(r.category, `%${text}%`)) : undefined,
        opts.category ? ilike(r.category, opts.category.replace(/[%_\\]/g, "").slice(0, 60)) : undefined,
      ),
    )
    .orderBy(desc(r.createdAt))
    .limit(20)
    .offset(offset);
  return { items: rows, next: rows.length === 20 ? String(offset + 20) : null };
}

/** A requirement; the buyer's representatives see every quote, a supplier sees only their own. */
export async function getRequirement(user: User, requirementId: string) {
  await requireBusiness(user);
  const [req] = await db().select().from(r).where(eq(r.id, requirementId)).limit(1);
  if (!req) throw new SocialError(404, "That requirement isn't available.");
  const [buyer] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, req.orgId)).limit(1);
  const isBuyer = Boolean(await orgRole(req.orgId, user.id));
  const publiclyVisible = (req.status === "open" || req.status === "awarded") && buyer?.status === "active" && buyer.verification === "verified";
  if (!isBuyer && !publiclyVisible) throw new SocialError(404, "That requirement isn't available.");
  const myOrgIds = (await db().select({ orgId: schema.orgMembers.orgId }).from(schema.orgMembers).where(eq(schema.orgMembers.userId, user.id))).map((x) => x.orgId);
  const quotes = await db()
    .select({ id: q.id, supplierOrgId: q.supplierOrgId, supplierName: schema.organizations.name, supplierSlug: schema.organizations.slug, status: q.status, amountMinor: q.amountMinor, currency: q.currency, deliveryDays: q.deliveryDays, terms: q.terms, validUntil: q.validUntil, version: q.version, updatedAt: q.updatedAt })
    .from(q)
    .innerJoin(schema.organizations, eq(schema.organizations.id, q.supplierOrgId))
    .where(and(eq(q.requirementId, req.id), isBuyer ? undefined : myOrgIds.length ? inArray(q.supplierOrgId, myOrgIds) : sql`false`))
    .orderBy(asc(q.amountMinor));
  return { requirement: { ...req, buyerName: buyer?.name ?? "", buyerSlug: buyer?.slug ?? "" }, isBuyer, quotes };
}

export async function setRequirementStatus(user: User, requirementId: string, status: "closed" | "cancelled" | "open") {
  const [req] = await db().select().from(r).where(eq(r.id, requirementId)).limit(1);
  if (!req) throw new SocialError(404, "That requirement isn't available.");
  await requireOrgRole(user, req.orgId, ["owner", "admin"]);
  if (req.status === "awarded") throw new SocialError(409, "This requirement already has a deal.");
  await db().update(r).set({ status, updatedAt: new Date() }).where(eq(r.id, requirementId));
}

// ---------- Quotes and negotiation ----------

export type Terms = { amountMinor: number; currency: string; deliveryDays?: number | null; terms?: string; validUntil?: Date | null };

export async function submitQuote(user: User, requirementId: string, supplierOrgId: string, t: Terms) {
  const { org } = await requireOrgRole(user, supplierOrgId);
  requireVerified(org);
  const [req] = await db().select().from(r).where(eq(r.id, requirementId)).limit(1);
  if (!req || req.status !== "open") throw new SocialError(409, "This requirement isn't taking quotes.");
  if (req.orgId === supplierOrgId) throw new SocialError(400, "You can't quote on your own organization's requirement.");
  const currency = t.currency.toUpperCase();
  money(t.amountMinor, currency);
  const terms = (t.terms ?? "").trim().slice(0, 5000);
  await moderated(user.id, terms, "quote");
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(q)
      .values({ requirementId, supplierOrgId, amountMinor: t.amountMinor, currency, deliveryDays: t.deliveryDays ?? null, terms, validUntil: t.validUntil ?? null })
      .onConflictDoNothing()
      .returning({ id: q.id });
    if (!row) throw new SocialError(409, "Your organization already quoted. Revise that quote instead.");
    await tx.insert(schema.quoteVersions).values({ quoteId: row.id, version: 1, amountMinor: t.amountMinor, currency, deliveryDays: t.deliveryDays ?? null, terms, proposedBy: "supplier", createdBy: user.id });
    return row.id;
  });
}

async function quoteSides(quoteId: string) {
  const [row] = await db()
    .select({ quote: q, buyerOrgId: r.orgId, reqStatus: r.status })
    .from(q)
    .innerJoin(r, eq(r.id, q.requirementId))
    .where(eq(q.id, quoteId))
    .limit(1);
  if (!row) throw new SocialError(404, "That quote isn't available.");
  return row;
}

/** Which side this person is on for a quote, or 404 when neither. */
async function sideOf(user: User, quoteId: string) {
  await requireBusiness(user);
  const row = await quoteSides(quoteId);
  if (await orgRole(row.buyerOrgId, user.id)) return { ...row, side: "buyer" as const, orgId: row.buyerOrgId };
  if (await orgRole(row.quote.supplierOrgId, user.id)) return { ...row, side: "supplier" as const, orgId: row.quote.supplierOrgId };
  throw new SocialError(404, "That quote isn't available.");
}

/** Propose new terms (a supplier revision or a buyer counter-offer). Not after a deal exists. */
export async function proposeTerms(user: User, quoteId: string, t: Terms) {
  const s = await sideOf(user, quoteId);
  if (!["submitted", "shortlisted"].includes(s.quote.status)) throw new SocialError(409, "These terms can't change anymore.");
  const currency = t.currency.toUpperCase();
  money(t.amountMinor, currency);
  const terms = (t.terms ?? s.quote.terms).trim().slice(0, 5000);
  await moderated(user.id, terms, "proposal");
  await db().transaction(async (tx) => {
    const [next] = await tx
      .update(q)
      .set({ version: sql`${q.version} + 1`, amountMinor: t.amountMinor, currency, deliveryDays: t.deliveryDays ?? null, terms, validUntil: t.validUntil ?? null, updatedAt: new Date() })
      .where(and(eq(q.id, quoteId), inArray(q.status, ["submitted", "shortlisted"])))
      .returning({ version: q.version });
    if (!next) throw new SocialError(409, "These terms can't change anymore.");
    await tx.insert(schema.quoteVersions).values({ quoteId, version: next.version, amountMinor: t.amountMinor, currency, deliveryDays: t.deliveryDays ?? null, terms, proposedBy: s.side, createdBy: user.id });
  });
}

export async function quoteHistory(user: User, quoteId: string) {
  await sideOf(user, quoteId);
  const [versions, messages] = await Promise.all([
    db().select().from(schema.quoteVersions).where(eq(schema.quoteVersions.quoteId, quoteId)).orderBy(asc(schema.quoteVersions.version)),
    db()
      .select({ id: schema.quoteMessages.id, orgId: schema.quoteMessages.orgId, body: schema.quoteMessages.body, createdAt: schema.quoteMessages.createdAt, name: schema.socialProfiles.displayName })
      .from(schema.quoteMessages)
      .leftJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.quoteMessages.userId))
      .where(eq(schema.quoteMessages.quoteId, quoteId))
      .orderBy(asc(schema.quoteMessages.createdAt))
      .limit(500),
  ]);
  return { versions, messages };
}

export async function postQuoteMessage(user: User, quoteId: string, body: string) {
  const s = await sideOf(user, quoteId);
  const text = body.trim();
  if (!text) throw new SocialError(400, "Write a message first.");
  if (text.length > 4000) throw new SocialError(400, "Messages can be up to 4000 characters.");
  await moderated(user.id, text, "message");
  await db().insert(schema.quoteMessages).values({ quoteId, orgId: s.orgId, userId: user.id, body: text });
}

/** Buyer: shortlist or reject. Supplier: withdraw. */
export async function setQuoteStatus(user: User, quoteId: string, status: "shortlisted" | "rejected" | "withdrawn" | "submitted") {
  const s = await sideOf(user, quoteId);
  if (status === "withdrawn" ? s.side !== "supplier" : s.side !== "buyer") throw new SocialError(403, "Your side can't do that.");
  if (["accepted", "withdrawn"].includes(s.quote.status)) throw new SocialError(409, "This quote can't change anymore.");
  await db().update(q).set({ status, updatedAt: new Date() }).where(eq(q.id, quoteId));
}

// ---------- Deals ----------

/** Buyer admin: accept a quote. Opens the deal and records the buyer's approval of these terms. */
export async function acceptQuote(user: User, quoteId: string, note = "") {
  const s = await sideOf(user, quoteId);
  if (s.side !== "buyer") throw new SocialError(403, "Only the buyer can accept a quote.");
  await requireOrgRole(user, s.buyerOrgId, ["owner", "admin"]);
  if (!["submitted", "shortlisted"].includes(s.quote.status)) throw new SocialError(409, "This quote can't be accepted.");
  if (s.reqStatus !== "open") throw new SocialError(409, "This requirement already has a deal, or is closed.");
  const [req] = await db().select({ title: r.title }).from(r).where(eq(r.id, s.quote.requirementId)).limit(1);
  return db().transaction(async (tx) => {
    const claimed = await tx.update(r).set({ status: "awarded", updatedAt: new Date() }).where(and(eq(r.id, s.quote.requirementId), eq(r.status, "open"))).returning({ id: r.id });
    if (!claimed.length) throw new SocialError(409, "This requirement already has a deal.");
    await tx.update(q).set({ status: "accepted", updatedAt: new Date() }).where(eq(q.id, quoteId));
    const [deal] = await tx
      .insert(d)
      .values({ quoteId, buyerOrgId: s.buyerOrgId, supplierOrgId: s.quote.supplierOrgId, title: req?.title ?? "Deal", amountMinor: s.quote.amountMinor, currency: s.quote.currency, termsVersion: s.quote.version })
      .returning({ id: d.id });
    await tx.insert(schema.dealApprovals).values({ dealId: deal!.id, orgId: s.buyerOrgId, userId: user.id, termsVersion: s.quote.version, decision: "approved", note: note.trim().slice(0, 1000) });
    return deal!.id;
  });
}

async function dealFor(user: User, dealId: string) {
  await requireBusiness(user);
  const [deal] = await db().select().from(d).where(eq(d.id, dealId)).limit(1);
  if (!deal) throw new SocialError(404, "That deal isn't available.");
  const buyerRole = await orgRole(deal.buyerOrgId, user.id);
  const supplierRole = await orgRole(deal.supplierOrgId, user.id);
  if (!buyerRole && !supplierRole) throw new SocialError(404, "That deal isn't available.");
  const side = buyerRole ? ("buyer" as const) : ("supplier" as const);
  const role = buyerRole ?? supplierRole!;
  return { deal, side, role, orgId: side === "buyer" ? deal.buyerOrgId : deal.supplierOrgId };
}

/** An admin of one side approves or rejects the deal's terms. Both approvals make it agreed; a rejection cancels it. */
export async function decideDeal(user: User, dealId: string, decision: "approved" | "rejected", note = "") {
  const f = await dealFor(user, dealId);
  if (f.role === "representative") throw new SocialError(403, "Only the organization's admins can approve a deal.");
  if (f.deal.status !== "awaiting_approval") throw new SocialError(409, "This deal isn't waiting for approval.");
  const existing = await db()
    .select({ orgId: schema.dealApprovals.orgId, decision: schema.dealApprovals.decision })
    .from(schema.dealApprovals)
    .where(and(eq(schema.dealApprovals.dealId, dealId), eq(schema.dealApprovals.termsVersion, f.deal.termsVersion)));
  if (existing.some((e) => e.orgId === f.orgId)) throw new SocialError(409, "Your organization already decided.");
  await db().transaction(async (tx) => {
    await tx.insert(schema.dealApprovals).values({ dealId, orgId: f.orgId, userId: user.id, termsVersion: f.deal.termsVersion, decision, note: note.trim().slice(0, 1000) });
    if (decision === "rejected") {
      await tx.update(d).set({ status: "cancelled", updatedAt: new Date() }).where(eq(d.id, dealId));
      // The buyer can choose again: the requirement reopens and the quote goes back to the shortlist.
      await tx.update(q).set({ status: "shortlisted", updatedAt: new Date() }).where(eq(q.id, f.deal.quoteId));
      const [quote] = await tx.select({ requirementId: q.requirementId }).from(q).where(eq(q.id, f.deal.quoteId)).limit(1);
      if (quote) await tx.update(r).set({ status: "open", updatedAt: new Date() }).where(eq(r.id, quote.requirementId));
    } else if (existing.some((e) => e.decision === "approved" && e.orgId !== f.orgId)) {
      await tx.update(d).set({ status: "agreed", updatedAt: new Date() }).where(eq(d.id, dealId));
    }
  });
}

/** Admins of either side: start work, mark completed, or cancel. */
export async function setDealStatus(user: User, dealId: string, status: "in_progress" | "completed" | "cancelled") {
  const f = await dealFor(user, dealId);
  if (f.role === "representative") throw new SocialError(403, "Only the organization's admins can change the deal's status.");
  const allowed: Record<string, string[]> = { in_progress: ["agreed"], completed: ["agreed", "in_progress"], cancelled: ["awaiting_approval", "agreed", "in_progress"] };
  if (!allowed[status]!.includes(f.deal.status)) throw new SocialError(409, "The deal can't move to that status from where it is.");
  await db().update(d).set({ status, updatedAt: new Date() }).where(eq(d.id, dealId));
}

export async function getDeal(user: User, dealId: string) {
  const f = await dealFor(user, dealId);
  const [orgs, approvals, milestones, meetings, history] = await Promise.all([
    db().select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug }).from(schema.organizations).where(inArray(schema.organizations.id, [f.deal.buyerOrgId, f.deal.supplierOrgId])),
    db().select().from(schema.dealApprovals).where(eq(schema.dealApprovals.dealId, dealId)).orderBy(asc(schema.dealApprovals.createdAt)),
    db().select().from(schema.dealMilestones).where(eq(schema.dealMilestones.dealId, dealId)).orderBy(asc(schema.dealMilestones.dueDate), asc(schema.dealMilestones.createdAt)),
    db().select().from(schema.dealMeetings).where(eq(schema.dealMeetings.dealId, dealId)).orderBy(asc(schema.dealMeetings.startsAt)),
    quoteHistory(user, f.deal.quoteId),
  ]);
  const name = (id: string) => orgs.find((x) => x.id === id);
  return { deal: f.deal, side: f.side, myRole: f.role, buyer: name(f.deal.buyerOrgId), supplier: name(f.deal.supplierOrgId), approvals, milestones, meetings, ...history };
}

export async function myDeals(user: User) {
  await requireBusiness(user);
  const orgIds = (await db().select({ orgId: schema.orgMembers.orgId }).from(schema.orgMembers).where(eq(schema.orgMembers.userId, user.id))).map((x) => x.orgId);
  if (!orgIds.length) return [];
  return db()
    .select()
    .from(d)
    .where(or(inArray(d.buyerOrgId, orgIds), inArray(d.supplierOrgId, orgIds)))
    .orderBy(desc(d.updatedAt))
    .limit(100);
}

export async function addMilestone(user: User, dealId: string, input: { title: string; dueDate?: string | null }) {
  const f = await dealFor(user, dealId);
  if (!["agreed", "in_progress"].includes(f.deal.status)) throw new SocialError(409, "Add milestones once the deal is agreed.");
  const title = input.title.trim();
  if (title.length < 2 || title.length > 140) throw new SocialError(400, "Give the milestone a title of 2 to 140 characters.");
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new SocialError(400, "Use a date like 2026-12-31.");
  await db().insert(schema.dealMilestones).values({ dealId, title, dueDate: input.dueDate ?? null, createdBy: user.id });
}

export async function setMilestoneDone(user: User, milestoneId: string, done: boolean) {
  const [ms] = await db().select().from(schema.dealMilestones).where(eq(schema.dealMilestones.id, milestoneId)).limit(1);
  if (!ms) throw new SocialError(404, "That milestone isn't available.");
  await dealFor(user, ms.dealId);
  await db().update(schema.dealMilestones).set({ status: done ? "done" : "pending", doneAt: done ? new Date() : null }).where(eq(schema.dealMilestones.id, milestoneId));
}

export async function scheduleMeeting(user: User, dealId: string, input: { title: string; startsAt: Date; endsAt: Date; location?: string }) {
  const f = await dealFor(user, dealId);
  if (f.deal.status === "cancelled" || f.deal.status === "completed") throw new SocialError(409, "This deal is closed.");
  const title = input.title.trim();
  if (title.length < 2 || title.length > 140) throw new SocialError(400, "Give the meeting a title of 2 to 140 characters.");
  if (input.endsAt <= input.startsAt) throw new SocialError(400, "The meeting has to end after it starts.");
  if (input.startsAt.getTime() < Date.now() - 3600_000) throw new SocialError(400, "The meeting can't start in the past.");
  const [row] = await db()
    .insert(schema.dealMeetings)
    .values({ dealId, title, startsAt: input.startsAt, endsAt: input.endsAt, location: (input.location ?? "").trim().slice(0, 300), createdBy: user.id })
    .returning({ id: schema.dealMeetings.id });
  return row!.id;
}

export async function cancelMeeting(user: User, meetingId: string) {
  const [m] = await db().select().from(schema.dealMeetings).where(eq(schema.dealMeetings.id, meetingId)).limit(1);
  if (!m) throw new SocialError(404, "That meeting isn't available.");
  await dealFor(user, m.dealId);
  await db().update(schema.dealMeetings).set({ cancelledAt: new Date() }).where(eq(schema.dealMeetings.id, meetingId));
}

/** A calendar file (iCalendar, RFC 5545) for one meeting, for people on either side of the deal. */
export async function meetingIcs(user: User, meetingId: string) {
  const [m] = await db().select().from(schema.dealMeetings).where(eq(schema.dealMeetings.id, meetingId)).limit(1);
  if (!m) throw new SocialError(404, "That meeting isn't available.");
  await dealFor(user, m.dealId);
  return toIcs({ uid: `${m.id}@cowork`, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, location: m.location, cancelled: Boolean(m.cancelledAt) });
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);

export function toIcs(e: { uid: string; title: string; startsAt: Date; endsAt: Date; location?: string; description?: string; cancelled?: boolean }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cowork//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.cancelled ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
