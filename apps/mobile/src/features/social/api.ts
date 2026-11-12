import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import * as React from "react";
import { AppState } from "react-native";
import { api } from "@/lib/api";
import { OFFLINE_MAX_AGE } from "@/lib/persist";
import type { FoundPerson, Friends, MessageHit, ProfileResponse, ReactionKind, Relationship, ReportReason, SocialProfile, ThreadPage, ThreadSummary } from "./types";

export const socialKeys = {
  profile: ["social", "profile"] as const,
  threads: ["social", "threads"] as const,
  thread: (id: string) => ["social", "thread", id] as const,
  friends: ["social", "friends"] as const,
  blocked: ["social", "blocked"] as const,
  people: (q: string) => ["social", "people", q] as const,
  search: (q: string) => ["social", "search", q] as const,
};

/** True while the app is in the foreground. Polling stops in the background to save battery. */
export function useAppActive() {
  const [active, setActive] = React.useState(AppState.currentState === "active");
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

/** Poll every `ms` only while this screen is focused and the app is open. */
export function usePollInterval(ms: number): number | false {
  const [focused, setFocused] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const active = useAppActive();
  return focused && active ? ms : false;
}

export const useSocialProfile = () => useQuery({ queryKey: socialKeys.profile, gcTime: OFFLINE_MAX_AGE, queryFn: () => api<ProfileResponse>("/api/social/profile"), staleTime: 5 * 60_000 });

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SocialProfile>) => api<{ profile: SocialProfile }>("/api/social/profile", { method: "PUT", body: input }),
    onSuccess: (r) => {
      qc.setQueryData<ProfileResponse>(socialKeys.profile, { profile: r.profile });
      void qc.invalidateQueries({ queryKey: socialKeys.threads });
    },
  });
}

export function useThreads(enabled = true) {
  const interval = usePollInterval(8_000);
  return useQuery({
    queryKey: socialKeys.threads,
    gcTime: OFFLINE_MAX_AGE,
    enabled,
    refetchInterval: interval,
    queryFn: () => api<{ items: ThreadSummary[] }>("/api/social/threads").then((r) => r.items),
  });
}

export function useFriends(enabled = true) {
  const interval = usePollInterval(30_000);
  return useQuery({ queryKey: socialKeys.friends, gcTime: OFFLINE_MAX_AGE, enabled, refetchInterval: interval, queryFn: () => api<Friends>("/api/social/friends") });
}

export const useBlocked = () => useQuery({ queryKey: socialKeys.blocked, gcTime: OFFLINE_MAX_AGE, queryFn: () => api<{ items: { id: string; handle: string; name: string }[] }>("/api/social/blocks").then((r) => r.items) });

export const usePeopleSearch = (q: string) =>
  useQuery({
    queryKey: socialKeys.people(q),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: () => api<{ items: FoundPerson[] }>(`/api/social/people?q=${encodeURIComponent(q)}`).then((r) => r.items),
  });

export const useMessageSearch = (q: string) =>
  useQuery({
    queryKey: socialKeys.search(q),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: () => api<{ items: MessageHit[] }>(`/api/social/search?q=${encodeURIComponent(q)}`).then((r) => r.items),
  });

export type FriendAction = "request" | "accept" | "decline" | "cancel" | "remove";

export function useFriendAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; action: FriendAction }) => api<{ relationship: Relationship }>("/api/social/friends", { body: v }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.friends });
      void qc.invalidateQueries({ queryKey: ["social", "people"] });
    },
  });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; blocked: boolean }) => api("/api/social/blocks", { body: v }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["social"] }),
  });
}

export function useOpenDirect() {
  return useMutation({ mutationFn: (userId: string) => api<{ id: string }>("/api/social/threads", { body: { kind: "direct", userId } }).then((r) => r.id) });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { title: string; memberIds: string[] }) => api<{ id: string }>("/api/social/threads", { body: { kind: "group", ...v } }).then((r) => r.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: socialKeys.threads }),
  });
}

/**
 * A chat's messages: the newest page refreshes every few seconds while the chat is on screen
 * (so new messages, edits, reactions and read marks show up), older pages load when scrolling up.
 */
export function useThread(id: string) {
  const interval = usePollInterval(3_000);
  return useInfiniteQuery({
    queryKey: socialKeys.thread(id),
    gcTime: OFFLINE_MAX_AGE,
    initialPageParam: undefined as number | undefined,
    refetchInterval: interval,
    queryFn: ({ pageParam }) => api<ThreadPage>(`/api/social/threads/${id}${pageParam ? `?before=${pageParam}` : ""}`),
    getNextPageParam: (last) => (last.hasMore && last.messages.length ? last.messages[0]!.seq : undefined),
  });
}

export function useUpdateThread(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: { title?: string; add?: string[]; remove?: string; leave?: boolean; mute?: boolean }) => api(`/api/social/threads/${id}`, { method: "PATCH", body: change }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.thread(id) });
      void qc.invalidateQueries({ queryKey: socialKeys.threads });
    },
  });
}

export function useMessageActions(threadId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: socialKeys.thread(threadId) });
  return {
    edit: useMutation({ mutationFn: (v: { id: string; body: string }) => api(`/api/social/messages/${v.id}`, { method: "PATCH", body: { body: v.body } }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/api/social/messages/${id}`, { method: "DELETE" }), onSettled: refresh }),
    react: useMutation({ mutationFn: (v: { id: string; kind: ReactionKind }) => api(`/api/social/messages/${v.id}/reactions`, { body: { kind: v.kind } }), onSettled: refresh }),
  };
}

export function useReport() {
  return useMutation({
    mutationFn: (v: { userId?: string; messageId?: string; threadId?: string; reason: ReportReason; details?: string }) => api("/api/social/reports", { body: v }),
  });
}

/** Read marks and the typing signal share one request. Failures are ignored: the next one catches up. */
export function postReadState(threadId: string, v: { seq?: number; typing?: boolean }) {
  void api(`/api/social/threads/${threadId}/read`, { body: v }).catch(() => {});
}
