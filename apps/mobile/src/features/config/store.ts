import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { api, ApiError, configureGate } from "@/lib/api";
import { useSession } from "@/lib/session";
import { parseCached, parseConfig, type CachedConfig, type ClientConfig, type ConfigSource, type MaintenanceBlock, type UpdateBlock } from "./logic";

/**
 * The client configuration in memory, the copy kept on this phone, and the full-screen states a
 * 426 or 503 put the app in. Components read it through hooks; the rules live in ./logic.ts.
 */
const CACHE_KEY = "cowork.config";

type State = {
  config: ClientConfig | null;
  source: ConfigSource | null;
  fetchedAt: number | null;
  loaded: boolean;
  refreshing: boolean;
  dismissedUpdateVersion: string | null;
  /** Hidden at once on tap; the server is told in the background. */
  dismissedAnnouncementIds: string[];
  /** Set by a 426 from any request, for this run. */
  updateRequired: UpdateBlock | null;
  /** Set by a maintenance 503 from any request; cleared by a retry. */
  maintenance: MaintenanceBlock | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  retryMaintenance: () => Promise<void>;
  dismissUpdate: () => void;
  dismissAnnouncement: (id: string) => void;
};

function persist(s: Pick<State, "config" | "fetchedAt" | "dismissedUpdateVersion">) {
  if (!s.config || s.fetchedAt === null) return;
  const out: CachedConfig = { config: s.config, fetchedAt: s.fetchedAt, dismissedUpdateVersion: s.dismissedUpdateVersion };
  void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(out)).catch(() => {});
}

let inflight: Promise<void> | null = null;

export const useClientConfigStore = create<State>((set, get) => ({
  config: null,
  source: null,
  fetchedAt: null,
  loaded: false,
  refreshing: false,
  dismissedUpdateVersion: null,
  dismissedAnnouncementIds: [],
  updateRequired: null,
  maintenance: null,

  load: async () => {
    if (get().loaded) return;
    const cached = parseCached(await AsyncStorage.getItem(CACHE_KEY).catch(() => null));
    // A fetch that finished first is newer than the cache; keep it.
    if (cached && get().source !== "network") set({ config: cached.config, fetchedAt: cached.fetchedAt, source: "cache", dismissedUpdateVersion: cached.dismissedUpdateVersion });
    set({ loaded: true });
  },

  refresh: () => {
    inflight ??= (async () => {
      set({ refreshing: true });
      try {
        const config = parseConfig(await api<unknown>("/api/config"));
        if (!config) return;
        const fetchedAt = Date.now();
        // Fresh word from the server: a 426 or 503 it no longer reports is over.
        set((s) => ({
          config,
          fetchedAt,
          source: "network",
          updateRequired: config.update.status === "required" ? s.updateRequired : null,
          maintenance: config.maintenance.active ? s.maintenance : null,
        }));
        persist(get());
      } catch (err) {
        // Offline or the server is unreachable: keep the copy we have and carry on.
        if (!(err instanceof ApiError)) throw err;
      } finally {
        set({ refreshing: false });
        inflight = null;
      }
    })();
    return inflight;
  },

  retryMaintenance: async () => {
    set({ maintenance: null });
    await get().refresh();
  },

  dismissUpdate: () => {
    set({ dismissedUpdateVersion: get().config?.update.latestVersion ?? "" });
    persist(get());
  },

  dismissAnnouncement: (id) => {
    set((s) => ({ dismissedAnnouncementIds: [...s.dismissedAnnouncementIds, id] }));
    // Signed in: hide it on every device. If that fails, it stays hidden here for this run.
    if (useSession.getState().status === "signedIn") void api(`/api/config/announcements/${encodeURIComponent(id)}/dismiss`, { method: "POST" }).catch(() => {});
  },
}));

configureGate({
  updateRequired: (b) => useClientConfigStore.setState({ updateRequired: { message: b.message, storeUrl: b.storeUrl ?? null } }),
  maintenance: (b) => useClientConfigStore.setState({ maintenance: { message: b.message, endsAt: b.endsAt ?? null } }),
});
