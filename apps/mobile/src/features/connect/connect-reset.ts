import { Directory, Paths } from "expo-file-system";
import { clearCalls } from "./calls-store";
import { deleteReceivedFiles, runCleanups, useConnect } from "./connect-store";
import * as fdb from "./files-db";
import * as gdb from "./groups-db";
import * as db from "./store";

/**
 * Stops every radio, disconnects everyone and deletes everything Connect keeps on this phone:
 * chats and people, file transfers and received files, groups and call history. The phone's
 * Connect identity (its key pair) and display name stay. Used on sign-out.
 */
export async function resetConnect(): Promise<void> {
  useConnect.getState().disconnectAll();
  await runCleanups("reset");
  deleteReceivedFiles(await fdb.clearAllTransfers().catch(() => []));
  await gdb.clearAll().catch(() => {});
  await clearCalls().catch(() => {});
  await db.clearAll().catch(() => {});
  // Received files (files/connect) and partial or encrypted copies (cache/connect), written by native.
  for (const dir of [new Directory(Paths.document, "connect"), new Directory(Paths.cache, "connect")]) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      // Already gone.
    }
  }
  useConnect.setState({ peers: [], messages: {}, error: null });
}
