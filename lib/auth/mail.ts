import "server-only";
import { BRAND } from "@/lib/brand";
import { sendMail } from "@/lib/email/send";
import { otpEmail } from "@/lib/email/templates";
import { env, isTestMode } from "@/lib/env";
import { errMessage, log } from "@/lib/log";

/** Branded sign-in email. No tracking pixels, no links to click. */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const e = env();
  if (isTestMode()) return; // fixed test code; nothing is sent
  if (!e.RESEND_API_KEY) {
    if (e.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not configured");
    // Local development without a mail provider: print the code to the server console only.
    console.info(`\n[dev] ${BRAND.name} sign-in code for ${to}: ${code}\n`);
    return;
  }
  try {
    await sendMail(to, otpEmail(code), { tag: "otp" });
  } catch (err) {
    log.error("otp.mail_failed", { provider: "resend", error: errMessage(err) });
    if (e.NODE_ENV !== "production") {
      // Local development only: don't get locked out by an unverified sender/domain.
      console.info(`\n[dev] Email delivery failed (${errMessage(err)}).\n[dev] ${BRAND.name} sign-in code for ${to}: ${code}\n`);
      return;
    }
    throw new Error("Could not send the sign-in email");
  }
}
