import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { appUrl } from "@/lib/env";
import { publicPage, SEO } from "@/lib/seo";

export const metadata: Metadata = publicPage({ path: "/home" });

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: BRAND.name, url: appUrl(), logo: `${appUrl()}/api/brand/logo?size=512`, email: BRAND.supportEmail },
    { "@type": "WebSite", name: BRAND.name, url: appUrl() },
    {
      "@type": "SoftwareApplication",
      name: BRAND.name,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android",
      url: `${appUrl()}/home`,
      description: SEO.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

const FEATURES: [string, string][] = [
  ["Daily briefing", "Each morning, a short summary of your meetings, priorities and the emails that need you."],
  ["Inbox triage", "Sorts your Gmail by what matters and drafts replies. Drafts stay in Gmail until you review and send them yourself."],
  ["Tasks and reminders", "Turn an email into a task in one click, add tasks in plain words like “call Ravi tomorrow at 5” with reminders, and import tasks from Asana or Linear."],
  ["Knowledge", "Search and chat with your own docs, notes and links, with citations."],
  ["Works with Claude", "Use your tasks and notes from Claude through a scoped, revocable connection."],
];

export default function HomePage() {
  return (
    <article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      <section className="py-8 sm:py-12">
        <h1 className="font-serif text-[32px] leading-[1.1] tracking-[-0.02em] sm:text-[44px]">{BRAND.name} reads your Gmail and Google Calendar, writes you a short briefing each morning, sorts your inbox and drafts replies you send yourself.</h1>
        <p className="mt-4 max-w-[560px] text-[17px] leading-7 text-muted">
          A personal work assistant for your email, calendar, tasks and notes. It reads and organizes. It never sends email from your Gmail or deletes your mail: replies wait as Gmail drafts you send yourself, and LinkedIn posts go out only when you click Publish.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/login" className="rounded-[10px] bg-primary px-5 py-3 text-sm font-medium text-primary-foreground">
            Get started
          </Link>
          <Link href="/privacy" className="rounded-[10px] border border-border px-5 py-3 text-sm font-medium">
            How we use your data
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="rounded-[16px] border border-border p-5">
            <h2 className="text-[15px] font-medium">{t}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{d}</p>
          </div>
        ))}
      </section>
      <section className="mt-12 rounded-[16px] bg-surface p-6 text-sm leading-6">
        <h2 className="text-[15px] font-medium">Google account access</h2>
        <p className="mt-2 text-muted">
          If you connect Google, {BRAND.name} reads your Gmail messages and calendar events to build your briefing and sort your inbox, and creates Gmail drafts you choose to write. Google&apos;s consent screen calls this permission &quot;Manage drafts and send emails&quot;, but {BRAND.name} only uses it
          to create drafts. You send them yourself from Gmail.
          Use of Google data follows the{" "}
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer" target="_blank">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Details are in our <Link className="underline" href="/privacy">privacy policy</Link>.
        </p>
      </section>
    </article>
  );
}
