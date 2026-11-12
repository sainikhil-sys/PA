import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { BRAND } from "@/lib/brand";
import { db, schema } from "@/lib/db";
import { mailConfigured, trySendMail } from "@/lib/email/send";
import { esc, h1, layout, p, type Email } from "@/lib/email/templates";
import { env, isTestMode } from "@/lib/env";
import { log } from "@/lib/log";

/** Code that confirms the console owner's address before an authenticator app is set up. */
export function adminCodeEmail(code: string): Email {
  const body = [
    h1("Confirm admin setup"),
    p("Enter this code in the console to set up two-step verification for admin work. It expires in 10 minutes and works once."),
    `<p style="margin:8px 0 24px;font:600 32px/40px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:8px">${esc(code)}</p>`,
    p("If you didn't ask for this, someone may be signed in to your account. Sign out of all devices in Settings and tell support.", true),
  ].join("\n");
  return {
    subject: `${code} is your ${BRAND.name} admin setup code`,
    html: layout({ preheader: `${code} expires in 10 minutes`, body, footer: `Sent by ${esc(BRAND.name)} because admin setup was started for this account.` }),
    text: `Your ${BRAND.name} admin setup code is ${code}.\n\nIt expires in 10 minutes and works once. If you didn't ask for this, sign out of all devices in Settings.\n\n${BRAND.name}`,
  };
}

/** Sends the code. In local development without mail, prints it to the server console only. */
export async function sendAdminCode(to: string, code: string): Promise<boolean> {
  if (isTestMode()) return true;
  if (!mailConfigured()) {
    if (env().NODE_ENV === "production") return false;
    console.info(`\n[dev] ${BRAND.name} admin setup code for ${to}: ${code}\n`);
    return true;
  }
  return trySendMail(to, adminCodeEmail(code), { tag: "admin_code" });
}

/** Emails the owner about a security event (new admin session, lockout, role change). Best effort. */
export async function alertOwner(subject: string, lines: string[]): Promise<void> {
  if (!mailConfigured()) return;
  try {
    const [owner] = await db()
      .select({ email: schema.users.email })
      .from(schema.adminRoleAssignments)
      .innerJoin(schema.users, eq(schema.users.id, schema.adminRoleAssignments.userId))
      .where(and(eq(schema.adminRoleAssignments.role, "owner"), isNull(schema.adminRoleAssignments.revokedAt)))
      .limit(1);
    if (!owner) return;
    const body = [h1(esc(subject)), ...lines.map((l) => p(esc(l))), p("You can see admin sessions and revoke them in the console under Security.", true)].join("\n");
    await trySendMail(
      owner.email,
      { subject: `${BRAND.name} admin: ${subject}`, html: layout({ preheader: lines[0] ?? subject, body, footer: `Security notice from ${esc(BRAND.name)}.` }), text: `${subject}\n\n${lines.join("\n")}` },
      { tag: "admin_alert" },
    );
  } catch (err) {
    log.warn("admin.alert_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
