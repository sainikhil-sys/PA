import type { Metadata } from "next";
import { InboxView } from "@/components/email/inbox-view";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { categoryCounts, listImportantEmails } from "@/lib/db/queries/emails";
import { getGoogleStatus } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function InboxPage() {
  const user = await requireOwner();
  const [emails, counts, google] = await Promise.all([listImportantEmails(user.id, 50), categoryCounts(user.id), getGoogleStatus(user.id)]);
  return (
    <>
      <PageHeader title="Inbox" description="Sorted, summarized, with reply drafts ready when you want them." />
      <InboxView
        connected={google.connected}
        syncError={google.connected ? (google.lastError ?? null) : null}
        counts={counts}
        initial={emails.map((e) => ({ id: e.id, fromName: e.fromName, fromEmail: e.fromEmail, subject: e.subject, summary: e.summary, snippet: e.snippet, category: e.category, receivedAt: e.receivedAt.toISOString(), draftId: e.draftId }))}
      />
    </>
  );
}
