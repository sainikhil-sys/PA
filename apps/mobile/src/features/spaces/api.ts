import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { patchPost } from "@/features/feed/api";
import type { Post } from "@/features/feed/types";
import type { MemberAction, Space, SpaceCategory, SpaceEvent, SpaceMember, SpacePostsPage } from "./types";

export const spaceKeys = {
  all: ["spaces"] as const,
  mine: ["spaces", "mine"] as const,
  discover: (q: string, category: string) => ["spaces", "discover", q, category] as const,
  space: (id: string) => ["spaces", "one", id] as const,
  posts: (id: string) => ["spaces", "posts", id] as const,
  events: (id: string) => ["spaces", "events", id] as const,
  members: (id: string, status: string) => ["spaces", "members", id, status] as const,
};

/** True when the server answered 404 for the whole Spaces API (deployed before Spaces existed). */
export const spacesMissing = (e: unknown) => e instanceof ApiError && e.status === 404;

export const useMySpaces = () => useQuery({ queryKey: spaceKeys.mine, retry: (n, e) => !spacesMissing(e) && n < 2, queryFn: () => api<{ items: Space[] }>("/api/spaces/mine").then((r) => r.items) });

export function useDiscoverSpaces(q: string, category: SpaceCategory | "") {
  return useInfiniteQuery({
    queryKey: spaceKeys.discover(q, category),
    initialPageParam: "0",
    placeholderData: keepPreviousData,
    retry: (n, e) => !spacesMissing(e) && n < 2,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ offset: pageParam });
      if (q) p.set("q", q);
      if (category) p.set("category", category);
      return api<{ items: Space[]; next: string | null }>(`/api/spaces?${p.toString()}`);
    },
    getNextPageParam: (last) => last.next,
  });
}

export const useSpace = (idOrSlug: string) => useQuery({ queryKey: spaceKeys.space(idOrSlug), queryFn: () => api<{ space: Space }>(`/api/spaces/${encodeURIComponent(idOrSlug)}`).then((r) => r.space) });

export function useSpacePosts(spaceId: string | undefined) {
  return useInfiniteQuery({
    queryKey: spaceKeys.posts(spaceId ?? ""),
    enabled: Boolean(spaceId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<SpacePostsPage>(`/api/spaces/${spaceId}/posts${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next,
  });
}

export const useSpaceEvents = (spaceId: string | undefined) =>
  useQuery({ queryKey: spaceKeys.events(spaceId ?? ""), enabled: Boolean(spaceId), queryFn: () => api<{ items: SpaceEvent[] }>(`/api/spaces/${spaceId}/events`).then((r) => r.items) });

export const useSpaceMembers = (spaceId: string | undefined, status: "active" | "requested" | "banned" = "active", enabled = true) =>
  useQuery({
    queryKey: spaceKeys.members(spaceId ?? "", status),
    enabled: Boolean(spaceId) && enabled,
    queryFn: () => api<{ items: SpaceMember[] }>(`/api/spaces/${spaceId}/members?status=${status}`).then((r) => r.items),
  });

export function useSpaceActions(spaceId: string | undefined) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: spaceKeys.all });
  return {
    join: useMutation({ mutationFn: (inviteCode?: string) => api<{ space: Space }>(`/api/spaces/${spaceId}/join`, { body: { inviteCode: inviteCode ?? null } }).then((r) => r.space), onSettled: refresh }),
    leave: useMutation({ mutationFn: () => api(`/api/spaces/${spaceId}/leave`, { body: {} }), onSettled: refresh }),
    post: useMutation({
      mutationFn: (v: { body: string; kind?: "post" | "announcement"; poll?: { options: string[]; multiple?: boolean } | null }) => api<{ post: Post }>(`/api/spaces/${spaceId}/posts`, { body: v }).then((r) => r.post),
      onSettled: refresh,
    }),
    member: useMutation({ mutationFn: (v: { userId: string; action: MemberAction }) => api(`/api/spaces/${spaceId}/members`, { body: v }), onSettled: refresh }),
    invite: useMutation({ mutationFn: () => api<{ invite: { code: string; expiresAt: string | null } }>(`/api/spaces/${spaceId}/invites`, { body: { expiresInHours: 168 } }).then((r) => r.invite) }),
    event: useMutation({
      mutationFn: (v: { title: string; description?: string; location?: string; startsAt: string; endsAt?: string | null }) => api<{ id: string }>(`/api/spaces/${spaceId}/events`, { body: v }),
      onSettled: refresh,
    }),
    rsvp: useMutation({ mutationFn: (v: { eventId: string; status: "going" | "maybe" | "not_going" }) => api(`/api/events/${v.eventId}/rsvp`, { body: { status: v.status } }), onSettled: refresh }),
    moderate: useMutation({ mutationFn: (v: { postId: string; action: "pin" | "unpin" | "remove" }) => api(`/api/posts/${v.postId}/moderate`, { body: { action: v.action } }), onSettled: refresh }),
  };
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; description?: string; rules?: string; category?: SpaceCategory; visibility: "public" | "private"; joinPolicy: "open" | "request" | "invite" }) =>
      api<{ space: Space }>("/api/spaces", { body: v }).then((r) => r.space),
    onSuccess: () => void qc.invalidateQueries({ queryKey: spaceKeys.all }),
  });
}

/** Vote in a poll; the server returns the post with new counts, applied everywhere it is shown. */
export function useVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { postId: string; option: number }) => api<{ post: Post }>(`/api/posts/${v.postId}/vote`, { body: { option: v.option } }).then((r) => r.post),
    onSuccess: (post) => {
      patchPost(qc, post.id, () => post);
      void qc.invalidateQueries({ queryKey: ["spaces", "posts"] });
    },
  });
}
