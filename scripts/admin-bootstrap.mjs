// Grants the first Cowork console roles. This is the only way an OWNER is created: there is no API or
// page for it. Run it yourself, with database access, from the repo root:
//
//   node scripts/admin-bootstrap.mjs --email you@example.com                     (shows what it would do)
//   node scripts/admin-bootstrap.mjs --email you@example.com --yes               (makes you the owner)
//   node scripts/admin-bootstrap.mjs --email ops@example.com --role admin --yes  (grants admin)
//   node scripts/admin-bootstrap.mjs --email new@example.com --transfer --yes    (hands ownership over)
//
// The email may also come from OWNER_EMAIL. Rules:
// - The address must be listed in ADMIN_EMAILS (the bootstrap allowlist).
// - The account must already exist (it signed in with an emailed code, which verifies the address)
//   and must not be disabled.
// - If an owner already exists, a second owner is refused unless --transfer is given. A transfer makes
//   the previous owner an "admin"; it never removes their account.
// - Every change is written to admin_audit_logs, in the same transaction.
// Uses the database in .env.local (DATABASE_URL_UNPOOLED or DATABASE_URL). For production, that IS production.
import { createHash } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const list = (raw) =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const role = value("role") ?? "owner";
if (role !== "owner" && role !== "admin") fail('--role must be "owner" or "admin". Other roles are granted by the owner in the console.');
const email = (value("email") ?? (role === "owner" ? process.env.OWNER_EMAIL : "") ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) fail("Give the email with --email you@example.com (or set OWNER_EMAIL for the owner).");
const allow = list(process.env.ADMIN_EMAILS);
if (!allow.length) fail("ADMIN_EMAILS is not set. Add the address to ADMIN_EMAILS first.");
if (!allow.includes(email)) fail(`${email} is not in ADMIN_EMAILS. Only an address listed there can be given a role by this script.`);

const derived = process.env.DATABASE_URL && /pooler\.supabase\.com:6543\//.test(process.env.DATABASE_URL) ? process.env.DATABASE_URL.replace(":6543/", ":5432/") : undefined;
const url = process.env.DATABASE_URL_UNPOOLED || derived || process.env.DATABASE_URL;
if (!url) fail("Set DATABASE_URL in .env.local first.");

const write = flag("yes");
const transfer = flag("transfer");
const postgres = (await import("postgres")).default;
const sql = postgres(url, { max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require", onnotice: () => {} });

let code = 0;
try {
  const [table] = await sql`select to_regclass('public.admin_role_assignments') as t, to_regclass('public.admin_audit_logs') as a`;
  if (!table?.t || !table?.a) throw new Error("The admin tables don't exist yet. Apply the migrations first (pnpm db:migrate).");

  const [user] = await sql`select id, email, disabled_at from users where lower(email) = ${email} limit 1`;
  if (!user) throw new Error(`No account uses ${email}. Sign in to Cowork with it once (that verifies the address), then run this again.`);
  if (user.disabled_at) throw new Error(`The account ${email} is disabled. Enable it first.`);

  const [current] = await sql`select id, role from admin_role_assignments where user_id = ${user.id} and revoked_at is null limit 1`;
  const [owner] = await sql`select a.id, a.user_id, u.email from admin_role_assignments a join users u on u.id = a.user_id where a.role = 'owner' and a.revoked_at is null limit 1`;

  if (current?.role === role) {
    console.log(`${email} already holds the ${role} role. Nothing to do.`);
  } else if (role === "admin" && current?.role === "owner") {
    throw new Error(`${email} is the owner. To make someone else the owner, run with their email and --transfer.`);
  } else if (role === "owner" && owner && !transfer) {
    throw new Error(`The owner is already ${owner.email}. To hand ownership to ${email}, run again with --transfer.`);
  } else {
    const plan =
      role === "owner" && owner ? `Transfer ownership from ${owner.email} to ${email}. ${owner.email} becomes an admin.` : `Give ${email} the ${role} role${current ? ` (replacing ${current.role})` : ""}.`;
    if (!write) {
      console.log(`${plan}\nNothing was changed. Run again with --yes to do it.`);
    } else {
      await sql.begin(async (tx) => {
        const audit = (action, resourceId, before, after) =>
          tx`insert into admin_audit_logs (actor_user_id, actor_role, action, resource_type, resource_id, before, after, reason, outcome, user_agent)
             values (null, 'bootstrap', ${action}, 'admin_role', ${resourceId}, ${before ? tx.json(before) : null}, ${tx.json(after)}, 'scripts/admin-bootstrap.mjs', 'success', 'bootstrap script')`;
        // Revoke before inserting: the partial unique indexes allow one active role per person and one owner.
        if (role === "owner" && owner) {
          await tx`update admin_role_assignments set revoked_at = now() where id = ${owner.id}`;
          await tx`insert into admin_role_assignments (user_id, role, source, note) values (${owner.user_id}, 'admin', 'bootstrap', 'ownership transferred')`;
          await audit("role.transfer_out", owner.user_id, { role: "owner", emailHash: sha256(owner.email.toLowerCase()) }, { role: "admin" });
        }
        if (current) await tx`update admin_role_assignments set revoked_at = now() where id = ${current.id}`;
        await tx`insert into admin_role_assignments (user_id, role, source) values (${user.id}, ${role}, 'bootstrap')`;
        await audit("role.grant", user.id, current ? { role: current.role } : null, { role, emailHash: sha256(email) });
        // A role change ends any admin sessions the person had.
        await tx`update admin_sessions set revoked_at = now() where user_id = ${user.id} and revoked_at is null`;
      });
      console.log(`Done. ${plan}`);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  code = 1;
} finally {
  await sql.end();
}
process.exit(code);
