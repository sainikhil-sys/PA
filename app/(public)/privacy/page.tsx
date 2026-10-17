import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy policy" };

const UPDATED = "October 17, 2026";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-[18px] font-medium">{children}</h2>;
}

export default function PrivacyPolicy() {
  const n = BRAND.name;
  return (
    <article className="text-[15px] leading-7 [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="pt-8 font-serif text-[34px] leading-tight">Privacy policy</h1>
      <p className="text-sm text-muted">Last updated {UPDATED}</p>

      <p>
        {n} is a personal work assistant. This policy explains what we collect, why, who processes it, and the choices you have. Contact us any time at{" "}
        <a className="underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
      </p>

      <H>What we collect</H>
      <ul>
        <li><strong>Account:</strong> your email address, used to send sign-in codes and the emails you opt into. We don&apos;t use passwords.</li>
        <li><strong>Content you add:</strong> tasks, notes, knowledge sources, chat messages, automations and settings.</li>
        <li><strong>Connected services:</strong> data from services you choose to connect (see below). Access tokens are encrypted at rest with AES-256-GCM.</li>
        <li><strong>Security records:</strong> session records (browser type and a shortened IP prefix), sign-in attempts and an activity log of actions taken in your account.</li>
      </ul>
      <p>We don&apos;t use advertising trackers or analytics cookies. The only cookie is your sign-in session.</p>

      <H>Google user data</H>
      <p>If you connect a Google account, {n} requests:</p>
      <ul>
        <li><strong>Gmail read-only</strong> (gmail.readonly): to show and sort your inbox, flag urgent mail and include it in your daily briefing.</li>
        <li><strong>Gmail compose</strong> (gmail.compose): to create reply drafts in your Gmail when you ask. {n} never sends email for you; you review and send drafts yourself in Gmail.</li>
        <li><strong>Calendar read-only</strong>: to show today&apos;s meetings in your briefing.</li>
        <li><strong>Drive read-only</strong>, if you add Drive as a knowledge source: to index the documents you select for search.</li>
      </ul>
      <p>
        We store email metadata (sender, subject, date, labels) and short AI-generated summaries. Full message bodies are fetched when needed and not stored. Email text is sent to our AI provider only to classify,
        summarize or draft for you, and is not used to train models.
      </p>
      <p>
        {n}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer" target="_blank">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Specifically, we:
      </p>
      <ul>
        <li>use Google data only to provide and improve the user-facing features described above;</li>
        <li>do not transfer it to others except as needed to provide those features (the processors listed below), to comply with law, or as part of a merger or acquisition with notice to you;</li>
        <li>do not use or transfer it for advertising, and do not sell it;</li>
        <li>do not let humans read it, unless you give explicit consent for specific messages, it&apos;s needed for security or legal reasons, or it has been aggregated and anonymized;</li>
        <li>do not use it to develop, improve or train generalized AI or machine-learning models.</li>
      </ul>

      <H>How we use data</H>
      <ul>
        <li>To provide the features you use: briefings, inbox sorting, drafts, tasks, reminders, knowledge search and automations.</li>
        <li>To send sign-in codes, a welcome email, and update and briefing emails you can switch off in settings or from any email.</li>
        <li>To keep the service secure: rate limiting, abuse prevention and audit logs.</li>
      </ul>

      <H>Processors</H>
      <p>We use these service providers to run {n}. They process data only on our instructions:</p>
      <ul>
        <li>Vercel: application hosting.</li>
        <li>Supabase: database.</li>
        <li>Resend: email delivery.</li>
        <li>Our configured AI model provider: classifying, summarizing and drafting text.</li>
        <li>Upstash, if enabled: rate-limit counters (hashed keys, no content).</li>
      </ul>

      <H>Retention and deletion</H>
      <p>
        We keep your data while your account is active. You can disconnect any service, delete indexed knowledge, and export your data from Settings at any time. Disconnecting Google revokes our access and deletes the stored
        tokens. To delete your account and all associated data, email <a className="underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> and we&apos;ll complete it within 30 days. You can also remove
        access at{" "}
        <a className="underline" href="https://myaccount.google.com/permissions" rel="noopener noreferrer" target="_blank">
          myaccount.google.com/permissions
        </a>
        .
      </p>

      <H>Security</H>
      <p>
        Data is encrypted in transit (TLS) and tokens are encrypted at rest. Sign-in codes, sessions and API tokens are stored only as hashes. {n} is built so nothing is sent, posted or deleted on your behalf without your
        explicit click.
      </p>

      <H>Children</H>
      <p>{n} is not intended for children under 16 and we don&apos;t knowingly collect their data.</p>

      <H>Changes</H>
      <p>If we change this policy in a meaningful way, we&apos;ll update the date above and tell you by email or in the app.</p>
    </article>
  );
}
