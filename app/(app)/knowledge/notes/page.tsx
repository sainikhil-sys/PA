import type { Metadata } from "next";
import { after } from "next/server";
import { NotesPage } from "@/components/notes/notes-page";
import { requireOwner } from "@/lib/auth/session";
import { listNotes, noteTagCounts } from "@/lib/db/queries/notes";
import { errMessage, log } from "@/lib/log";
import { indexMissingNotes, notesIndexState, toNoteRow } from "@/lib/notes/service";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";
// Saving a link fetches the page inside this page's server actions.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ searchParams }: { searchParams: Promise<{ note?: string; new?: string; link?: string }> }) {
  const user = await requireOwner();
  const sp = await searchParams;
  const [rows, tags, index] = await Promise.all([listNotes(user.id, { limit: 50 }), noteTagCounts(user.id), notesIndexState(user.id)]);
  // Copy legacy (MCP-saved) or previously failed notes into the knowledge base after the response.
  after(() => indexMissingNotes(user.id, 20).catch((err) => log.warn("notes.backfill_failed", { error: errMessage(err) })));
  return (
    <NotesPage
      initial={{ notes: rows.map(toNoteRow), tags }}
      index={index}
      openNoteId={sp.note && UUID.test(sp.note) ? sp.note : null}
      openNew={sp.new === "1"}
      openLink={sp.link === "1"}
    />
  );
}
