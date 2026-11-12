import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, authHeaders, messageFrom } from "@/lib/api";
import { API_URL } from "@/lib/config";

/**
 * Cowork Connect social features (online). Everything here talks to /api/connect on the Cowork server,
 * which checks circle membership on every request.
 */

// ---------- Types (mirror the server's JSON) ----------
export type CircleSummary = { id: string; name: string; description: string; role: "owner" | "member"; members: number };
export type CircleMember = { userId: string; name: string; role: string; isMe: boolean; blocked: boolean };
export type CircleDetail = { id: string; name: string; description: string; role: "owner" | "member"; inviteCode: string | null; members: CircleMember[] };
export type Invite = { id: string; circleId: string; circleName: string; invitedBy: string; createdAt: string };
export type Post = { id: string; author: string; authorId: string; mine: boolean; body: string; createdAt: string };
export type Poll = { id: string; question: string; options: string[]; counts: number[]; total: number; myVote: number | null; closed: boolean; createdBy: string; mine: boolean; createdAt: string };
export type NoteSummary = { id: string; title: string; version: number; updatedBy: string | null; updatedAt: string };
export type Note = NoteSummary & { body: string };
export type RoomSummary = { id: string; kind: "focus" | "listen"; title: string; timerStatus: string; hasMedia: boolean; present: number };
export type RoomView = {
  id: string;
  kind: "focus" | "listen";
  title: string;
  serverNow: string;
  timer: { status: "idle" | "running" | "paused" | "done"; durationSec: number; endsAt: string | null; remainingSec: number | null };
  media: { url: string; kind: "youtube" | "spotify"; startAt: string | null } | null;
  present: { userId: string; name: string; isMe: boolean }[];
  heartbeatMs: number;
  /** Phone clock when this copy arrived (added by the app, not the server). serverNow minus this is the clock skew. */
  receivedAt: number;
};
export type EventItem = {
  id: string;
  title: string;
  description: string;
  place: string;
  startsAt: string;
  endsAt: string | null;
  circleId: string | null;
  communityId: string | null;
  groupName: string;
  createdBy: string;
  mine: boolean;
  going: number;
  maybe: number;
  myRsvp: "going" | "maybe" | "no" | null;
};
export type EventDetail = EventItem & { canRsvp: boolean; canManage: boolean };
export type Community = { id: string; name: string; description: string; kind: "campus" | "interest"; members: number; joined: boolean };
export type PlanStep = { title: string; detail: string; suggestedAt: string | null; durationMinutes: number | null };
export type Plan = { summary: string; steps: PlanStep[]; timezone: string };
export type MemeTemplate = { id: string; name: string; lines: string[] };
export type CardFields = { displayName: string; headline: string; organization: string; email: string; phone: string; website: string; note: string };
export type MyCard = CardFields & { shareCode: string; shareEnabled: boolean; updatedAt: string };
export type Blocked = { userId: string; name: string; createdAt: string };
export type ReportKind = "user" | "post" | "circle" | "community" | "event" | "poll" | "note";
export type ReportReason = "harassment" | "spam" | "hate" | "sexual" | "violence" | "self_harm" | "impersonation" | "other";

// ---------- Keys ----------
export const socialKeys = {
  circles: ["connect", "circles"] as const,
  circle: (id: string) => ["connect", "circle", id] as const,
  invites: ["connect", "invites"] as const,
  posts: (id: string) => ["connect", "posts", id] as const,
  polls: (id: string) => ["connect", "polls", id] as const,
  notes: (id: string) => ["connect", "notes", id] as const,
  note: (circleId: string, id: string) => ["connect", "note", circleId, id] as const,
  rooms: (id: string) => ["connect", "rooms", id] as const,
  room: (circleId: string, id: string) => ["connect", "room", circleId, id] as const,
  events: (scope: string) => ["connect", "events", scope] as const,
  event: (id: string) => ["connect", "event", id] as const,
  communities: (q: string, mine: boolean) => ["connect", "communities", q, mine] as const,
  community: (id: string) => ["connect", "community", id] as const,
  card: ["connect", "card"] as const,
  blocks: ["connect", "blocks"] as const,
  memes: ["connect", "memes"] as const,
};

const enc = encodeURIComponent;

// ---------- Circles ----------
export const useCircles = () => useQuery({ queryKey: socialKeys.circles, queryFn: () => api<{ items: CircleSummary[] }>("/api/connect/circles").then((r) => r.items) });
export const useCircle = (id: string) => useQuery({ queryKey: socialKeys.circle(id), queryFn: () => api<CircleDetail>(`/api/connect/circles/${enc(id)}`) });
export const useInvites = () => useQuery({ queryKey: socialKeys.invites, queryFn: () => api<{ items: Invite[] }>("/api/connect/invites").then((r) => r.items) });

export function useCircleActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: socialKeys.circles });
    void qc.invalidateQueries({ queryKey: socialKeys.invites });
    if (id) void qc.invalidateQueries({ queryKey: socialKeys.circle(id) });
  };
  return {
    create: useMutation({ mutationFn: (v: { name: string; description: string }) => api<{ id: string }>("/api/connect/circles", { body: v }), onSuccess: () => refresh() }),
    join: useMutation({ mutationFn: (code: string) => api<{ id: string; name: string }>("/api/connect/circles/join", { body: { code } }), onSuccess: () => refresh() }),
    respond: useMutation({
      mutationFn: (v: { id: string; action: "accept" | "decline" }) => api<{ circleId?: string }>(`/api/connect/invites/${enc(v.id)}`, { body: { action: v.action } }),
      onSuccess: () => refresh(),
    }),
    invite: useMutation({ mutationFn: (v: { circleId: string; email: string }) => api<{ message: string }>(`/api/connect/circles/${enc(v.circleId)}/invites`, { body: { email: v.email } }) }),
    update: useMutation({
      mutationFn: (v: { circleId: string; name?: string; description?: string; newInviteCode?: boolean }) =>
        api<{ inviteCode: string | null }>(`/api/connect/circles/${enc(v.circleId)}`, { method: "PATCH", body: { name: v.name, description: v.description, newInviteCode: v.newInviteCode } }),
      onSuccess: (_d, v) => refresh(v.circleId),
    }),
    leave: useMutation({ mutationFn: (circleId: string) => api(`/api/connect/circles/${enc(circleId)}/leave`, { body: {} }), onSuccess: () => refresh() }),
    remove: useMutation({ mutationFn: (circleId: string) => api(`/api/connect/circles/${enc(circleId)}`, { method: "DELETE" }), onSuccess: () => refresh() }),
    removeMember: useMutation({
      mutationFn: (v: { circleId: string; userId: string }) => api(`/api/connect/circles/${enc(v.circleId)}/members/${enc(v.userId)}`, { method: "DELETE" }),
      onSuccess: (_d, v) => refresh(v.circleId),
    }),
  };
}

// ---------- Posts (cursor pages, newest first) ----------
export function usePosts(circleId: string) {
  return useInfiniteQuery({
    queryKey: socialKeys.posts(circleId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ items: Post[]; nextCursor: string | null }>(`/api/connect/circles/${enc(circleId)}/posts${pageParam ? `?before=${enc(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 20_000,
  });
}

export function usePostActions(circleId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: socialKeys.posts(circleId) });
  return {
    send: useMutation({ mutationFn: (body: string) => api(`/api/connect/circles/${enc(circleId)}/posts`, { body: { body } }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (postId: string) => api(`/api/connect/circles/${enc(circleId)}/posts/${enc(postId)}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

// ---------- Polls ----------
export const usePolls = (circleId: string) =>
  useQuery({ queryKey: socialKeys.polls(circleId), queryFn: () => api<{ items: Poll[] }>(`/api/connect/circles/${enc(circleId)}/polls`).then((r) => r.items), refetchInterval: 30_000 });

export function usePollActions(circleId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: socialKeys.polls(circleId) });
  return {
    create: useMutation({ mutationFn: (v: { question: string; options: string[] }) => api(`/api/connect/circles/${enc(circleId)}/polls`, { body: v }), onSuccess: refresh }),
    vote: useMutation({ mutationFn: (v: { pollId: string; vote: number }) => api(`/api/connect/circles/${enc(circleId)}/polls/${enc(v.pollId)}`, { body: { vote: v.vote } }), onSuccess: refresh }),
    close: useMutation({ mutationFn: (pollId: string) => api(`/api/connect/circles/${enc(circleId)}/polls/${enc(pollId)}`, { body: { close: true } }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (pollId: string) => api(`/api/connect/circles/${enc(circleId)}/polls/${enc(pollId)}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

// ---------- Collaborative notes ----------
export const useNotes = (circleId: string) =>
  useQuery({ queryKey: socialKeys.notes(circleId), queryFn: () => api<{ items: NoteSummary[] }>(`/api/connect/circles/${enc(circleId)}/notes`).then((r) => r.items) });
export const useNote = (circleId: string, noteId: string, enabled = true) =>
  useQuery({ queryKey: socialKeys.note(circleId, noteId), queryFn: () => api<Note>(`/api/connect/circles/${enc(circleId)}/notes/${enc(noteId)}`), enabled });

/** Result of saving a note: saved, or a conflict carrying the version someone else saved meanwhile. */
export type NoteSave = { kind: "saved"; note: Note } | { kind: "conflict"; latest: Note; message: string };

/** PUT with version check. A 409 is not an error here: it returns the latest note so the screen can merge. */
export async function saveNote(circleId: string, noteId: string, v: { title: string; body: string; version: number }): Promise<NoteSave> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/connect/circles/${enc(circleId)}/notes/${enc(noteId)}`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(v),
    });
  } catch {
    throw new ApiError(0, "You're offline. Your text is still here; save again when you are back online.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 409 && body && typeof body === "object" && "latest" in body) {
    const b = body as { latest: Note; message?: string };
    return { kind: "conflict", latest: b.latest, message: b.message ?? "Someone else saved this note while you were editing." };
  }
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status));
  return { kind: "saved", note: (body as { note: Note }).note };
}

export function useNoteActions(circleId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: socialKeys.notes(circleId) });
  return {
    create: useMutation({ mutationFn: (v: { title: string; body: string }) => api<{ id: string; version: number }>(`/api/connect/circles/${enc(circleId)}/notes`, { body: v }), onSuccess: refresh }),
    save: useMutation({
      mutationFn: (v: { noteId: string; title: string; body: string; version: number }) => saveNote(circleId, v.noteId, { title: v.title, body: v.body, version: v.version }),
      onSuccess: (r, v) => {
        refresh();
        if (r.kind === "saved") qc.setQueryData(socialKeys.note(circleId, v.noteId), r.note);
      },
    }),
    remove: useMutation({ mutationFn: (noteId: string) => api(`/api/connect/circles/${enc(circleId)}/notes/${enc(noteId)}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

// ---------- Rooms: Focus Together and listen together ----------
export const useRooms = (circleId: string) =>
  useQuery({ queryKey: socialKeys.rooms(circleId), queryFn: () => api<{ items: RoomSummary[] }>(`/api/connect/circles/${enc(circleId)}/rooms`).then((r) => r.items), refetchInterval: 30_000 });
const stamp = (room: Omit<RoomView, "receivedAt">): RoomView => ({ ...room, receivedAt: Date.now() });
export const useRoom = (circleId: string, roomId: string) =>
  useQuery({
    queryKey: socialKeys.room(circleId, roomId),
    queryFn: () => api<Omit<RoomView, "receivedAt">>(`/api/connect/circles/${enc(circleId)}/rooms/${enc(roomId)}`).then(stamp),
    refetchInterval: 10_000,
  });

export type RoomAction =
  | { action: "start"; minutes: number }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "reset" }
  | { action: "media"; url: string }
  | { action: "restart" }
  | { action: "clearMedia" };

export function useRoomActions(circleId: string) {
  const qc = useQueryClient();
  const base = (roomId: string) => `/api/connect/circles/${enc(circleId)}/rooms/${enc(roomId)}`;
  const put = (roomId: string) => (r: { room: Omit<RoomView, "receivedAt"> }) => qc.setQueryData(socialKeys.room(circleId, roomId), stamp(r.room));
  return {
    create: useMutation({
      mutationFn: (v: { kind: "focus" | "listen"; title: string }) => api<{ id: string }>(`/api/connect/circles/${enc(circleId)}/rooms`, { body: v }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: socialKeys.rooms(circleId) }),
    }),
    act: useMutation({
      mutationFn: (v: { roomId: string; a: RoomAction }) => api<{ room: Omit<RoomView, "receivedAt"> }>(base(v.roomId), { method: "PATCH", body: v.a }),
      onSuccess: (r, v) => put(v.roomId)(r),
    }),
    remove: useMutation({
      mutationFn: (roomId: string) => api(base(roomId), { method: "DELETE" }),
      onSuccess: () => void qc.invalidateQueries({ queryKey: socialKeys.rooms(circleId) }),
    }),
    /** Heartbeat: only called while the person has "Show that I am here" on. */
    heartbeat: (roomId: string) => api<{ room: Omit<RoomView, "receivedAt"> }>(`${base(roomId)}/presence`, { body: { consent: true } }).then(put(roomId)),
    leave: (roomId: string) => api(`${base(roomId)}/presence`, { method: "DELETE" }),
  };
}

// ---------- Events ----------
export const useEvents = (scope: { circleId?: string; communityId?: string } = {}) => {
  const qs = scope.circleId ? `?circleId=${enc(scope.circleId)}` : scope.communityId ? `?communityId=${enc(scope.communityId)}` : "";
  return useQuery({ queryKey: socialKeys.events(qs || "mine"), queryFn: () => api<{ items: EventItem[] }>(`/api/connect/events${qs}`).then((r) => r.items) });
};
export const useEvent = (id: string) => useQuery({ queryKey: socialKeys.event(id), queryFn: () => api<EventDetail>(`/api/connect/events/${enc(id)}`) });

export function useEventActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["connect", "events"] });
  return {
    create: useMutation({
      mutationFn: (v: { circleId?: string; communityId?: string; title: string; description: string; place: string; startsAt: string; endsAt?: string }) => api<{ id: string }>("/api/connect/events", { body: v }),
      onSuccess: refresh,
    }),
    rsvp: useMutation({
      mutationFn: (v: { id: string; status: "going" | "maybe" | "no" }) => api(`/api/connect/events/${enc(v.id)}`, { body: { status: v.status } }),
      onSuccess: (_d, v) => {
        refresh();
        void qc.invalidateQueries({ queryKey: socialKeys.event(v.id) });
      },
    }),
    cancel: useMutation({ mutationFn: (id: string) => api(`/api/connect/events/${enc(id)}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

// ---------- Communities ----------
export const useCommunities = (q: string, mine = false) =>
  useQuery({
    queryKey: socialKeys.communities(q, mine),
    queryFn: () => api<{ items: Community[] }>(`/api/connect/communities?q=${enc(q)}${mine ? "&mine=1" : ""}`).then((r) => r.items),
  });
export const useCommunity = (id: string) => useQuery({ queryKey: socialKeys.community(id), queryFn: () => api<Community>(`/api/connect/communities/${enc(id)}`) });

export function useCommunityActions() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["connect", "communities"] });
    if (id) void qc.invalidateQueries({ queryKey: socialKeys.community(id) });
    void qc.invalidateQueries({ queryKey: ["connect", "events"] });
  };
  return {
    create: useMutation({ mutationFn: (v: { name: string; description: string; kind: "campus" | "interest" }) => api<{ id: string }>("/api/connect/communities", { body: v }), onSuccess: () => refresh() }),
    join: useMutation({ mutationFn: (id: string) => api(`/api/connect/communities/${enc(id)}`, { body: {} }), onSuccess: (_d, id) => refresh(id) }),
    leave: useMutation({ mutationFn: (id: string) => api(`/api/connect/communities/${enc(id)}`, { method: "DELETE" }), onSuccess: (_d, id) => refresh(id) }),
  };
}

// ---------- AI: group plan and meme captions ----------
export const usePlan = (circleId: string) => useMutation({ mutationFn: (goal: string) => api<Plan>(`/api/connect/circles/${enc(circleId)}/plan`, { body: { goal } }) });
export function useAddPlanTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { circleId: string } & PlanStep) =>
      api<{ id: string }>("/api/connect/plan/task", { body: { circleId: v.circleId, title: v.title, detail: v.detail, suggestedAt: v.suggestedAt, durationMinutes: v.durationMinutes } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}
export const useMemeTemplates = () => useQuery({ queryKey: socialKeys.memes, queryFn: () => api<{ items: MemeTemplate[] }>("/api/connect/memes").then((r) => r.items), staleTime: 3_600_000 });
export const useMemeCaptions = () => useMutation({ mutationFn: (v: { template: string; topic: string }) => api<{ options: string[][] }>("/api/connect/memes", { body: v }).then((r) => r.options) });

// ---------- Business card ----------
export const useMyCard = () => useQuery({ queryKey: socialKeys.card, queryFn: () => api<{ card: MyCard | null; suggestedName: string }>("/api/connect/card") });
export function useSaveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CardFields & { shareEnabled: boolean; newShareCode?: boolean }) => api<{ card: MyCard }>("/api/connect/card", { method: "PUT", body: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: socialKeys.card }),
  });
}
export const fetchSharedCard = (code: string) => api<{ card: CardFields; mine: boolean }>(`/api/connect/card/${enc(code)}`);

// ---------- Safety: block and report ----------
export const useBlocks = () => useQuery({ queryKey: socialKeys.blocks, queryFn: () => api<{ items: Blocked[] }>("/api/connect/blocks").then((r) => r.items) });
export function useBlockActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["connect"] });
  return {
    block: useMutation({ mutationFn: (userId: string) => api("/api/connect/blocks", { body: { userId } }), onSuccess: refresh }),
    unblock: useMutation({ mutationFn: (userId: string) => api(`/api/connect/blocks/${enc(userId)}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}
export const useReport = () =>
  useMutation({ mutationFn: (v: { targetKind: ReportKind; targetId: string; reason: ReportReason; note?: string }) => api<{ message: string }>("/api/connect/reports", { body: v }) });
