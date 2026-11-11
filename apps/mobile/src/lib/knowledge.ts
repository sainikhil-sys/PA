import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";


/** Notes, bookmarks, the agenda, meeting notes and search: shapes and hooks (server routes in the comments). */

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
  source: string;
  createdAt: string;
  updatedAt: string;
};
export type NoteDetail = NoteRow & { content: string; linkFetchedAt: string | null; indexedAt: string | null };
export type NoteKind = "all" | "notes" | "bookmarks";

export type ScheduleEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; meetingUrl: string | null; attendees: number; hasNotes: boolean };
export type ScheduleTask = { id: string; title: string; start: string; durationMinutes: number; status: string; recurring: boolean };
export type Schedule = { timezone: string; calendar: "ok" | "not_connected" | "error"; events: ScheduleEvent[]; tasks: ScheduleTask[] };

export type MeetingProposal = { id: string; kind: string; label: string; summary: string; status: string };
export type MeetingView = {
  notes: string;
  summary: string | null;
  decisions: string[];
  summarizedAt: string | null;
  updatedAt: string;
  items: { title: string; owner: string | null; due: string | null; proposal: MeetingProposal | null }[];
};
export type MeetingDetail = {
  calendar: "ok" | "not_connected" | "error";
  event: { id: string; title: string; start: string; end: string | null; attendees: number; meetingUrl: string | null; allDay: boolean } | null;
  note: MeetingView | null;
};

export type SearchResults = {
  q: string;
  chats: { id: string; title: string; updatedAt: string }[];
  tasks: { id: string; title: string; done: boolean; dueDate: string | null }[];
  notes: { id: string; title: string; bookmark: boolean }[];
  documents: { id: string; title: string; url: string | null }[];
  memories: { id: string; content: string }[];
};

export const knowledgeKeys = {
  notes: (kind: NoteKind, q: string) => ["notes", kind, q] as const,
  note: (id: string) => ["note", id] as const,
  schedule: (from: string) => ["schedule", from] as const,
  meeting: (eventId: string) => ["meeting", eventId] as const,
  search: (q: string) => ["search", q] as const,
};

/** GET /api/notes (shared with the web). Pinned first, then newest. */
export const useNotes = (kind: NoteKind, q: string) =>
  useQuery({
    queryKey: knowledgeKeys.notes(kind, q),
    placeholderData: keepPreviousData,
    queryFn: () => {
      const p = new URLSearchParams({ kind, limit: "100" });
      if (q) p.set("q", q);
      return api<{ notes: NoteRow[] }>(`/api/notes?${p}`).then((r) => r.notes);
    },
  });

/** GET /api/notes/[id] (shared with the web). */
export const useNote = (id: string | undefined) =>
  useQuery({ queryKey: knowledgeKeys.note(id ?? ""), enabled: Boolean(id), queryFn: () => api<NoteDetail>(`/api/notes/${id}`) });

/** Refresh every notes list and search after a write. */
export function useInvalidateNotes() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["notes"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    if (id) void qc.invalidateQueries({ queryKey: knowledgeKeys.note(id) });
  };
}

export function useSaveNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (v: { id?: string; title: string; content: string; tags: string[] }) =>
      v.id
        ? api<{ ok: true }>(`/api/mobile/notes/${v.id}`, { method: "PATCH", body: { title: v.title, content: v.content, tags: v.tags } }).then(() => ({ id: v.id! }))
        : api<{ ok: true; id: string }>("/api/mobile/notes", { body: { title: v.title, content: v.content, tags: v.tags } }),
    onSuccess: (r) => invalidate(r.id),
  });
}

export function useSaveBookmark() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (url: string) => api<{ ok: true; id: string; existed: boolean; fetched: boolean; reason: string | null }>("/api/mobile/notes/bookmark", { body: { url } }),
    onSuccess: (r) => invalidate(r.id),
  });
}

/** GET /api/schedule (shared with the web): calendar events and scheduled tasks, at most 45 days. */
export const useSchedule = (from: Date, to: Date) =>
  useQuery({
    queryKey: knowledgeKeys.schedule(from.toISOString()),
    placeholderData: keepPreviousData,
    queryFn: () => api<Schedule>(`/api/schedule?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  });

/** GET /api/meetings (shared with the web): the saved notes, or the calendar event when there are none. */
export const useMeeting = (eventId: string, at: string | undefined) =>
  useQuery({
    queryKey: knowledgeKeys.meeting(eventId),
    queryFn: () => api<MeetingDetail>(`/api/meetings?eventId=${encodeURIComponent(eventId)}${at ? `&at=${encodeURIComponent(at)}` : ""}`),
  });

/** GET /api/mobile/search: chats, tasks, notes, documents and memories that match. */
export const useSearch = (q: string) =>
  useQuery({
    queryKey: knowledgeKeys.search(q),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: () => api<SearchResults>(`/api/mobile/search?q=${encodeURIComponent(q)}`),
  });

