import "server-only";
import { adminEmails, allowedEmails, signupOpen } from "@/lib/env";
import { canSignIn, isEmailAllowed } from "./otp-core";

/** Whether this address may sign in / keep a session under the current SIGNUP_MODE. */
export function mayUseApp(email: string): boolean {
  return canSignIn(email, { open: signupOpen(), allowed: allowedEmails() });
}

/** Admins receive Telegram alerts (the bot posts to ONE configured chat, so never anyone else's notifications). */
export function isAdmin(email: string): boolean {
  return isEmailAllowed(email, adminEmails());
}
