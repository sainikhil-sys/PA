import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type {
  ActivityEntry,
  AppNotification,
  Approval,
  Conversation,
  ConversationDetail,
  DocumentItem,
  Integration,
  Me,
  Memory,
  PhoneDevice,
  TaskDetail,
  TaskSummary,
  Today,
} from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't hammer the server when offline or signed out; 4xx errors won't fix themselves.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/** Every query key in one place, so mutations invalidate the right screens. */
export const keys = {
  me: ["me"] as const,
  today: ["today"] as const,
  approvals: ["approvals"] as const,
  conversations: (q = "") => ["conversations", q] as const,
  conversation: (id: string) => ["conversation", id] as const,
  suggestions: ["suggestions"] as const,
  tasks: ["tasks"] as const,
  task: (id: string) => ["task", id] as const,
  memories: ["memories"] as const,
  documents: ["documents"] as const,
  notifications: ["notifications"] as const,
  activity: ["activity"] as const,
  integrations: ["integrations"] as const,
  phones: ["phones"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<Me>("/api/mobile/me") });
export const useToday = () => useQuery({ queryKey: keys.today, queryFn: () => api<Today>("/api/mobile/today") });
export const useApprovals = () => useQuery({ queryKey: keys.approvals, queryFn: () => api<{ items: Approval[] }>("/api/mobile/approvals").then((r) => r.items) });
export const useConversations = (q: string) =>
  useQuery({
    queryKey: keys.conversations(q),
    queryFn: () => api<{ items: Conversation[] }>(`/api/chat/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.items),
  });
export const useConversation = (id: string | undefined) =>
  useQuery({ queryKey: keys.conversation(id ?? ""), enabled: Boolean(id), queryFn: () => api<ConversationDetail>(`/api/chat/conversations?id=${id}`) });
export const useSuggestions = () =>
  useQuery({ queryKey: keys.suggestions, staleTime: 5 * 60_000, queryFn: () => api<{ items: string[] }>("/api/chat/suggestions").then((r) => r.items) });
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: () => api<{ items: TaskSummary[] }>("/api/mobile/tasks").then((r) => r.items) });
export const useTask = (id: string) => useQuery({ queryKey: keys.task(id), queryFn: () => api<TaskDetail>(`/api/mobile/tasks/${id}`) });
export const useMemories = () => useQuery({ queryKey: keys.memories, queryFn: () => api<{ items: Memory[] }>("/api/mobile/memories").then((r) => r.items) });
export const useDocuments = () => useQuery({ queryKey: keys.documents, queryFn: () => api<{ items: DocumentItem[] }>("/api/knowledge/items").then((r) => r.items) });
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api<{ items: AppNotification[]; unread: number }>("/api/notifications") });
export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api<{ items: ActivityEntry[] }>("/api/activity").then((r) => r.items) });
export const useIntegrations = () => useQuery({ queryKey: keys.integrations, queryFn: () => api<{ items: Integration[] }>("/api/mobile/integrations").then((r) => r.items) });
export const usePhones = () => useQuery({ queryKey: keys.phones, queryFn: () => api<{ items: PhoneDevice[] }>("/api/mobile/phone").then((r) => r.items) });

/** Approve or dismiss a proposal: the only way anything the agent prepared ever runs. */
export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "approve" | "dismiss" }) => api<{ ok: true; message: string }>(`/api/mobile/approvals/${v.id}`, { body: { action: v.action } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.approvals });
      void qc.invalidateQueries({ queryKey: keys.today });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}
