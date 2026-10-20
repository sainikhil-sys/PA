import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { publicPage } from "@/lib/seo";

export const metadata: Metadata = publicPage({
  title: "Delete your account",
  description: `How to delete your ${BRAND.name} account and all of its data, from the Android app, the website or by email.`,
  path: "/delete-account",
});

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-[18px] font-medium">{children}</h2>;
}

/** Public page for Google Play's account-deletion requirement. Matches what deleteAccount actually does. */
export default function DeleteAccount() {
  const n = BRAND.name;
  return (
    <article className="text-[15px] leading-7 [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="pt-8 font-serif text-[34px] leading-tight">Delete your {n} account</h1>
      <p>You can delete your account and all of its data yourself. It happens immediately and can&apos;t be undone.</p>
      <p>
        If you want a copy first, sign in on the website, open Settings &gt; Privacy and choose <strong>Export JSON</strong> or <strong>Export Markdown</strong>.
      </p>

      <H>In the Android app</H>
      <ol>
        <li>Open {n} and tap <strong>Me</strong>.</li>
        <li>Tap <strong>Delete account</strong>.</li>
        <li>Type DELETE to confirm.</li>
      </ol>

      <H>On the website</H>
      <ol>
        <li>Sign in and open <strong>Settings</strong>, then <strong>Privacy</strong>.</li>
        <li>Choose <strong>Delete account</strong> and type DELETE to confirm.</li>
      </ol>

      <H>By email</H>
      <p>
        Email <a className="underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> from the address you sign in with and ask us to delete your account. We&apos;ll do it within 30 days
        and reply to confirm.
      </p>

      <H>What is deleted</H>
      <ul>
        <li>Your account, profile and settings.</li>
        <li>Chats, memories, tasks, notes, knowledge sources and automations, with their history.</li>
        <li>Connected services and their stored access tokens, so {n} can no longer reach them.</li>
        <li>Linked phones and the notifications they sent, sessions on every device, and API tokens.</li>
      </ul>
      <p>
        To also remove {n} from your Google account&apos;s list of connected apps, visit{" "}
        <a className="underline" href="https://myaccount.google.com/permissions" rel="noopener noreferrer" target="_blank">
          myaccount.google.com/permissions
        </a>
        .
      </p>
    </article>
  );
}
