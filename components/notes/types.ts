/** Shapes the notes UI receives from the server (types only, no runtime imports). */

export type NoteSource = "me" | "agent" | "claude" | "system";

export type NoteRow = {
  id: string;
  title: string;
  excerpt: string;
  url: string | null;
  host: string | null;
  /** Fetched from the web page: untrusted, shown as plain text only. */
  linkDescription: string | null;
  tags: string[];
  pinned: boolean;
  source: NoteSource;
  createdAt: string;
  updatedAt: string;
};

export type NoteDetail = NoteRow & { content: string; linkFetchedAt: string | null; indexedAt: string | null };

export type TagCount = { tag: string; n: number };

/** sourceIncluded is null when the knowledge "Notes" source doesn't exist yet. */
export type NotesIndexState = { sourceIncluded: boolean | null; agentCanSearch: boolean };
