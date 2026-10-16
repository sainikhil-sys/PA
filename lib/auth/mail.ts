import "server-only";
import { Resend } from "resend";
import { env, isTestMode } from "@/lib/env";
import { log } from "@/lib/log";

/** Plain, branded sign-in email. No tracking pixels, no links to click. */
export function otpEmailText(code: string): { subject: string; text: string; html: string } {
  const subject = `${code} is your PA sign-in code`;
  const text = `Your PA sign-in code is ${code}.\n\nIt expires in 10 minutes and works once. If you didn't try to sign in, you can ignore this email.\n\n— PA`;
  const html = `<!doctype html><html><body style="margin:0;padding:40px 16px;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" style="max-width:440px;margin:0 auto"><tr><td>
<p style="font-size:15px;margin:0 0 24px;font-weight:600">PA</p>
<p style="font-size:15px;line-height:24px;margin:0 0 16px">Your sign-in code:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:600;margin:0 0 24px;font-variant-numeric:tabular-nums">${code}</p>
<p style="font-size:13px;line-height:20px;color:#52525b;margin:0">It expires in 10 minutes and works once. If you didn't try to sign in, ignore this email.</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const e = env();
  if (isTestMode()) return; // fixed test code; nothing is sent
  const { subject, text, html } = otpEmailText(code);
  if (!e.RESEND_API_KEY) {
    if (e.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not configured");
    // Local development without a mail provider: print the code to the server console only.
    console.info(`\n[dev] PA sign-in code for ${to}: ${code}\n`);
    return;
  }
  const resend = new Resend(e.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: e.MAIL_FROM ?? "PA <onboarding@resend.dev>", to, subject, text, html });
  if (error) {
    log.error("otp.mail_failed", { provider: "resend", error: error.name });
    throw new Error("Could not send the sign-in email");
  }
}
