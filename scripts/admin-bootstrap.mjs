// Makes one existing account the Cowork console OWNER. This is the only way an owner is created:
// there is no API or page for it. Run it yourself, with database access, from the repo root:
//
//   node scripts/admin-bootstrap.mjs --email you@example.com            (shows what it would do)
//   node scripts/admin-bootstrap.mjs --email you@example.com --yes      (does it)
//   node scripts/admin-bootstrap.mjs --email new@example.com --transfer --yes
//
// The email may also come from OWNER_EMAIL. Rules:
// - The address must be listed in ADMIN_EMAILS (the bootstrap allowlist).
// - The account must already exist (it signed in with an emailed code, which verifies the address)
//   and must not be disabled.
// - If an owner already exists, nothing changes unless --transfer is given. A transfer makes the
//   previous owner an "admin"; it never removes their account.
// Uses the database in .env.local. For production, that IS production.
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

const email = (value("email") ?? process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) fail("Give the owner's email with --email you@example.com (or set OWNER_EMAIL).");
const allow = list(process.env.ADMIN_EMAILS);
if (!allow.length) fail("ADMIN_EMAILS is not set. Add the owner's address to ADMIN_EMAILS first.");
if (!allow.includes(email)) fail(`${email} is not in ADMIN_EMAILS. Only an address listed there can become the owner.`);

const derived = process.env.DATABASE_URL && /pooler\.supabase\.com:6543\//.test(process.env.DATABASE_URL) ? process.env.DATABASE_URL.replace(":6543/", ":5432/") : undefined;
const url = process.env.DATABASE_URL_UNPOOLED || derived || process.env.DATABASE_URL;
if (!url) fail("Set DATABASE_URL in .env.local first.");

const write = flag("yes");
const transfer = flag("transfer");
const postgres = (await import("postgres")).default;
const sql = postgres(url, { max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require", onnotice: () => {} });

try {
  const [table] = await sql`select to_regclass('public.admin_role_assignments') as t`;
  if (!table?.t) fail("The admin_role_assignments table doesn't exist yet. Apply the migrations first (pnpm db:migrate).");

  const [user] = await sql`select id, email, disabled_at from users where lower(email) = ${email} limit 1`;
  if (!user) fail(`No account uses ${email}. Sign in to Cowork with it once (that verifies the address), then run this again.`);
  if (user.disabled_at) fail(`The account ${email} is disabled. Enable it first.`);

  const [owner] = await sql`select a.user_id, u.email from admin_role_assignments a join users u on u.id = a.user_id where a.role = 'owner' limit 1`;
  if (owner?.user_id === user.id) {
    console.log(`${email} is already the owner. Nothing to do.`);
    process.exit(0);
  }
  if (owner && !transfer) fail(`The owner is already ${owner.email}. To hand ownership to ${email}, run again with --transfer.`);

  const plan = owner ? `Transfer ownership from ${owner.email} to ${email}. ${owner.email} becomes an admin.` : `Make ${email} the owner.`;
  if (!write) {
    console.log(`${plan}\nNothing was changed. Run again with --yes to do it.`);
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    // Demote first: the partial unique index allows only one owner row at a time.
    if (owner) {
      await tx`update admin_role_assignments set role = 'admin', source = 'bootstrap' where user_id = ${owner.user_id}`;
      await tx`insert into activity_log (user_id, actor, tool, input_summary, outcome) values (${owner.user_id}, 'system', 'admin.owner_transferred_away', ${email}, 'success')`;
    }
    await tx`
      insert into admin_role_assignments (user_id, role, granted_by, source)
      values (${user.id}, 'owner', null, 'bootstrap')
      on conflict (user_id) do update set role = 'owner', granted_by = null, source = 'bootstrap'`;
    await tx`insert into activity_log (user_id, actor, tool, input_summary, outcome) values (${user.id}, 'system', 'admin.owner_bootstrapped', ${owner ? `transfer from ${owner.email}` : "first owner"}, 'success')`;
  });
  console.log(`Done. ${plan}`);
} finally {
  await sql.end();
}
