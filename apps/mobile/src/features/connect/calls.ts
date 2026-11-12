import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { AppState, Vibration } from "react-native";
import { create } from "zustand";
import { KeyRing } from "./audio-keys";
import { audioErrorText, ConnectAudio, requestMicrophone, requestNotificationsQuietly } from "./audio-native";
import { audioOwner, dropPeer, endpointForPeer, onAudioStateChange, setMuted, setPeerKey, setSpeaker, startAudio, stopAudio, transmit } from "./audio-session";
import { toHex } from "./bytes";
import * as C from "./calls-logic";
import * as history from "./calls-store";
import { onConnectCleanup, onConnectMessage, securePeers, sendToPeer, useConnect } from "./connect-store";
import { loadIdentity } from "./identity";
import type { FeatureMessage } from "./session";
import { useWalkie } from "./walkie";

/**
 * Offline voice calls over Connect, 1:1 and up to four people. Both phones need Connect open and
 * connected to each other; no internet is used. See calls-logic.ts for the protocol.
 */
type CallsState = {
  me: string | null;
  call: C.Call | null;
  muted: boolean;
  speaker: boolean;
  busy: boolean;
  error: string | null;
  history: history.CallRow[];

  start: () => Promise<void>;
  /** Starts a call to these people (1 to 3). Returns the call id, or null with `error` set. */
  startCall: (peerKeys: string[]) => Promise<string | null>;
  answer: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
  /** Forgets an ended call (the call screen calls this when it closes). */
  dismiss: (callId: string) => void;
  clearError: () => void;
};

let started: Promise<void> | null = null;
let ring: KeyRing | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let micOn = false;
let lastSecure = new Set<string>();
const RING_PATTERN = [0, 700, 1300];

const isHex64 = (s: string) => /^[0-9a-f]{64}$/.test(s);

function micErrorText(blocked: boolean) {
  return blocked ? "Microphone permission is off. Turn it on for Cowork in Android settings to make calls." : "Calls need the microphone permission.";
}

function stopRinging() {
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = null;
  Vibration.cancel();
}

export const useCalls = create<CallsState>((set, get) => {
  /** Applies an event to the current call, and cleans up once when it ends. */
  const apply = (e: C.CallEvent) => {
    const before = get().call;
    if (!C.isLive(before)) return;
    const next = C.reduceCall(before, e, Date.now());
    set({ call: next });
    if (next.phase === "ended") return void finish(next);
    if (next.answered && !micOn && (next.phase === "connecting" || next.phase === "active")) {
      micOn = true;
      void transmit("call", true)
        .then(() => (get().muted ? setMuted("call", true) : undefined))
        .catch(() => set({ error: "Could not turn on the microphone." }));
    }
  };

  const finish = async (call: C.Call) => {
    stopRinging();
    micOn = false;
    ring?.clear();
    ring = null;
    await ConnectAudio.clearIncomingCall(call.id).catch(() => {});
    await stopAudio("call");
    await ConnectAudio.stopService().catch(() => {});
    set({ muted: false, speaker: false });
    await history
      .addCall({
        id: call.id,
        direction: call.direction,
        people: call.participants.map((p) => ({ key: p.key, name: p.name })),
        status: C.historyStatus(call),
        startedAt: call.startedAt,
        connectedAt: call.connectedAt,
        endedAt: call.endedAt ?? Date.now(),
      })
      .catch(() => {});
    await get().loadHistory();
  };

  /** Sends to everyone still in the call or ringing. */
  const tellAll = (m: FeatureMessage) => {
    const c = get().call;
    if (!c) return;
    for (const p of C.liveParticipants(c)) sendToPeer(p.key, m);
  };

  const sendMyKey = (peer: string) => {
    const c = get().call;
    if (!c || !ring || !ring.mine) return;
    if (sendToPeer(peer, { t: "call.key", callId: c.id, key: ring.mine })) ring.markSent(peer);
  };

  /** Gives native the key of a person who is in the call. */
  const applyKey = async (peer: string) => {
    const c = get().call;
    const key = ring?.received(peer);
    if (!c || !c.answered || !key || audioOwner() !== "call") return;
    const p = c.participants.find((x) => x.key === peer);
    if (!p || p.state !== "joined") return;
    if (await setPeerKey("call", peer, key)) apply({ type: "key", peer });
  };

  const sameCall = (m: FeatureMessage) => {
    const id = C.parseCallId(m);
    const c = get().call;
    return id && C.isLive(c) && c.id === id ? c : null;
  };

  const isParticipant = (c: C.Call, peer: string) => c.participants.some((p) => p.key === peer);

  // ---------- Incoming messages ----------

  const onInvite = (from: string, m: FeatureMessage) => {
    const me = get().me;
    if (!me) return;
    const inv = C.parseInvite(from, me, m);
    if (!inv) return;
    const current = get().call;
    if (C.isLive(current)) {
      if (current.id !== inv.callId) sendToPeer(from, { t: "call.decline", callId: inv.callId, busy: true });
      return;
    }
    const call = C.incomingCall(inv, from, me, Date.now());
    ring = new KeyRing("");
    ring.setReceived(from, inv.key);
    micOn = false;
    set({ call, muted: false, speaker: false, error: null });
    ringTimer = setTimeout(() => apply({ type: "ring_timeout" }), C.RING_TIMEOUT_MS);
    const caller = call.participants.find((p) => p.key === from)?.name ?? "Someone";
    const showInApp = () => {
      Vibration.vibrate(RING_PATTERN, true);
      router.navigate(`/connect/call/${call.id}`);
    };
    if (AppState.currentState === "active") showInApp();
    else
      void ConnectAudio.showIncomingCall({ callId: call.id, name: caller })
        .then((shown) => {
          if (!shown && get().call?.id === call.id && get().call?.phase === "incoming") showInApp();
        })
        .catch(showInApp);
  };

  const onAccept = async (from: string, m: FeatureMessage) => {
    const c = sameCall(m);
    if (!c || !isParticipant(c, from)) return;
    apply({ type: "accepted", peer: from });
    if (!get().call?.answered) return;
    if (ring?.needsSend(from)) sendMyKey(from);
    await applyKey(from);
  };

  const onKey = async (from: string, m: FeatureMessage) => {
    const c = sameCall(m);
    const parsed = C.parseCallKey(m);
    if (!c || !parsed || !ring || !isParticipant(c, from)) return;
    ring.setReceived(from, parsed.key);
    if (!c.answered) return;
    await applyKey(from);
    if (ring?.needsSend(from)) sendMyKey(from);
  };

  const onDecline = (from: string, m: FeatureMessage) => {
    const c = sameCall(m);
    if (!c || !isParticipant(c, from)) return;
    apply({ type: "declined", peer: from, busy: m.busy === true });
  };

  const onEnd = async (from: string, m: FeatureMessage) => {
    const c = sameCall(m);
    if (!c || !isParticipant(c, from)) return;
    ring?.remove(from);
    await dropPeer("call", from);
    apply({ type: "left", peer: from });
  };

  const onLinks = async () => {
    const now = new Set(securePeers().map((p) => p.peerKey));
    const lost = [...lastSecure].filter((k) => !now.has(k));
    lastSecure = now;
    const c = get().call;
    if (!C.isLive(c)) return;
    for (const peer of lost) {
      if (!isParticipant(c, peer)) continue;
      ring?.remove(peer);
      await dropPeer("call", peer);
      apply({ type: "lost", peer });
    }
  };

  return {
    me: null,
    call: null,
    muted: false,
    speaker: false,
    busy: false,
    error: null,
    history: [],

    start: () => {
      started ??= (async () => {
        set({ me: toHex((await loadIdentity()).publicKey) });
        lastSecure = new Set(securePeers().map((p) => p.peerKey));
        const wrap = (fn: (from: string, m: FeatureMessage) => unknown) => (from: string, m: FeatureMessage) => {
          if (!isHex64(from)) return;
          void Promise.resolve(fn(from, m)).catch(() => {});
        };
        onConnectMessage("call.invite", wrap(onInvite));
        onConnectMessage("call.accept", wrap(onAccept));
        onConnectMessage("call.key", wrap(onKey));
        onConnectMessage("call.decline", wrap(onDecline));
        onConnectMessage("call.end", wrap(onEnd));
        onConnectCleanup({
          // Storage is cleared by connect-store; reload so the list matches it.
          forgetPeer: () => get().loadHistory(),
          reset: () => set({ history: [] }),
        });
        useConnect.subscribe((st, prev) => {
          if (st.links !== prev.links) void onLinks().catch(() => {});
        });
        onAudioStateChange((e) => {
          const c = get().call;
          if (audioOwner() !== "call" || e.state !== "error" || !c) return;
          tellAll({ t: "call.end", callId: c.id });
          apply({ type: "failed" });
        });
        ConnectAudio.addListener("onCallAction", (e) => {
          const c = get().call;
          if (!e || !c || e.callId !== c.id || c.phase !== "incoming") return;
          if (e.action === "accept") {
            router.navigate(`/connect/call/${c.id}`);
            void get().answer();
          } else if (e.action === "decline") {
            get().decline();
          }
        });
        // Opening the app from the incoming call notification shows the call.
        AppState.addEventListener("change", (state) => {
          const c = get().call;
          if (state === "active" && c?.phase === "incoming") router.navigate(`/connect/call/${c.id}`);
        });
        await get().loadHistory();
      })();
      return started;
    },

    startCall: async (peerKeys) => {
      await get().start();
      const me = get().me!;
      const keys = [...new Set(peerKeys)].filter((k) => isHex64(k) && k !== me);
      const fail = (error: string) => {
        set({ error, busy: false });
        return null;
      };
      if (C.isLive(get().call)) return fail("You are already in a call.");
      if (!keys.length) return fail("Choose someone to call.");
      if (keys.length > C.MAX_CALL_PEOPLE - 1) return fail(`A call holds up to ${C.MAX_CALL_PEOPLE} people, including you.`);
      if (useWalkie.getState().joined || audioOwner() === "walkie") return fail("Leave the Walkie channel to start a call.");
      if (!ConnectAudio.isAvailable()) return fail(audioErrorText(new Error("AUDIO_UNAVAILABLE")));
      const live = securePeers();
      const people: C.Person[] = [];
      for (const k of keys) {
        const p = live.find((x) => x.peerKey === k);
        if (!p) return fail("That person is not connected right now. Both phones need Connect open and connected.");
        if (!endpointForPeer(k)) return fail(`${p.name} is connected in a way that carries text only. Calls need a direct Android connection.`);
        people.push({ key: k, name: p.name });
      }
      set({ busy: true, error: null });
      const mic = await requestMicrophone();
      if (!mic.ok) return fail(micErrorText(mic.blocked));
      await requestNotificationsQuietly();
      let key: string;
      try {
        key = await startAudio("call", "call");
      } catch (err) {
        return fail(err instanceof Error && err.message === "AUDIO_BUSY" ? "Leave the Walkie channel to start a call." : audioErrorText(err));
      }
      const id = C.newCallId((n) => Crypto.getRandomBytes(n));
      ring = new KeyRing(key);
      micOn = false;
      set({ call: C.outgoingCall(id, me, people, Date.now()), muted: false, speaker: false, busy: false });
      const members = [{ key: me, name: useConnect.getState().myName }, ...people];
      for (const p of people) {
        if (sendToPeer(p.key, { t: "call.invite", callId: id, key, members })) ring.markSent(p.key);
        else apply({ type: "lost", peer: p.key });
      }
      if (!C.isLive(get().call)) return id;
      await setSpeaker("call", false).catch(() => {});
      await ConnectAudio.startService({ kind: "call", title: `Call with ${C.callTitle(people)}`, body: "Connect call over a direct connection. No internet used." }).catch(() => {});
      ringTimer = setTimeout(() => {
        const c = get().call;
        if (!C.isLive(c) || c.id !== id) return;
        for (const p of c.participants) if (p.state === "invited") sendToPeer(p.key, { t: "call.end", callId: id });
        apply({ type: "ring_timeout" });
      }, C.RING_TIMEOUT_MS);
      return id;
    },

    answer: async () => {
      const c = get().call;
      if (!c || c.phase !== "incoming" || get().busy) return;
      set({ busy: true, error: null });
      try {
        stopRinging();
        await ConnectAudio.clearIncomingCall(c.id).catch(() => {});
        if (!ConnectAudio.isAvailable()) {
          set({ error: audioErrorText(new Error("AUDIO_UNAVAILABLE")) });
          return get().decline();
        }
        const mic = await requestMicrophone();
        if (!mic.ok) {
          set({ error: micErrorText(mic.blocked) });
          return get().decline();
        }
        if (useWalkie.getState().joined || useWalkie.getState().joining) await useWalkie.getState().leave();
        let key: string;
        try {
          key = await startAudio("call", "call");
        } catch (err) {
          set({ error: audioErrorText(err) });
          return get().decline();
        }
        // The caller may have hung up while the permission prompt was open.
        if (!C.isLive(get().call) || get().call!.id !== c.id) return void stopAudio("call");
        ring ??= new KeyRing("");
        ring.rotate(key);
        apply({ type: "answer" });
        await setSpeaker("call", false).catch(() => {});
        const caller = c.participants.find((p) => p.key === c.host);
        await ConnectAudio.startService({ kind: "call", title: `Call with ${caller?.name ?? "Connect"}`, body: "Connect call over a direct connection. No internet used." }).catch(() => {});
        const now = get().call;
        if (!C.isLive(now)) return;
        for (const p of C.liveParticipants(now)) {
          sendToPeer(p.key, { t: "call.accept", callId: now.id });
          sendMyKey(p.key);
        }
        for (const p of now.participants) await applyKey(p.key);
      } finally {
        set({ busy: false });
      }
    },

    decline: () => {
      const c = get().call;
      if (!C.isLive(c) || c.answered) return;
      stopRinging();
      tellAll({ t: "call.decline", callId: c.id });
      apply({ type: "decline" });
    },

    hangup: () => {
      const c = get().call;
      if (!C.isLive(c)) return;
      if (!c.answered) return get().decline();
      tellAll({ t: "call.end", callId: c.id });
      apply({ type: "hangup" });
    },

    toggleMute: () => {
      const muted = !get().muted;
      set({ muted });
      setMuted("call", muted).catch(() => set({ muted: !muted }));
    },

    toggleSpeaker: () => {
      const speaker = !get().speaker;
      set({ speaker });
      setSpeaker("call", speaker).catch(() => set({ speaker: !speaker }));
    },

    loadHistory: async () => {
      try {
        set({ history: await history.listCalls() });
      } catch {
        // History is a convenience; the calls themselves do not depend on it.
      }
    },

    clearHistory: async () => {
      await history.clearCalls();
      set({ history: [] });
    },

    dismiss: (callId) => {
      const c = get().call;
      if (c && c.id === callId && c.phase === "ended") set({ call: null });
    },

    clearError: () => set({ error: null }),
  };
});
