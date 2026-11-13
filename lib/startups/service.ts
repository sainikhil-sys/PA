import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { requireSocial } from "@/lib/feed/people";
import { flagContext, isFlagOn } from "@/lib/flags/store";
import { moderateText } from "@/lib/moderation/text";
import { relationship, SocialError } from "@/lib/social/service";
import { addSpaceMember, createSpace, normalizeSlug, slugProblem } from "@/lib/spaces/service";

/**
 * Startup network: professional profiles, startups and ideas with a private team Space, requests to
 * join as co-founder, collaborator or mentor, and skill-based matching. Adults only (people reach out
 * to strangers here), behind the network.startups flag. Matching is exact on skill tags; nothing is
 * inferred about anyone.
 */

export const STARTUP_FLAG = "network.startups";
export const OPEN_TO = ["cofounder", "collaborate", "mentor_others", "find_mentor"] as const;
export const STAGES = ["idea", "prototype", "launched", "revenue"] as const;
export const PAGE = 20;

const pp = schema.proProfiles;
const st = schema.startups;
const sm = schema.startupMembers;
const si = schema.startupInterests;

/** Lowercase tags: letters, numbers, spaces and + # . - ; 2 to 40 characters; at most 20. */
export function normalizeTags(list: readonly string[] | undefined, max = 20): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (t.length < 2 || t.length > 40 || !/^[a-z0-9][a-z0-9 +#.-]*$/.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function flagOn(user: User) {
  let h: Pick<Headers, "get">;
  try {
    h = await headers();
  } catch {
    h = new Headers();
  }
  return isFlagOn(STARTUP_FLAG, await flagContext(user, h));
}

/** Everything here needs the flag on, a handle, a date of birth, and being 18 or over. */
export async function requireNetwork(user: User) {
  if (!(await flagOn(user))) throw new SocialError(403, "The startup network isn't available yet.");
  const me = await requireSocial(user);
  if (me.group === "teen") throw new SocialError(403, "The startup network is for people 18 and over.");
  return me;
}

/** A JS string array as a Postgres text[] (interpolating an array directly would expand it into a list). */
function textArray(values: readonly string[]) {
  return values.length ? sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]` : sql`array[]::text[]`;
}

const adult = (userIdCol: unknown) =>
  sql`exists (select 1 from ${schema.users} au where au.id = ${userIdCol} and au.birth_date is not null and au.birth_date <= (current_date - interval '18 years') and au.disabled_at is null)`;
const notBlocked = (viewerId: string, otherCol: unknown) =>
  sql`not exists (select 1 from ${schema.userBlocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${otherCol}) or (b.blocker_id = ${otherCol} and b.blocked_id = ${viewerId}))`;

// ---------- Professional profiles ----------

export type ProInput = {
  headline?: string;
  about?: string;
  skills?: string[];
  interests?: string[];
  openTo?: string[];
  location?: string;
  links?: { label: string; url: string }[];
  visibility?: "everyone" | "followers" | "hidden";
};

function cleanLinks(links: ProInput["links"]) {
  return (links ?? [])
    .slice(0, 5)
    .map((l) => ({ label: l.label.trim().slice(0, 40), url: l.url.trim() }))
    .filter((l) => l.label && /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(l.url) && l.url.length <= 300);
}

export async function myProProfile(userId: string) {
  const [row] = await db().select().from(pp).where(eq(pp.userId, userId)).limit(1);
  return row ?? null;
}

export async function saveProProfile(user: User, input: ProInput) {
  await requireNetwork(user);
  const headline = (input.headline ?? "").trim().slice(0, 120);
  const about = (input.about ?? "").trim().slice(0, 2000);
  const text = `${headline}\n${about}`.trim();
  if (text) {
    const v = await moderateText(user.id, text);
    if (v.verdict === "flagged") throw new SocialError(422, "Your headline or about text can't be saved. Keep it within the rules.");
  }
  const values = {
    headline,
    about,
    skills: normalizeTags(input.skills),
    interests: normalizeTags(input.interests),
    openTo: (input.openTo ?? []).filter((o): o is (typeof OPEN_TO)[number] => (OPEN_TO as readonly string[]).includes(o)),
    location: (input.location ?? "").trim().slice(0, 80),
    links: cleanLinks(input.links),
    visibility: input.visibility ?? "everyone",
  };
  await db()
    .insert(pp)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: pp.userId, set: { ...values, updatedAt: new Date() } });
  return myProProfile(user.id);
}

/** Someone's professional profile as the viewer may see it, or null. */
export async function proProfileFor(viewerId: string, targetId: string) {
  const row = await myProProfile(targetId);
  if (!row) return null;
  if (viewerId === targetId) return row;
  if (row.visibility === "hidden") return null;
  const rel = await relationship(viewerId, targetId);
  if (rel === "blocked" || rel === "blocked_you") return null;
  if (row.visibility === "followers") {
    const [f] = await db()
      .select({ s: schema.follows.status })
      .from(schema.follows)
      .where(and(eq(schema.follows.followerId, viewerId), eq(schema.follows.followeeId, targetId), eq(schema.follows.status, "accepted")))
      .limit(1);
    if (!f) return null;
  }
  return row;
}

// ---------- Startups ----------

export type StartupInput = {
  name: string;
  oneLiner: string;
  description?: string;
  stage?: (typeof STAGES)[number];
  industry?: string;
  lookingFor?: string[];
  skillsNeeded?: string[];
  visibility?: "public" | "private";
};

const memberRole = async (startupId: string, userId: string) =>
  (await db().select({ role: sm.role }).from(sm).where(and(eq(sm.startupId, startupId), eq(sm.userId, userId))).limit(1))[0]?.role ?? null;

const manages = (role: string | null) => role === "founder" || role === "cofounder";

export async function createStartup(user: User, input: StartupInput) {
  await requireNetwork(user);
  const name = input.name.trim();
  const oneLiner = input.oneLiner.trim();
  if (name.length < 2 || name.length > 60) throw new SocialError(400, "Give it a name of 2 to 60 characters.");
  if (oneLiner.length < 10 || oneLiner.length > 160) throw new SocialError(400, "Describe it in one line of 10 to 160 characters.");
  const description = (input.description ?? "").trim().slice(0, 5000);
  const v = await moderateText(user.id, `${name}\n${oneLiner}\n${description}`);
  if (v.verdict === "flagged") throw new SocialError(422, "This can't be published. Keep it within the rules.");
  let slug = normalizeSlug(name);
  if (slugProblem(slug)) slug = `${slug || "startup"}-${randomBytes(2).toString("hex")}`;
  const [taken] = await db().select({ id: st.id }).from(st).where(eq(st.slug, slug)).limit(1);
  if (taken) slug = `${slug.slice(0, 34)}-${randomBytes(2).toString("hex")}`;

  // The team's private Space: discussions, pitch sessions, events, polls.
  const space = await createSpace(user, {
    name: `${name} team`.slice(0, 60),
    slug: `${slug.slice(0, 33)}-team-${randomBytes(2).toString("hex")}`,
    description: oneLiner,
    category: "professional",
    visibility: "private",
    joinPolicy: "invite",
    audience: "adults",
  });
  const [row] = await db()
    .insert(st)
    .values({
      slug,
      ownerId: user.id,
      name,
      oneLiner,
      description,
      stage: input.stage ?? "idea",
      industry: (input.industry ?? "").trim().slice(0, 60),
      lookingFor: normalizeTags(input.lookingFor, 10),
      skillsNeeded: normalizeTags(input.skillsNeeded),
      spaceId: space.id,
      visibility: input.visibility ?? "public",
    })
    .returning();
  await db().insert(sm).values({ startupId: row!.id, userId: user.id, role: "founder" });
  return getStartup(user, row!.slug);
}

export async function updateStartup(user: User, startupId: string, input: Partial<StartupInput> & { archived?: boolean }) {
  await requireNetwork(user);
  if (!manages(await memberRole(startupId, user.id))) throw new SocialError(403, "Only founders can change this.");
  const set: Partial<typeof st.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 60);
  if (input.oneLiner !== undefined) set.oneLiner = input.oneLiner.trim().slice(0, 160);
  if (input.description !== undefined) set.description = input.description.trim().slice(0, 5000);
  if (input.stage !== undefined) set.stage = input.stage;
  if (input.industry !== undefined) set.industry = input.industry.trim().slice(0, 60);
  if (input.lookingFor !== undefined) set.lookingFor = normalizeTags(input.lookingFor, 10);
  if (input.skillsNeeded !== undefined) set.skillsNeeded = normalizeTags(input.skillsNeeded);
  if (input.visibility !== undefined) set.visibility = input.visibility;
  if (input.archived !== undefined) set.status = input.archived ? "archived" : "active";
  const text = [set.name, set.oneLiner, set.description].filter(Boolean).join("\n");
  if (text) {
    const v = await moderateText(user.id, text);
    if (v.verdict === "flagged") throw new SocialError(422, "This can't be published. Keep it within the rules.");
  }
  if (Object.keys(set).length) await db().update(st).set({ ...set, updatedAt: new Date() }).where(eq(st.id, startupId));
}

const startupColumns = {
  id: st.id,
  slug: st.slug,
  name: st.name,
  oneLiner: st.oneLiner,
  stage: st.stage,
  industry: st.industry,
  lookingFor: st.lookingFor,
  skillsNeeded: st.skillsNeeded,
  visibility: st.visibility,
  status: st.status,
  ownerHandle: schema.socialProfiles.handle,
  ownerName: schema.socialProfiles.displayName,
  createdAt: st.createdAt,
};

export async function getStartup(user: User, slug: string) {
  await requireNetwork(user);
  const [row] = await db().select().from(st).where(eq(st.slug, slug.toLowerCase())).limit(1);
  if (!row || row.status === "removed") throw new SocialError(404, "That startup isn't on Cowork, or was removed.");
  const role = await memberRole(row.id, user.id);
  const rel = await relationship(user.id, row.ownerId);
  if ((row.visibility === "private" && !role) || rel === "blocked" || rel === "blocked_you") throw new SocialError(404, "That startup isn't on Cowork, or was removed.");
  const [members, myInterest, space] = await Promise.all([
    db()
      .select({ userId: sm.userId, role: sm.role, title: sm.title, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl })
      .from(sm)
      .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, sm.userId))
      .innerJoin(schema.users, eq(schema.users.id, sm.userId))
      .where(eq(sm.startupId, row.id))
      .orderBy(sql`case ${sm.role} when 'founder' then 0 when 'cofounder' then 1 when 'mentor' then 2 when 'advisor' then 3 else 4 end`, asc(sm.joinedAt)),
    db().select({ id: si.id, kind: si.kind, status: si.status }).from(si).where(and(eq(si.startupId, row.id), eq(si.userId, user.id), eq(si.status, "pending"))).limit(1),
    row.spaceId ? db().select({ slug: schema.spaces.slug }).from(schema.spaces).where(eq(schema.spaces.id, row.spaceId)).limit(1) : Promise.resolve([]),
  ]);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    oneLiner: row.oneLiner,
    description: row.description,
    stage: row.stage,
    industry: row.industry,
    lookingFor: row.lookingFor,
    skillsNeeded: row.skillsNeeded,
    visibility: row.visibility,
    archived: row.status === "archived",
    members,
    myRole: role,
    canManage: manages(role),
    myInterest: myInterest[0] ?? null,
    /** The team Space, for members only. */
    spaceSlug: role ? (space[0]?.slug ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Public startups, newest first; ?q= over name, one-liner and industry; ?skill= or ?stage= filters. */
export async function discoverStartups(user: User, opts: { q?: string; skill?: string; stage?: string; offset?: number } = {}) {
  await requireNetwork(user);
  const q = (opts.q ?? "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  const skill = normalizeTags(opts.skill ? [opts.skill] : [])[0];
  const offset = Math.min(Math.max(opts.offset ?? 0, 0), 400);
  const rows = await db()
    .select(startupColumns)
    .from(st)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, st.ownerId))
    .where(
      and(
        eq(st.status, "active"),
        eq(st.visibility, "public"),
        notBlocked(user.id, st.ownerId),
        q ? or(ilike(st.name, `%${q}%`), ilike(st.oneLiner, `%${q}%`), ilike(st.industry, `%${q}%`)) : undefined,
        skill ? sql`${skill} = any(${st.skillsNeeded})` : undefined,
        (STAGES as readonly string[]).includes(opts.stage ?? "") ? eq(st.stage, opts.stage as (typeof STAGES)[number]) : undefined,
      ),
    )
    .orderBy(desc(st.createdAt))
    .limit(PAGE)
    .offset(offset);
  return { items: rows, next: rows.length === PAGE ? String(offset + PAGE) : null };
}

export async function myStartups(user: User) {
  await requireNetwork(user);
  return db()
    .select({ ...startupColumns, myRole: sm.role })
    .from(sm)
    .innerJoin(st, eq(st.id, sm.startupId))
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, st.ownerId))
    .where(and(eq(sm.userId, user.id), ne(st.status, "removed")))
    .orderBy(desc(st.createdAt));
}

// ---------- Joining ----------

export async function expressInterest(user: User, startupId: string, input: { kind: "cofounder" | "collaborate" | "mentor"; message?: string }) {
  await requireNetwork(user);
  const [row] = await db().select().from(st).where(eq(st.id, startupId)).limit(1);
  if (!row || row.status !== "active" || row.visibility !== "public") throw new SocialError(404, "That startup isn't taking requests.");
  if (await memberRole(startupId, user.id)) throw new SocialError(409, "You're already on this team.");
  const rel = await relationship(user.id, row.ownerId);
  if (rel === "blocked" || rel === "blocked_you") throw new SocialError(404, "That startup isn't taking requests.");
  const message = (input.message ?? "").trim().slice(0, 1000);
  if (message) {
    const v = await moderateText(user.id, message);
    if (v.verdict === "flagged") throw new SocialError(422, "That message can't be sent. Keep it within the rules.");
  }
  const done = await db().insert(si).values({ startupId, userId: user.id, kind: input.kind, message }).onConflictDoNothing().returning({ id: si.id });
  if (!done.length) throw new SocialError(409, "You already asked. The founders will reply.");
}

export async function withdrawInterest(user: User, startupId: string) {
  await db()
    .update(si)
    .set({ status: "withdrawn", respondedAt: new Date() })
    .where(and(eq(si.startupId, startupId), eq(si.userId, user.id), eq(si.status, "pending")));
}

/** Founders: pending requests with each person's professional profile (as they'd see it). */
export async function listInterests(user: User, startupId: string) {
  await requireNetwork(user);
  if (!manages(await memberRole(startupId, user.id))) throw new SocialError(403, "Only founders can see requests.");
  const rows = await db()
    .select({ id: si.id, userId: si.userId, kind: si.kind, message: si.message, createdAt: si.createdAt, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, headline: pp.headline, skills: pp.skills })
    .from(si)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, si.userId))
    .leftJoin(pp, and(eq(pp.userId, si.userId), ne(pp.visibility, "hidden")))
    .where(and(eq(si.startupId, startupId), eq(si.status, "pending"), notBlocked(user.id, si.userId)))
    .orderBy(asc(si.createdAt));
  return rows.map((r) => ({ ...r, headline: r.headline ?? "", skills: r.skills ?? [] }));
}

const ROLE_FOR = { cofounder: "cofounder", collaborate: "member", mentor: "mentor" } as const;

/** Founders: accept (joins the team and its Space) or decline. */
export async function answerInterest(user: User, interestId: string, accept: boolean) {
  await requireNetwork(user);
  const [req] = await db().select().from(si).where(eq(si.id, interestId)).limit(1);
  if (!req || req.status !== "pending") throw new SocialError(404, "That request isn't there anymore.");
  if (!manages(await memberRole(req.startupId, user.id))) throw new SocialError(403, "Only founders can answer requests.");
  await db().update(si).set({ status: accept ? "accepted" : "declined", respondedAt: new Date() }).where(eq(si.id, interestId));
  if (!accept) return;
  await db().insert(sm).values({ startupId: req.startupId, userId: req.userId, role: ROLE_FOR[req.kind] }).onConflictDoNothing();
  const [row] = await db().select({ spaceId: st.spaceId }).from(st).where(eq(st.id, req.startupId)).limit(1);
  if (row?.spaceId) await addSpaceMember(row.spaceId, req.userId);
}

export async function leaveStartup(user: User, startupId: string) {
  const role = await memberRole(startupId, user.id);
  if (!role) return;
  if (role === "founder") throw new SocialError(409, "The founder can archive the startup, but can't leave it.");
  await db().delete(sm).where(and(eq(sm.startupId, startupId), eq(sm.userId, user.id)));
}

// ---------- Matching ----------

/** Founders: people whose skills cover what the startup needs and who are open to joining. */
export async function matchPeople(user: User, startupId: string) {
  await requireNetwork(user);
  if (!manages(await memberRole(startupId, user.id))) throw new SocialError(403, "Only founders can see matches.");
  const [row] = await db().select({ skills: st.skillsNeeded }).from(st).where(eq(st.id, startupId)).limit(1);
  if (!row?.skills.length) return [];
  const needed = row.skills;
  const neededArr = textArray(needed);
  const overlap = sql<number>`(select count(*)::int from unnest(${pp.skills}) s where s = any(${neededArr}))`;
  const rows = await db()
    .select({ userId: pp.userId, headline: pp.headline, skills: pp.skills, openTo: pp.openTo, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl, overlap })
    .from(pp)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, pp.userId))
    .innerJoin(schema.users, eq(schema.users.id, pp.userId))
    .where(
      and(
        eq(pp.visibility, "everyone"),
        sql`${pp.skills} && ${neededArr}`,
        sql`${pp.openTo} && array['cofounder','collaborate']::text[]`,
        adult(pp.userId),
        notBlocked(user.id, pp.userId),
        sql`not exists (select 1 from ${sm} m where m.startup_id = ${startupId} and m.user_id = ${pp.userId})`,
      ),
    )
    .orderBy(desc(overlap))
    .limit(30);
  return rows.map((r) => ({ ...r, matched: r.skills.filter((s) => needed.includes(s)) }));
}

/** Startups that need your skills (from your professional profile). */
export async function matchStartups(user: User) {
  await requireNetwork(user);
  const mine = await myProProfile(user.id);
  if (!mine?.skills.length) return [];
  const mineArr = textArray(mine.skills);
  const overlap = sql<number>`(select count(*)::int from unnest(${st.skillsNeeded}) s where s = any(${mineArr}))`;
  const rows = await db()
    .select({ ...startupColumns, overlap })
    .from(st)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, st.ownerId))
    .where(
      and(
        eq(st.status, "active"),
        eq(st.visibility, "public"),
        sql`${st.skillsNeeded} && ${mineArr}`,
        notBlocked(user.id, st.ownerId),
        sql`not exists (select 1 from ${sm} m where m.startup_id = ${st.id} and m.user_id = ${user.id})`,
      ),
    )
    .orderBy(desc(overlap), desc(st.createdAt))
    .limit(30);
  return rows.map((r) => ({ ...r, matched: r.skillsNeeded.filter((s) => mine.skills.includes(s)) }));
}

/** People open to mentoring, optionally in one skill. */
export async function findMentors(user: User, skill?: string) {
  await requireNetwork(user);
  const tag = normalizeTags(skill ? [skill] : [])[0];
  return db()
    .select({ userId: pp.userId, headline: pp.headline, skills: pp.skills, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl })
    .from(pp)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, pp.userId))
    .innerJoin(schema.users, eq(schema.users.id, pp.userId))
    .where(
      and(
        eq(pp.visibility, "everyone"),
        sql`'mentor_others' = any(${pp.openTo})`,
        tag ? sql`${tag} = any(${pp.skills})` : undefined,
        adult(pp.userId),
        notBlocked(user.id, pp.userId),
        ne(pp.userId, user.id),
      ),
    )
    .orderBy(desc(pp.updatedAt))
    .limit(30);
}

/** For tests and the admin side: whether a list of ids are all team members. */
export async function teamOf(startupId: string) {
  return db().select({ userId: sm.userId, role: sm.role }).from(sm).where(and(eq(sm.startupId, startupId), inArray(sm.role, ["founder", "cofounder", "member", "mentor", "advisor"])));
}
