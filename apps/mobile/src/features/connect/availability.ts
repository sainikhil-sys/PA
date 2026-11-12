import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Connect's online parts (circles, cards, communities, events) need server routes that may not be
 * deployed yet. Only a 200 from GET /api/connect/circles counts as available; anything else (404
 * before the server part ships, 401, 503 maintenance, 426 update needed, offline) hides the entry,
 * so nobody lands on screens that can't load. Checked once per app launch.
 * The offline features (nearby chat, files, Walkie, calls) don't depend on this.
 */
export function useConnectSocialAvailable(): boolean {
  const q = useQuery({
    queryKey: ["connect", "social-available"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: () =>
      api<unknown>("/api/connect/circles").then(
        () => true,
        () => false,
      ),
  });
  return q.data === true;
}
