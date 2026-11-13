import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { emailInDomain, normalizeDomain } from "@/lib/anonymous/identity";
import { db, schema } from "@/lib/db";
import type { Organization, User } from "@/lib/db/schema";
import { requireSocial } from "@/lib/feed/people";
import { flagContext, isFlagOn } from "@/lib/flags/store";
import { moderateText } from "@/lib/moderation/text";
import { SocialError } from "@/lib/social/service";
import { normalizeSlug, slugProblem } from "@/lib/spaces/service";

/**
 * Business network (decision N3): organizations act through representatives whose sign-in email is
 * at the organization's domain; an organization is verified when one of them asks and an admin
 * approves it in the console. Only verified organizations post requirements or send quotes.
 * Adults only, behind the network.business flag.
 */

export const BUSINESS_FLAG = "network.business";
export const ORG_ROLES = ["buyer", "supplier", "partner"] as const;
export type OrgMemberRole = "owner" | "admin" | "representative";

const o = schema.organizations;
const om = schema.orgMembers;

async function flagOn(user: User) {
  let h: Pick<Headers, "get">;
  try {
    h = await headers();
  } catch {
    h = new Headers();
  }
  return isFlagOn(BUSINESS_FLAG, await flagContext(user, h));
}

export async function requireBusiness(user: User) {
  if (!(await flagOn(user))) throw new SocialError(403, "The business network isn't available yet.");
  const me = await requireSocial(user);
  if (me.group === "teen") throw new SocialError(403, "The business network is for people 18 and over.");
  return me;
}

export async function orgRole(orgId: string, userId: string): Promise<OrgMemberRole | null> {
  const [row] = await db().select({ role: om.role }).from(om).where(and(eq(om.orgId, orgId), eq(om.userId, userId))).limit(1);
  return row?.role ?? null;
}

/** The org, if this person acts for it with one of the roles; else 403. Suspended orgs can't act. */
export async function requireOrgRole(user: User, orgId: string, roles: readonly OrgMemberRole[] = ["owner", "admin", "representative"]): Promise<{ org: Organization; role: OrgMemberRole }> {
  await requireBusiness(user);
  const [org] = await db().select().from(o).where(eq(o.id, orgId)).limit(1);
  if (!org || org.status === "removed") throw new SocialError(404, "That organization isn't on Cowork.");
  const role = await orgRole(orgId, user.id);
  if (!role || !roles.includes(role)) throw new SocialError(403, roles.length === 3 ? "Only the organization's representatives can do that." : "Only the organization's admins can do that.");
  if (org.status === "suspended") throw new SocialError(403, "This organization is suspended. Contact support.");
  return { org, role };
}

export function requireVerified(org: Organization) {
  if (org.verification !== "verified") throw new SocialError(403, "Verify your organization first. Ask for verification on its page; an admin reviews it.");
}

async function moderated(userId: string, text: string, what: string) {
  if (!text.trim()) return;
  const v = await moderateText(userId, text);
  if (v.verdict === "flagged") throw new SocialError(422, `That ${what} can't be published. Keep it within the rules.`);
}

// ---------- Organizations ----------

export type OrgInput = { name: string; description?: string; industry?: string; roles?: string[]; country?: string; city?: string; website?: string; emailDomain: string };

const cleanRoles = (roles?: string[]) => (roles ?? []).filter((r): r is (typeof ORG_ROLES)[number] => (ORG_ROLES as readonly string[]).includes(r));
const cleanWebsite = (w?: string) => {
  const v = (w ?? "").trim();
  return /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v) && v.length <= 200 ? v : "";
};

export async function createOrg(user: User, input: OrgInput) {
  await requireBusiness(user);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new SocialError(400, "Give the organization a name of 2 to 80 characters.");
  const domain = normalizeDomain(input.emailDomain);
  if (!domain) throw new SocialError(400, "Enter the organization's email domain, like acme.com.");
  if (!emailInDomain(user.email, domain)) throw new SocialError(403, `To create an organization for ${domain}, sign in with your email at ${domain}.`);
  const description = (input.description ?? "").trim().slice(0, 3000);
  await moderated(user.id, `${name}\n${description}`, "description");
  let slug = normalizeSlug(name);
  if (slugProblem(slug)) slug = `${slug || "org"}-${randomBytes(2).toString("hex")}`;
  const [taken] = await db().select({ id: o.id }).from(o).where(eq(o.slug, slug)).limit(1);
  if (taken) slug = `${slug.slice(0, 34)}-${randomBytes(2).toString("hex")}`;
  const [row] = await db()
    .insert(o)
    .values({
      slug,
      name,
      description,
      industry: (input.industry ?? "").trim().slice(0, 60),
      roles: cleanRoles(input.roles),
      country: (input.country ?? "").trim().slice(0, 60),
      city: (input.city ?? "").trim().slice(0, 60),
      website: cleanWebsite(input.website),
      emailDomain: domain,
      createdBy: user.id,
    })
    .returning();
  await db().insert(om).values({ orgId: row!.id, userId: user.id, role: "owner" });
  return getOrg(user, row!.slug);
}

export async function updateOrg(user: User, orgId: string, input: Partial<Omit<OrgInput, "emailDomain">>) {
  await requireOrgRole(user, orgId, ["owner", "admin"]);
  const set: Partial<typeof o.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 80);
  if (input.description !== undefined) set.description = input.description.trim().slice(0, 3000);
  if (input.industry !== undefined) set.industry = input.industry.trim().slice(0, 60);
  if (input.roles !== undefined) set.roles = cleanRoles(input.roles);
  if (input.country !== undefined) set.country = input.country.trim().slice(0, 60);
  if (input.city !== undefined) set.city = input.city.trim().slice(0, 60);
  if (input.website !== undefined) set.website = cleanWebsite(input.website);
  await moderated(user.id, [set.name, set.description].filter(Boolean).join("\n"), "description");
  if (Object.keys(set).length) await db().update(o).set({ ...set, updatedAt: new Date() }).where(eq(o.id, orgId));
}

/** Ask for verification. The requester's sign-in email must be at the organization's domain. */
export async function requestVerification(user: User, orgId: string, note = "") {
  const { org } = await requireOrgRole(user, orgId, ["owner", "admin"]);
  if (org.verification === "verified") throw new SocialError(409, "This organization is already verified.");
  if (!emailInDomain(user.email, org.emailDomain)) throw new SocialError(403, `Ask from an account whose sign-in email is at ${org.emailDomain}.`);
  const done = await db()
    .insert(schema.orgVerifications)
    .values({ orgId, requestedBy: user.id, email: user.email, note: note.trim().slice(0, 1000) })
    .onConflictDoNothing()
    .returning({ id: schema.orgVerifications.id });
  if (!done.length) throw new SocialError(409, "A request is already waiting for review.");
  await db().update(o).set({ verification: "pending", updatedAt: new Date() }).where(eq(o.id, orgId));
}

function publicView(org: Organization) {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    description: org.description,
    industry: org.industry,
    roles: org.roles,
    country: org.country,
    city: org.city,
    website: org.website,
    emailDomain: org.emailDomain,
    verified: org.verification === "verified",
    verification: org.verification,
    suspended: org.status === "suspended",
  };
}

export async function getOrg(user: User, slugOrId: string) {
  await requireBusiness(user);
  const [org] = await db()
    .select()
    .from(o)
    .where(/^[0-9a-f-]{36}$/.test(slugOrId) ? eq(o.id, slugOrId) : eq(o.slug, slugOrId.toLowerCase()))
    .limit(1);
  if (!org || org.status === "removed") throw new SocialError(404, "That organization isn't on Cowork.");
  const role = await orgRole(org.id, user.id);
  const members = await db()
    .select({ userId: om.userId, role: om.role, title: om.title, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName })
    .from(om)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, om.userId))
    .where(eq(om.orgId, org.id))
    .orderBy(sql`case ${om.role} when 'owner' then 0 when 'admin' then 1 else 2 end`, asc(om.createdAt));
  return { ...publicView(org), members, myRole: role, canManage: role === "owner" || role === "admin", canAct: Boolean(role) && org.status === "active" };
}

/** Companies, suppliers and buyers: ?q=, ?role=buyer|supplier|partner, ?industry=, ?country=; verified first. */
export async function discoverOrgs(user: User, opts: { q?: string; role?: string; industry?: string; country?: string; offset?: number } = {}) {
  await requireBusiness(user);
  const q = (opts.q ?? "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  const offset = Math.min(Math.max(opts.offset ?? 0, 0), 400);
  const role = (ORG_ROLES as readonly string[]).includes(opts.role ?? "") ? opts.role! : null;
  const rows = await db()
    .select()
    .from(o)
    .where(
      and(
        eq(o.status, "active"),
        q ? or(ilike(o.name, `%${q}%`), ilike(o.description, `%${q}%`), ilike(o.industry, `%${q}%`)) : undefined,
        role ? sql`${role} = any(${o.roles})` : undefined,
        opts.industry ? ilike(o.industry, `%${opts.industry.replace(/[%_\\]/g, "").slice(0, 60)}%`) : undefined,
        opts.country ? ilike(o.country, opts.country.replace(/[%_\\]/g, "").slice(0, 60)) : undefined,
      ),
    )
    .orderBy(sql`(${o.verification} = 'verified') desc`, desc(o.createdAt))
    .limit(20)
    .offset(offset);
  return { items: rows.map(publicView), next: rows.length === 20 ? String(offset + 20) : null };
}

export async function myOrgs(user: User) {
  await requireBusiness(user);
  const rows = await db().select({ org: o, role: om.role }).from(om).innerJoin(o, eq(o.id, om.orgId)).where(and(eq(om.userId, user.id), ne(o.status, "removed"))).orderBy(asc(o.name));
  return rows.map((r) => ({ ...publicView(r.org), myRole: r.role }));
}

/** Admins: add a representative by handle. Their sign-in email must be at the organization's domain. */
export async function addMember(user: User, orgId: string, input: { handle: string; role?: "admin" | "representative"; title?: string }) {
  const { org, role } = await requireOrgRole(user, orgId, ["owner", "admin"]);
  if (input.role === "admin" && role !== "owner") throw new SocialError(403, "Only the owner can add admins.");
  const [person] = await db()
    .select({ id: schema.users.id, email: schema.users.email, birthDate: schema.users.birthDate })
    .from(schema.socialProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.socialProfiles.userId))
    .where(eq(schema.socialProfiles.handle, input.handle.trim().toLowerCase().replace(/^@/, "")))
    .limit(1);
  if (!person) throw new SocialError(404, "Nobody on Cowork has that handle.");
  if (!emailInDomain(person.email, org.emailDomain)) throw new SocialError(403, `Representatives must sign in with an email at ${org.emailDomain}.`);
  await db()
    .insert(om)
    .values({ orgId, userId: person.id, role: input.role ?? "representative", title: (input.title ?? "").trim().slice(0, 80) })
    .onConflictDoUpdate({ target: [om.orgId, om.userId], set: { role: input.role ?? "representative", title: (input.title ?? "").trim().slice(0, 80) } });
}

export async function removeMember(user: User, orgId: string, userId: string) {
  const { role } = await requireOrgRole(user, orgId, userId === user.id ? ["owner", "admin", "representative"] : ["owner", "admin"]);
  const target = await orgRole(orgId, userId);
  if (!target) return;
  if (target === "owner") {
    const owners = await db().select({ u: om.userId }).from(om).where(and(eq(om.orgId, orgId), eq(om.role, "owner")));
    if (owners.length <= 1) throw new SocialError(409, "Make someone else the owner first.");
    if (role !== "owner") throw new SocialError(403, "Only an owner can remove an owner.");
  }
  await db().delete(om).where(and(eq(om.orgId, orgId), eq(om.userId, userId)));
}

// ---------- Partnerships ----------

export async function requestPartnership(user: User, fromOrgId: string, toOrgId: string, message = "") {
  const { org } = await requireOrgRole(user, fromOrgId, ["owner", "admin"]);
  requireVerified(org);
  if (fromOrgId === toOrgId) throw new SocialError(400, "Choose another organization.");
  const [to] = await db().select().from(o).where(eq(o.id, toOrgId)).limit(1);
  if (!to || to.status !== "active") throw new SocialError(404, "That organization isn't on Cowork.");
  await moderated(user.id, message, "message");
  const done = await db()
    .insert(schema.orgPartnerships)
    .values({ fromOrgId, toOrgId, message: message.trim().slice(0, 1000), createdBy: user.id })
    .onConflictDoNothing()
    .returning({ id: schema.orgPartnerships.id });
  if (!done.length) throw new SocialError(409, "You already asked this organization.");
}

export async function answerPartnership(user: User, partnershipId: string, accept: boolean) {
  const [p] = await db().select().from(schema.orgPartnerships).where(eq(schema.orgPartnerships.id, partnershipId)).limit(1);
  if (!p || p.status !== "pending") throw new SocialError(404, "That request isn't there anymore.");
  await requireOrgRole(user, p.toOrgId, ["owner", "admin"]);
  await db().update(schema.orgPartnerships).set({ status: accept ? "accepted" : "declined", respondedAt: new Date() }).where(eq(schema.orgPartnerships.id, partnershipId));
}

export async function listPartnerships(user: User, orgId: string) {
  await requireOrgRole(user, orgId);
  const p = schema.orgPartnerships;
  const rows = await db()
    .select({ id: p.id, fromOrgId: p.fromOrgId, toOrgId: p.toOrgId, status: p.status, message: p.message, createdAt: p.createdAt })
    .from(p)
    .where(and(or(eq(p.fromOrgId, orgId), eq(p.toOrgId, orgId)), ne(p.status, "declined")))
    .orderBy(desc(p.createdAt))
    .limit(200);
  const ids = [...new Set(rows.flatMap((r) => [r.fromOrgId, r.toOrgId]))];
  const names = ids.length ? await db().select({ id: o.id, name: o.name, slug: o.slug }).from(o).where(inArray(o.id, ids)) : [];
  const nameOf = (id: string) => names.find((n) => n.id === id) ?? { id, name: "Unknown", slug: "" };
  return rows.map((r) => ({ ...r, incoming: r.toOrgId === orgId, other: nameOf(r.toOrgId === orgId ? r.fromOrgId : r.toOrgId) }));
}
