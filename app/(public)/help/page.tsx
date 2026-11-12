import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { publicPage } from "@/lib/seo";

export const metadata: Metadata = publicPage({ title: "Help", description: `Answers to common questions about signing in to ${BRAND.name}, your sessions, notifications, exporting your data and deleting your account.`, path: "/help" });

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-6 first:border-t-0">
      <h2 className="text-[17px] font-medium">{q}</h2>
      <div className="mt-2 text-[15px] leading-7 text-muted [&_a]:text-foreground [&_a]:underline [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

/** Each answer describes what the product does today; update it when the behaviour changes. */
export default function Help() {
  const n = BRAND.name;
  return (
    <article>
      <h1 className="pt-8 font-serif text-[34px] leading-tight">Help</h1>
      <p className="mt-3 text-[15px] leading-7 text-muted">
        Can&apos;t find your answer here? Write to <a className="text-foreground underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
      </p>

      <div className="mt-8">
        <Q q="How do I sign in?">
          <p>
            Enter your email address on the <Link href="/login">sign-in page</Link> or in the app. {n} sends you a 6-digit code; enter it to sign in. There is no password. A code works once, for 10 minutes, and
            after 5 wrong tries you need a new one.
          </p>
        </Q>
        <Q q="I didn't get a sign-in code">
          <p>Check your spam or junk folder, and that the address is spelled correctly. You can ask for a new code after a short wait. If codes still don&apos;t arrive, write to support from the same address.</p>
        </Q>
        <Q q="Why was I signed out?">
          <p>A session lasts 30 days from the last time you used {n} on that device. Signing out everywhere, or deleting a session from another device, also signs that device out.</p>
        </Q>
        <Q q="How do I sign out my other devices?">
          <p>
            On the website, open <strong>Settings &gt; Account</strong>. It lists every device signed in to your account; remove one, or choose <strong>Sign out everywhere</strong>.
          </p>
        </Q>
        <Q q="How do I change which notifications I get?">
          <p>
            Open <strong>Settings &gt; Notifications</strong> on the website or in the app. Every email from {n} also has an unsubscribe link at the bottom.
          </p>
        </Q>
        <Q q="How do I get a copy of my data?">
          <p>
            On the website, open <strong>Settings &gt; Data &amp; privacy</strong> and choose <strong>Export JSON</strong> or <strong>Export Markdown</strong>.
          </p>
        </Q>
        <Q q="How do I delete my account?">
          <p>
            See <Link href="/delete-account">Delete your account</Link>. Deleting is immediate and can&apos;t be undone, so export your data first if you want a copy.
          </p>
        </Q>
        <Q q="How do I report a problem or a person?">
          <p>
            In the app, choose <strong>Report</strong> on an assistant answer, a person or a chat. For anything else, write to{" "}
            <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
          </p>
        </Q>
        <Q q="Where can I read the rules?">
          <p>
            The <Link href="/terms">terms of service</Link> and the <Link href="/privacy">privacy policy</Link>.
          </p>
        </Q>
      </div>
    </article>
  );
}
