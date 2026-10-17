import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { publicPage } from "@/lib/seo";

export const metadata: Metadata = publicPage({ title: "Terms of service", description: `The terms for using ${BRAND.name}, the AI work assistant.`, path: "/terms" });

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-[18px] font-medium">{children}</h2>;
}

export default function Terms() {
  const n = BRAND.name;
  return (
    <article className="text-[15px] leading-7 [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="pt-8 font-serif text-[34px] leading-tight">Terms of service</h1>
      <p className="text-sm text-muted">Last updated October 17, 2026</p>

      <p>By using {n} you agree to these terms. If you don&apos;t agree, please don&apos;t use the service.</p>

      <H>The service</H>
      <p>
        {n} helps you organize your email, calendar, tasks and notes. AI-generated summaries, classifications and drafts can be wrong; review them before relying on them. {n} never sends, posts or deletes anything for
        you without your explicit action, and you are responsible for what you choose to send or publish.
      </p>

      <H>Your account</H>
      <ul>
        <li>Keep access to your email account secure; anyone who can read it can sign in.</li>
        <li>You must be at least 16 years old.</li>
        <li>Don&apos;t misuse the service: no unlawful use, spam, attempts to break security, or overloading the system.</li>
      </ul>

      <H>Your content</H>
      <p>
        You own your content. You give us permission to store and process it only to provide {n} to you, as described in our <Link className="underline" href="/privacy">privacy policy</Link>.
      </p>

      <H>Connected services</H>
      <p>When you connect Google or another service, your use of that service is also governed by its own terms. You can disconnect at any time in Settings.</p>

      <H>Availability and changes</H>
      <p>
        The service is provided &quot;as is&quot;, without warranties. We may change or discontinue features, and we may suspend accounts that break these terms. To the extent the law allows, we aren&apos;t liable for indirect or
        consequential losses.
      </p>

      <H>Ending your use</H>
      <p>
        You can stop using {n} and ask us to delete your account at any time by emailing <a className="underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
      </p>

      <H>Contact</H>
      <p>
        Questions: <a className="underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
      </p>
    </article>
  );
}
