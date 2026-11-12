import "server-only";
import { getConfigValue } from "@/lib/config/store";
import { adminEmails, allowedEmails, signupOpen } from "@/lib/env";
import { canSignIn, isEmailAllowed, signInAllowed } from "./otp-core";

/**
 * Whether this address may sign in / keep a session. SIGNUP_MODE sets the server default; the
 * console's registration.open overrides it for new accounts (null follows SIGNUP_MODE). Closing
 * registration never signs out or locks out an existing account the server setting admits.
 */
export async function mayUseApp(email: string, opts: { hasAccount: boolean }): Promise<boolean> {
  const envOpen = signupOpen();
  const allowed = allowedEmails();
  // Fast path for every signed-in request: the server setting already admits this account.
  if (opts.hasAccount && canSignIn(email, { open: envOpen, allowed })) return true;
  const registrationOpen = await getConfigValue<boolean | null>("registration.open");
  return signInAllowed(email, { hasAccount: opts.hasAccount, envOpen, registrationOpen: registrationOpen ?? null, allowed });
}

/** Admins receive Telegram alerts (the bot posts to ONE configured chat, so never anyone else's notifications). */
export function isAdmin(email: string): boolean {
  return isEmailAllowed(email, adminEmails());
}
