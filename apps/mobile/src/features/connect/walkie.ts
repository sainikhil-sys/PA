import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { KeyRing } from "./audio-keys";
import { audioErrorText, ConnectAudio, requestMicrophone, requestNotificationsQuietly } from "./audio-native";
import { audioOwner, dropPeer, onAudioStateChange, setPeerKey, setSpeaker as nativeSpeaker, startAudio, stopAudio, transmit } from "./audio-session";
import { toHex } from "./bytes";
import { onConnectMessage, securePeers, sendToPeer, useConnect } from "./connect-store";
import { loadIdentity } from "./identity";
import type { FeatureMessage } from "./session";
import * as W from "./walkie-logic";

/**
 * Walkie: push-to-talk voice channels over Connect, offline. See walkie-logic.ts for the protocol.
 * Runs while this phone is in a channel, with a foreground service so it keeps working with the
 * screen off. Audio and keys are never logged.
 */
type WalkieState = {
  me: string | null;
  /** Channels announced by people connected right now, and mine. */
  channels: Record<string, W.Channel>;
  joined: string | null;
  joining: string | null;
  /** The code of the private channel I made (only the host has it). */
  code: string | null;
  talking: boolean;
  latched: boolean;
  speaker: boolean;
  quality: Record<string, W.Quality>;
  busy: boolean;
  error: string | null;
  notice: string | null;

  start: () => Promise<void>;
  create: (name: string, open: boolean) => Promise<void>;
  join: (id: string, code?: string) => Promise<void>;
  leave: () => Promise<void>;
  talk: (on: boolean) => void;
  setLatched: (on: boolean) => void;
  setSpeaker: (on: boolean) => void;
  clearMessages: () => void;
};

let started: Promise<void> | null = null;
let host: W.HostState | null = null;
let ring: KeyRing | null = null;
let audioReady = false;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let joinTimer: ReturnType<typeof setTimeout> | null = null;
let lastSecure = new Set<string>();
const pings = new W.PingTracker();
/** Keys from people the host has not listed yet, by peer. Cleared when leaving. */
const pendingKeys = new Map<string, { id: string; key: string }>();

const isHex64 = (s: string) => /^[0-9a-f]{64}$/.test(s);

function broadcast(m: FeatureMessage) {
  for (const p of securePeers()) sendToPeer(p.peerKey, m);
}

function micErrorText(blocked: boolean) {
  return blocked ? "Microphone permission is off. Turn it on for Cowork in Android settings to use Walkie." : "Walkie needs the microphone permission to send your voice.";
}

export const useWalkie = create<WalkieState>((set, get) => {
  const setChannel = (c: W.Channel) => set((s) => ({ channels: { ...s.channels, [c.id]: c } }));
  const deleteChannel = (id: string) =>
    set((s) => {
      if (!s.channels[id]) return s;
      const channels = { ...s.channels };
      delete channels[id];
      return { channels };
    });

  const clearJoinTimer = () => {
    if (joinTimer) clearTimeout(joinTimer);
    joinTimer = null;
  };

  const sendMyKey = (peer: string) => {
    const id = get().joined;
    if (!ring || !ring.mine || !id || peer === get().me) return;
    if (sendToPeer(peer, { t: "walkie.key", id, key: ring.mine })) ring.markSent(peer);
  };

  const applyKey = async (peer: string) => {
    const key = ring?.received(peer);
    if (!key || !audioReady) return;
    await setPeerKey("walkie", peer, key);
  };

  const refreshQuality = () => {
    const c = get().joined ? get().channels[get().joined!] : undefined;
    if (!c) return;
    const now = Date.now();
    const quality: Record<string, W.Quality> = {};
    for (const m of c.members) if (m.key !== get().me) quality[m.key] = pings.quality(m.key, now);
    set({ quality });
  };

  const startPings = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      const id = get().joined;
      const c = id ? get().channels[id] : undefined;
      if (!id || !c) return;
      const live = new Set(securePeers().map((p) => p.peerKey));
      for (const m of c.members) {
        if (m.key === get().me || !live.has(m.key)) continue;
        sendToPeer(m.key, { t: "walkie.ping", id, n: pings.ping(m.key, Date.now()) });
      }
      refreshQuality();
    }, W.PING_EVERY_MS);
  };

  /** Ends this phone's part in the channel: mic off, keys forgotten, service stopped. */
  const teardown = async (notice: string | null) => {
    clearJoinTimer();
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    pings.clear();
    pendingKeys.clear();
    ring?.clear();
    ring = null;
    audioReady = false;
    if (host) {
      deleteChannel(host.channel.id);
      host = null;
    }
    set({ joined: null, joining: null, code: null, talking: false, latched: false, quality: {}, notice });
    await stopAudio("walkie");
    await ConnectAudio.stopService().catch(() => {});
  };

  /** Starts audio and the foreground service for a channel this phone is now in. */
  const enter = async (c: W.Channel) => {
    clearJoinTimer();
    try {
      const key = await startAudio("walkie", "walkie");
      ring ??= new KeyRing("");
      ring.rotate(key);
      audioReady = true;
      set({ joined: c.id, joining: null, speaker: true, notice: null });
      await nativeSpeaker("walkie", true).catch(() => {});
      await ConnectAudio.startService({ kind: "walkie", title: `Walkie: ${c.name}`, body: "You are in a Walkie channel. Voice keeps working with the screen off." }).catch(() => {});
      for (const m of c.members) {
        if (m.key === get().me) continue;
        const early = pendingKeys.get(m.key);
        pendingKeys.delete(m.key);
        if (early && early.id === c.id) ring.setReceived(m.key, early.key);
        sendMyKey(m.key);
        await applyKey(m.key);
      }
      startPings();
    } catch (err) {
      const msg = err instanceof Error && err.message === "AUDIO_BUSY" ? "End the call before joining a channel." : audioErrorText(err);
      const wasHost = host?.channel.id === c.id;
      if (wasHost) broadcast({ t: "walkie.channel", id: c.id, closed: true });
      else sendToPeer(c.host, { t: "walkie.leave", id: c.id });
      await teardown(null);
      set({ error: msg });
    }
  };

  /** A new member list for the channel I am in. */
  const applyRoster = async (before: W.Channel, after: W.Channel) => {
    const me = get().me!;
    const { added, removed } = W.rosterDiff(before.members, after.members, me);
    for (const m of removed) {
      ring?.remove(m.key);
      pings.forget(m.key);
      await dropPeer("walkie", m.key);
    }
    for (const m of added) {
      const early = pendingKeys.get(m.key);
      pendingKeys.delete(m.key);
      if (early && early.id === after.id) ring?.setReceived(m.key, early.key);
      sendMyKey(m.key);
      await applyKey(m.key);
    }
    refreshQuality();
  };

  /** Sends the channel to everyone connected: members get the member list, others only the count. */
  const broadcastRoster = () => {
    if (!host) return;
    const c = host.channel;
    for (const p of securePeers()) sendToPeer(p.peerKey, W.channelMessage(c, c.members.some((m) => m.key === p.peerKey)));
  };

  // ---------- Incoming messages ----------

  const onChannel = async (from: string, m: FeatureMessage) => {
    const parsed = W.parseChannelMessage(from, m);
    if (!parsed) return;
    const s = get();
    if (parsed.kind === "closed") {
      if (s.channels[parsed.id]?.host !== from) return;
      deleteChannel(parsed.id);
      if (s.joined === parsed.id) await teardown("The channel ended. The person who made it closed it or left.");
      if (s.joining === parsed.id) {
        clearJoinTimer();
        set({ joining: null, error: W.refusalText("closed") });
      }
      return;
    }
    const c = parsed.channel;
    const existing = s.channels[c.id];
    // Ids are random; a clash with another host's channel is ignored rather than trusted.
    if (existing && existing.host !== from) return;
    if (host && host.channel.id === c.id) return;
    setChannel(c);
    const inIt = c.members.some((x) => x.key === s.me);
    if (s.joining === c.id && inIt) return enter(c);
    if (s.joined === c.id) {
      if (!inIt) return teardown("You are no longer in this channel.");
      if (existing) await applyRoster(existing, c);
    }
  };

  const onJoin = async (from: string, m: FeatureMessage) => {
    const parsed = W.parseJoinMessage(m);
    if (!parsed) return;
    if (parsed.kind === "refused") {
      if (get().joining !== parsed.id || get().channels[parsed.id]?.host !== from) return;
      clearJoinTimer();
      ring = null;
      set({ joining: null, error: W.refusalText(parsed.reason) });
      return;
    }
    if (!host || host.channel.id !== parsed.id) {
      sendToPeer(from, { t: "walkie.join", id: parsed.id, ok: false, reason: "closed" });
      return;
    }
    const name = securePeers().find((p) => p.peerKey === from)?.name ?? "Cowork user";
    const before = host.channel;
    const decision = W.decideJoin(host, { key: from, name: name.slice(0, 40) }, parsed.code);
    if (!decision.ok) {
      sendToPeer(from, { t: "walkie.join", id: parsed.id, ok: false, reason: decision.reason });
      return;
    }
    host.channel = decision.channel;
    setChannel(decision.channel);
    broadcastRoster();
    await applyRoster(before, decision.channel);
  };

  const onLeave = async (from: string, m: FeatureMessage) => {
    const id = W.parseChannelId(m);
    if (!id || get().joined !== id) return;
    if (host && host.channel.id === id) {
      const before = host.channel;
      host.channel = W.removeMember(host.channel, from);
      setChannel(host.channel);
      broadcastRoster();
      await applyRoster(before, host.channel);
      return;
    }
    const c = get().channels[id];
    if (c?.host === from) return teardown("The channel ended. The person who made it left.");
    ring?.remove(from);
    pings.forget(from);
    await dropPeer("walkie", from);
  };

  const onKey = async (from: string, m: FeatureMessage) => {
    const parsed = W.parseKeyMessage(m);
    const s = get();
    if (!parsed || !ring || from === s.me) return;
    if (s.joined !== parsed.id && s.joining !== parsed.id) return;
    // Only members the host has let in may give this phone a key. A key can arrive before the
    // host's new member list does (different links), so it waits until the list includes them.
    if (!s.channels[parsed.id]?.members.some((x) => x.key === from)) {
      if (pendingKeys.size < W.MAX_MEMBERS * 2) pendingKeys.set(from, parsed);
      return;
    }
    ring.setReceived(from, parsed.key);
    if (s.joined === parsed.id) {
      await applyKey(from);
      if (ring.needsSend(from)) sendMyKey(from);
    }
  };

  const onPing = (from: string, m: FeatureMessage) => {
    const p = W.parsePing(m);
    const s = get();
    if (!p || s.joined !== p.id || !s.channels[p.id]?.members.some((x) => x.key === from)) return;
    sendToPeer(from, { t: "walkie.pong", id: p.id, n: p.n });
  };

  const onPong = (from: string, m: FeatureMessage) => {
    const p = W.parsePing(m);
    if (!p || get().joined !== p.id) return;
    if (pings.pong(from, p.n, Date.now()) !== null) refreshQuality();
  };

  /** People connecting and disconnecting. */
  const onLinks = async () => {
    const now = new Set(securePeers().map((p) => p.peerKey));
    const lost = [...lastSecure].filter((k) => !now.has(k));
    const gained = [...now].filter((k) => !lastSecure.has(k));
    lastSecure = now;
    for (const peer of lost) {
      for (const c of Object.values(get().channels)) {
        if (c.host !== peer) continue;
        deleteChannel(c.id);
        if (get().joined === c.id) await teardown("The channel ended: this phone lost the connection to the person who made it.");
        if (get().joining === c.id) {
          clearJoinTimer();
          set({ joining: null, error: "Lost the connection to the person who made the channel." });
        }
      }
      if (host && host.channel.members.some((x) => x.key === peer)) {
        const before = host.channel;
        host.channel = W.removeMember(host.channel, peer);
        setChannel(host.channel);
        broadcastRoster();
        await applyRoster(before, host.channel);
      } else if (get().joined) {
        ring?.remove(peer);
        pings.forget(peer);
        await dropPeer("walkie", peer);
        refreshQuality();
      }
    }
    for (const peer of gained) {
      if (host) sendToPeer(peer, W.channelMessage(host.channel, host.channel.members.some((m) => m.key === peer)));
      const id = get().joined;
      if (id && get().channels[id]?.members.some((x) => x.key === peer)) sendMyKey(peer);
    }
  };

  return {
    me: null,
    channels: {},
    joined: null,
    joining: null,
    code: null,
    talking: false,
    latched: false,
    speaker: true,
    quality: {},
    busy: false,
    error: null,
    notice: null,

    start: () => {
      started ??= (async () => {
        const me = toHex((await loadIdentity()).publicKey);
        set({ me });
        lastSecure = new Set(securePeers().map((p) => p.peerKey));
        const wrap = (fn: (from: string, m: FeatureMessage) => unknown) => (from: string, m: FeatureMessage) => {
          if (!isHex64(from)) return;
          void Promise.resolve(fn(from, m)).catch(() => {});
        };
        onConnectMessage("walkie.channel", wrap(onChannel));
        onConnectMessage("walkie.join", wrap(onJoin));
        onConnectMessage("walkie.leave", wrap(onLeave));
        onConnectMessage("walkie.key", wrap(onKey));
        onConnectMessage("walkie.ping", wrap(onPing));
        onConnectMessage("walkie.pong", wrap(onPong));
        useConnect.subscribe((st, prev) => {
          if (st.links !== prev.links) void onLinks().catch(() => {});
        });
        onAudioStateChange((e) => {
          if (audioOwner() !== "walkie") return;
          if (e.state === "error") set({ error: "Voice stopped working on this phone. Leave the channel and join again." });
        });
      })();
      return started;
    },

    create: async (rawName, open) => {
      await get().start();
      const name = W.cleanChannelName(rawName);
      if (!name) return set({ error: "Give the channel a name." });
      if (get().joined || get().joining) return set({ error: "Leave your channel first." });
      if (audioOwner() === "call") return set({ error: "End the call before starting a channel." });
      if (!ConnectAudio.isAvailable()) return set({ error: audioErrorText(new Error("AUDIO_UNAVAILABLE")) });
      set({ busy: true, error: null, notice: null });
      try {
        const mic = await requestMicrophone();
        if (!mic.ok) return set({ error: micErrorText(mic.blocked) });
        await requestNotificationsQuietly();
        const me = get().me!;
        const rand = (n: number) => Crypto.getRandomBytes(n);
        const c: W.Channel = { id: W.newChannelId(rand), name, open, host: me, members: [{ key: me, name: useConnect.getState().myName }], count: 1 };
        const code = open ? null : W.newJoinCode(rand);
        host = { channel: c, code, attempts: new Map() };
        ring = new KeyRing("");
        setChannel(c);
        set({ code });
        await enter(c);
        if (get().joined === c.id) broadcastRoster();
      } finally {
        set({ busy: false });
      }
    },

    join: async (id, codeInput) => {
      await get().start();
      const c = get().channels[id];
      if (!c) return set({ error: "This channel is no longer available." });
      if (get().joined || get().joining) return set({ error: "Leave your channel first." });
      if (audioOwner() === "call") return set({ error: "End the call before joining a channel." });
      if (!ConnectAudio.isAvailable()) return set({ error: audioErrorText(new Error("AUDIO_UNAVAILABLE")) });
      const code = c.open ? null : W.normalizeCode(codeInput);
      if (!c.open && !code) return set({ error: "Enter the 6-digit code from the person who made the channel." });
      set({ busy: true, error: null, notice: null });
      try {
        const mic = await requestMicrophone();
        if (!mic.ok) return set({ error: micErrorText(mic.blocked) });
        await requestNotificationsQuietly();
        ring = new KeyRing("");
        set({ joining: id });
        const ok = sendToPeer(c.host, code ? { t: "walkie.join", id, code } : { t: "walkie.join", id });
        if (!ok) {
          ring = null;
          return set({ joining: null, error: "Not connected to the person who made this channel anymore." });
        }
        clearJoinTimer();
        joinTimer = setTimeout(() => {
          if (get().joining !== id) return;
          ring = null;
          set({ joining: null, error: "No answer from the channel. Move closer and try again." });
        }, W.JOIN_TIMEOUT_MS);
      } finally {
        set({ busy: false });
      }
    },

    leave: async () => {
      const id = get().joined ?? get().joining;
      if (!id) return;
      const c = get().channels[id];
      if (host && host.channel.id === id) broadcast({ t: "walkie.channel", id, closed: true });
      else if (c && get().joined === id) for (const m of c.members) if (m.key !== get().me) sendToPeer(m.key, { t: "walkie.leave", id });
      else if (c) sendToPeer(c.host, { t: "walkie.leave", id });
      await teardown(null);
    },

    talk: (on) => {
      if (!get().joined || get().talking === on) return;
      set({ talking: on });
      transmit("walkie", on).catch(() => set({ talking: false, error: "Could not turn on the microphone. Try again." }));
    },

    setLatched: (on) => {
      set({ latched: on });
      if (!on && get().talking) get().talk(false);
    },

    setSpeaker: (on) => {
      set({ speaker: on });
      nativeSpeaker("walkie", on).catch(() => set({ speaker: !on }));
    },

    clearMessages: () => set({ error: null, notice: null }),
  };
});
