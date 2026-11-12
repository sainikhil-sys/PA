import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

/**
 * Offline copy of Chats: the chat list, friends, your Chats profile and the recent messages of chats
 * you opened are kept on this phone, so Chats opens instantly and still shows them without a
 * connection. Searches are not kept. Everything here is cleared on sign-out (see app/_layout.tsx).
 * Stored in the app's private storage (backups are off in app.json); App lock covers the screen.
 */
export const cachePersister = createAsyncStoragePersister({ storage: AsyncStorage, key: "cowork.cache", throttleTime: 2_000 });

/** How long an offline copy stays usable, and how long the matching queries stay in memory. */
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60_000;

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: cachePersister,
  maxAge: OFFLINE_MAX_AGE,
  // Bump when the shape of a kept response changes, so an old copy is never read as the new one.
  buster: "chats-1",
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => {
      const [scope, kind] = q.queryKey as [unknown, unknown];
      return q.state.status === "success" && scope === "social" && kind !== "people" && kind !== "search";
    },
  },
};
