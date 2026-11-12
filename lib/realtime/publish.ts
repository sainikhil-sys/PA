import "server-only";
import { errMessage, log } from "@/lib/log";
import { realtimeConfig, userTopic } from "./token";

/**
 * Event names the app listens for. Payloads are small hints ("thread X has news after seq N");
 * the app then fetches through the normal API, so permission checks stay in one place.
 */
export type RealtimeEvent =
  | { event: "dm.message"; payload: { threadId: string; seq: number } }
  | { event: "dm.updated"; payload: { threadId: string } }
  | { event: "dm.read"; payload: { threadId: string; userId: string; readSeq: number } }
  | { event: "dm.typing"; payload: { threadId: string; userId: string } }
  | { event: "friends.changed"; payload: Record<string, never> }
  | { event: "notification"; payload: { id: string } };

const BATCH = 100;

/**
 * Sends one event to each listed person's private channel. Call it after the write commits.
 * Never throws: if Realtime is down or not configured, the app's polling still picks it up.
 */
export async function publishTo(userIds: string[], e: RealtimeEvent): Promise<void> {
  const cfg = realtimeConfig();
  const ids = [...new Set(userIds)];
  if (!cfg || !ids.length) return;
  for (let i = 0; i < ids.length; i += BATCH) {
    const messages = ids.slice(i, i + BATCH).map((id) => ({ topic: userTopic(id), event: e.event, payload: e.payload, private: true }));
    try {
      const res = await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) log.warn("realtime.publish_failed", { status: res.status, event: e.event });
    } catch (err) {
      log.warn("realtime.publish_failed", { error: errMessage(err), event: e.event });
    }
  }
}
