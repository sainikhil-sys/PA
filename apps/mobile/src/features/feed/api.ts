import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReactionKind, ReportReason } from "@/features/social/types";
import type { Comment, CommentPage, FeedPage, FeedTab, FollowRequest, FollowState, Post, PersonPage, Visibility } from "./types";

export const feedKeys = {
  all: ["feed"] as const,
  feed: (tab: FeedTab) => ["feed", "list", tab] as const,
  post: (id: string) => ["feed", "post", id] as const,
  comments: (id: string) => ["feed", "comments", id] as const,
  person: (handle: string) => ["feed", "person", handle.toLowerCase()] as const,
  requests: ["feed", "follow-requests"] as const,
};

/** Media links are signed for an hour: refetch feeds after 30 minutes rather than show dead images. */
const MEDIA_SAFE = 30 * 60_000;

export function useFeed(tab: FeedTab) {
  return useInfiniteQuery({
    queryKey: feedKeys.feed(tab),
    initialPageParam: null as string | null,
    staleTime: 60_000,
    gcTime: MEDIA_SAFE,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `cursor=${encodeURIComponent(pageParam)}` : "";
      return tab === "saved" ? api<FeedPage>(`/api/feed/saved${cursor ? `?${cursor}` : ""}`) : api<FeedPage>(`/api/feed?tab=${tab}${cursor ? `&${cursor}` : ""}`);
    },
    getNextPageParam: (last) => last.next,
  });
}

export const usePost = (id: string) => useQuery({ queryKey: feedKeys.post(id), gcTime: MEDIA_SAFE, queryFn: () => api<{ post: Post }>(`/api/posts/${id}`).then((r) => r.post) });

export function useComments(postId: string) {
  return useInfiniteQuery({
    queryKey: feedKeys.comments(postId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<CommentPage>(`/api/posts/${postId}/comments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next,
  });
}

export function usePerson(handle: string) {
  return useInfiniteQuery({
    queryKey: feedKeys.person(handle),
    initialPageParam: null as string | null,
    gcTime: MEDIA_SAFE,
    queryFn: ({ pageParam }) => api<PersonPage>(`/api/people/${encodeURIComponent(handle)}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.posts.next,
  });
}

export const useFollowRequests = (enabled = true) =>
  useQuery({ queryKey: feedKeys.requests, enabled, queryFn: () => api<{ requests: FollowRequest[] }>("/api/follows").then((r) => r.requests) });

/** Applies a change to one post everywhere it is cached (every feed tab, profiles, the detail view). */
export function patchPost(qc: QueryClient, id: string, fn: (p: Post) => Post | null) {
  const each = (items: Post[]) => items.flatMap((p) => (p.id === id ? (fn(p) ?? []) : [p]));
  qc.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed", "list"] }, (d) => (d ? { ...d, pages: d.pages.map((pg) => ({ ...pg, items: each(pg.items) })) } : d));
  qc.setQueriesData<InfiniteData<PersonPage>>({ queryKey: ["feed", "person"] }, (d) => (d ? { ...d, pages: d.pages.map((pg) => ({ ...pg, posts: { ...pg.posts, items: each(pg.posts.items) } })) } : d));
  qc.setQueryData<Post>(feedKeys.post(id), (p) => (p ? (fn(p) ?? undefined) : p));
}

export function usePostActions() {
  const qc = useQueryClient();
  const react = useMutation({
    mutationFn: (v: { id: string; kind: ReactionKind }) => api<{ added: boolean }>(`/api/posts/${v.id}/reactions`, { body: { kind: v.kind } }),
    // Optimistic: the count and the highlight change on tap; a failure puts them back.
    onMutate: (v) => {
      let before: Post | undefined;
      patchPost(qc, v.id, (p) => {
        before = p;
        const had = p.myReactions.includes(v.kind);
        return { ...p, myReactions: had ? p.myReactions.filter((k) => k !== v.kind) : [...p.myReactions, v.kind], reactionCount: Math.max(0, p.reactionCount + (had ? -1 : 1)) };
      });
      return { before };
    },
    onError: (_e, v, ctx) => {
      if (ctx?.before) patchPost(qc, v.id, () => ctx.before!);
    },
  });
  const save = useMutation({
    mutationFn: (id: string) => api<{ saved: boolean }>(`/api/posts/${id}/save`, { body: {} }),
    onSuccess: (r, id) => {
      patchPost(qc, id, (p) => ({ ...p, saved: r.saved }));
      void qc.invalidateQueries({ queryKey: feedKeys.feed("saved") });
    },
  });
  const hide = useMutation({
    mutationFn: (id: string) => api(`/api/posts/${id}/hide`, { body: {} }),
    onSuccess: (_r, id) => patchPost(qc, id, () => null),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/posts/${id}`, { method: "DELETE" }),
    onSuccess: (_r, id) => patchPost(qc, id, () => null),
  });
  const edit = useMutation({
    mutationFn: (v: { id: string; body: string }) => api<{ post?: Post }>(`/api/posts/${v.id}`, { method: "PATCH", body: { body: v.body } }),
    onSuccess: (r, v) => patchPost(qc, v.id, (p) => r.post ?? { ...p, body: v.body, editedAt: new Date().toISOString() }),
  });
  return { react, save, hide, remove, edit };
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string; visibility: Visibility; mediaIds: string[] }) => api<{ post: Post }>("/api/posts", { body: v }).then((r) => r.post),
    onSuccess: () => void qc.invalidateQueries({ queryKey: feedKeys.all }),
  });
}

export function useCommentActions(postId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: feedKeys.comments(postId) });
    void qc.invalidateQueries({ queryKey: feedKeys.post(postId) });
  };
  return {
    add: useMutation({
      mutationFn: (v: { body: string; parentId?: string | null }) => api<{ comment: Pick<Comment, "id" | "status"> }>(`/api/posts/${postId}/comments`, { body: v }).then((r) => r.comment),
      onSuccess: () => {
        patchPost(qc, postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
        refresh();
      },
    }),
    remove: useMutation({
      mutationFn: (commentId: string) => api(`/api/comments/${commentId}`, { method: "DELETE" }),
      onSuccess: () => {
        patchPost(qc, postId, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }));
        refresh();
      },
    }),
  };
}

export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; action: "follow" | "unfollow" | "accept" | "decline" }) => api<{ state: FollowState }>("/api/follows", { body: v }).then((r) => r.state),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["feed", "person"] });
      void qc.invalidateQueries({ queryKey: feedKeys.requests });
      void qc.invalidateQueries({ queryKey: feedKeys.feed("following") });
    },
  });
}

export function useFeedReport() {
  return useMutation({ mutationFn: (v: { postId?: string; commentId?: string; reason: ReportReason; details?: string }) => api("/api/feed/reports", { body: v }) });
}
