import * as React from "react";
import { AppState } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "@/lib/session";
import { decideGate, FOREGROUND_MAX_AGE_MS, isStale, POLL_INTERVAL_MS, showOptionalUpdate, visibleAnnouncements, type Gate } from "./logic";
import { useClientConfigStore } from "./store";

/**
 * Keeps the client configuration current. Mounted once in the root layout: renders from the cached
 * copy at once, fetches at launch and when the session changes, again on return to the foreground
 * when the copy is older than 5 minutes, and every 15 minutes while the app is open.
 */
export function useClientConfigSync() {
  const status = useSession((s) => s.status);

  React.useEffect(() => {
    void useClientConfigStore.getState().load();
  }, []);

  React.useEffect(() => {
    // The first fetch waits for the session restore, so it already carries the session. After that,
    // signing in adds flags and targeted announcements, and signing out drops them.
    if (status === "restoring") return;
    useClientConfigStore.setState({ dismissedAnnouncementIds: [] });
    void useClientConfigStore.getState().refresh();
  }, [status]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => void useClientConfigStore.getState().refresh(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return stop();
      start();
      const { fetchedAt, refresh } = useClientConfigStore.getState();
      if (isStale(fetchedAt, Date.now(), FOREGROUND_MAX_AGE_MS)) void refresh();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, []);
}

/** The full-screen state to show now, if any. */
export function useGate(): Gate {
  const s = useClientConfigStore(useShallow((x) => ({ config: x.config, source: x.source, updateRequired: x.updateRequired, maintenance: x.maintenance })));
  return decideGate(s);
}

/** What Home shows from the configuration: the optional-update card and announcements. */
export function useHomeNotices() {
  const s = useClientConfigStore(useShallow((x) => ({ config: x.config, dismissedUpdateVersion: x.dismissedUpdateVersion, dismissedAnnouncementIds: x.dismissedAnnouncementIds })));
  return {
    update: showOptionalUpdate(s.config, s.dismissedUpdateVersion) ? s.config!.update : null,
    announcements: visibleAnnouncements(s.config, s.dismissedAnnouncementIds),
  };
}
