import "./random";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { create } from "zustand";
import { toBase64 } from "./bytes";
import { linkForPeer, onConnectCleanup, onConnectMessage, peerForLink, sendToPeer, useConnect } from "./connect-store";
import * as fdb from "./files-db";
import type { TransferRow, TransferStatus } from "./files-db";
import {
  checkOutgoing,
  cleanMime,
  isTransferId,
  matchesOffer,
  MAX_PENDING_FROM_PEER,
  MAX_THUMB_B64,
  mediaClass,
  mimeFromName,
  OFFER_TTL_MS,
  parseOffer,
  safeName,
  type TransferKind,
} from "./files-logic";
import { ConnectFiles, type FileReceived, type TransferUpdate } from "./files-native";

/**
 * Connect file transfers (files, SnapShare, voice messages), over the same encrypted session as chat.
 *
 * 1. Sender: file.offer { transferId, name, size, mime, sha256, fileKey, thumb?, expiresAt, kind, ... }
 *    inside the Noise session. fileKey is 32 random bytes made here for this one transfer.
 * 2. Receiver sees a preview and decides. Nothing is ever accepted automatically.
 *    file.accept { transferId } or file.decline { transferId }.
 * 3. Sender: native sendFile (ChaCha20-Poly1305 with fileKey), then file.sent { transferId, payloadId }.
 * 4. Receiver: when the payload arrives (onFileReceived), native decryptFile, then the SHA-256 and size
 *    must equal the offer or the file is deleted.
 * Either side can send file.cancel. A view-once receiver sends file.viewed after opening it.
 * Keys stay in memory only and are dropped as soon as the transfer ends.
 */

export type SourceFile = {
  uri: string;
  name: string;
  size?: number | null;
  mime?: string | null;
  kind: TransferKind;
  disappearing?: boolean;
  durationMs?: number | null;
};

export type OfferResult = { ok: number; failed: { peer: string; reason: string }[] };

type FilesState = {
  started: boolean;
  loaded: boolean;
  available: boolean;
  transfers: TransferRow[];
  /** Live progress in bytes, by row id (kept out of the database to avoid a write per chunk). */
  progress: Record<string, number>;
  start: () => void;
  offer: (peers: string[], src: SourceFile) => Promise<OfferResult>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<OfferResult>;
  markViewed: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeForPeer: (peer: string) => Promise<void>;
};

const keys = new Map<string, string>(); // row id -> base64 file key (memory only)
const payloadToRow = new Map<string, string>(); // native payloadId -> row id
const rowToPayload = new Map<string, string>();
/** Files that arrived before their file.sent message. Unclaimed ones are deleted after a minute. */
const unclaimed = new Map<string, FileReceived & { at: number }>();
const UNCLAIMED_MS = 60_000;

let ready: Promise<void> | null = null;

const incomingId = (peer: string, transferId: string) => `in:${peer.slice(0, 16)}:${transferId}`;
const isLiveStatus = (s: TransferStatus) => fdb.ACTIVE.includes(s);

function peerName(peer: string): string {
  const s = useConnect.getState();
  return s.peers.find((p) => p.key === peer)?.name ?? Object.values(s.links).find((l) => l.peerKey === peer)?.name ?? "Someone";
}

function isBlocked(peer: string): boolean {
  return Boolean(useConnect.getState().peers.find((p) => p.key === peer)?.blocked);
}

/** Native file payloads go over Nearby only; other links (LAN, Bluetooth LE) carry text for now. */
function nearbyEndpoint(link: string): string | null {
  return /^(lan|ble):/.test(link) ? null : link;
}

async function makeThumb(uri: string): Promise<string | null> {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: 160 }).renderAsync();
    for (const compress of [0.5, 0.3]) {
      const out = await ref.saveAsync({ base64: true, compress, format: SaveFormat.JPEG });
      if (out.base64 && out.base64.length <= MAX_THUMB_B64) return out.base64;
    }
  } catch {
    // A preview is optional: the person still sees the name, size and type.
  }
  return null;
}

function sizeOf(uri: string): number | null {
  try {
    const f = new File(uri);
    return f.exists ? f.size : null;
  } catch {
    return null;
  }
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    // content:// URIs that cannot be checked here are tried anyway; native reports failure.
    return true;
  }
}

export const useFiles = create<FilesState>((set, get) => {
  const find = (id: string) => get().transfers.find((t) => t.id === id);
  const upsert = (row: TransferRow) => set((s) => ({ transfers: [row, ...s.transfers.filter((t) => t.id !== row.id)].sort((a, b) => b.ts - a.ts) }));
  const patch = (id: string, p: Partial<Pick<TransferRow, "status" | "bytesDone" | "uri" | "thumb" | "error">>) => {
    void fdb.patchTransfer(id, p).catch(() => {});
    set((s) => ({ transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  };
  const setProgress = (id: string, bytes: number) => set((s) => ({ progress: { ...s.progress, [id]: bytes } }));
  const forget = (id: string) => {
    keys.delete(id);
    const payload = rowToPayload.get(id);
    if (payload) payloadToRow.delete(payload);
    rowToPayload.delete(id);
    set((s) => {
      if (!(id in s.progress)) return {};
      const progress = { ...s.progress };
      delete progress[id];
      return { progress };
    });
  };
  const end = (id: string, status: TransferStatus, error: string | null = null) => {
    patch(id, { status, error });
    forget(id);
  };

  const finishReceive = async (id: string, path: string) => {
    const row = find(id);
    const key = keys.get(id);
    if (!row || !key || row.status !== "receiving") {
      ConnectFiles.deleteFile(path);
      return;
    }
    try {
      // A unique stored name, so two files called "photo.jpg" never overwrite each other.
      const stored = `${row.transferId.slice(0, 8)}-${safeName(row.name)}`;
      const out = await ConnectFiles.decryptFile(path, key, stored);
      if (!matchesOffer(out, row)) {
        ConnectFiles.deleteFile(out.uri);
        return end(id, "failed", "The file did not match what was offered, so it was deleted.");
      }
      patch(id, { uri: out.uri, bytesDone: row.size });
      end(id, "received");
    } catch {
      ConnectFiles.deleteFile(path);
      end(id, "failed", "The file was damaged in transit and could not be opened. Nothing was saved.");
    }
  };

  const onTransferUpdate = (e: TransferUpdate) => {
    const id = payloadToRow.get(e.payloadId);
    const row = id ? find(id) : undefined;
    if (!id || !row || Boolean(row.outgoing) === e.incoming) return;
    if (peerForLink(e.endpointId) !== row.peer) return;
    const done = Math.max(0, Math.min(row.size * 2, Number(e.bytesTransferred) || 0));
    if (e.status === "in_progress") return setProgress(id, done);
    if (e.status === "success") {
      if (row.outgoing) {
        patch(id, { bytesDone: row.size });
        end(id, "sent");
      } else setProgress(id, done);
      return;
    }
    if (e.status === "canceled") return end(id, "canceled");
    end(id, "failed", "The connection dropped during the transfer.");
  };

  const onFileReceived = (e: FileReceived) => {
    const id = payloadToRow.get(e.payloadId);
    const row = id ? find(id) : undefined;
    if (id && row && !row.outgoing && peerForLink(e.endpointId) === row.peer) {
      void finishReceive(id, e.path);
      return;
    }
    // file.sent may still be on its way: hold the encrypted file briefly, then delete it.
    unclaimed.set(e.payloadId, { ...e, at: Date.now() });
  };

  const sweep = () => {
    const now = Date.now();
    for (const [payloadId, f] of unclaimed) {
      if (now - f.at > UNCLAIMED_MS) {
        ConnectFiles.deleteFile(f.path);
        unclaimed.delete(payloadId);
      }
    }
    for (const t of get().transfers) {
      if ((t.status === "offered" || t.status === "incoming" || t.status === "accepted") && t.expiresAt <= now && !rowToPayload.has(t.id)) {
        end(t.id, "expired");
      }
    }
  };

  // ---------- Feature messages from peers ----------
  const onOffer = (peer: string, m: Record<string, unknown>) => {
    if (isBlocked(peer)) return;
    const offer = parseOffer(m);
    if (!offer) return;
    const id = incomingId(peer, offer.transferId);
    if (find(id)) return;
    const waiting = get().transfers.filter((t) => t.peer === peer && t.status === "incoming").length;
    if (waiting >= MAX_PENDING_FROM_PEER) {
      sendToPeer(peer, { t: "file.decline", transferId: offer.transferId });
      return;
    }
    keys.set(id, offer.fileKey);
    const row: TransferRow = {
      id,
      transferId: offer.transferId,
      peer,
      peerName: peerName(peer),
      outgoing: 0,
      kind: offer.kind,
      name: offer.name,
      size: offer.size,
      mime: offer.mime,
      sha256: offer.sha256,
      thumb: offer.thumb,
      status: "incoming",
      bytesDone: 0,
      uri: null,
      disappearing: offer.disappearing ? 1 : 0,
      durationMs: offer.durationMs,
      batchId: null,
      error: null,
      ts: Date.now(),
      expiresAt: offer.expiresAt,
    };
    void fdb.insertTransfer(row).catch(() => {});
    upsert(row);
  };

  const onAccept = async (peer: string, m: Record<string, unknown>, link: string) => {
    if (!isTransferId(m.transferId)) return;
    const row = find(m.transferId);
    if (!row || !row.outgoing || row.peer !== peer || row.status !== "offered") return;
    const key = keys.get(row.id);
    if (!key || row.expiresAt <= Date.now() || !row.uri) {
      sendToPeer(peer, { t: "file.cancel", transferId: row.transferId });
      return end(row.id, "expired");
    }
    const endpoint = nearbyEndpoint(link);
    if (!endpoint) {
      sendToPeer(peer, { t: "file.cancel", transferId: row.transferId });
      return end(row.id, "failed", "Files need a direct Nearby connection.");
    }
    patch(row.id, { status: "sending" });
    try {
      const payloadId = await ConnectFiles.sendFile(endpoint, row.uri, key);
      payloadToRow.set(payloadId, row.id);
      rowToPayload.set(row.id, payloadId);
      if (find(row.id)?.status !== "sending") {
        // Canceled while the encrypted copy was being prepared.
        ConnectFiles.cancelPayload(payloadId);
        return;
      }
      if (!sendToPeer(peer, { t: "file.sent", transferId: row.transferId, payloadId })) {
        ConnectFiles.cancelPayload(payloadId);
        end(row.id, "failed", "Not connected anymore.");
      }
    } catch {
      sendToPeer(peer, { t: "file.cancel", transferId: row.transferId });
      end(row.id, "failed", "Could not read or send this file.");
    }
  };

  const onDecline = (peer: string, m: Record<string, unknown>) => {
    if (!isTransferId(m.transferId)) return;
    const row = find(m.transferId);
    if (row?.outgoing && row.peer === peer && row.status === "offered") end(row.id, "declined");
  };

  const onSent = (peer: string, m: Record<string, unknown>, link: string) => {
    if (!isTransferId(m.transferId) || typeof m.payloadId !== "string" || !/^-?[A-Za-z0-9_]{1,64}$/.test(m.payloadId)) return;
    const payloadId = m.payloadId;
    const id = incomingId(peer, m.transferId);
    const row = find(id);
    if (!row || row.status !== "accepted" || payloadToRow.has(payloadId)) {
      // Data I did not agree to: stop it.
      ConnectFiles.cancelPayload(payloadId);
      return;
    }
    payloadToRow.set(payloadId, id);
    rowToPayload.set(id, payloadId);
    patch(id, { status: "receiving" });
    const early = unclaimed.get(payloadId);
    if (early && early.endpointId === link) {
      unclaimed.delete(payloadId);
      void finishReceive(id, early.path);
    }
  };

  const onCancel = (peer: string, m: Record<string, unknown>) => {
    if (!isTransferId(m.transferId)) return;
    const mine = find(m.transferId);
    const row = mine?.outgoing && mine.peer === peer ? mine : find(incomingId(peer, m.transferId));
    if (!row || !isLiveStatus(row.status)) return;
    const payload = rowToPayload.get(row.id);
    if (payload) ConnectFiles.cancelPayload(payload);
    end(row.id, "canceled", `${row.peerName} canceled it.`);
  };

  const onViewed = (peer: string, m: Record<string, unknown>) => {
    if (!isTransferId(m.transferId)) return;
    const row = find(m.transferId);
    if (row?.outgoing && row.peer === peer && row.disappearing && row.status === "sent") patch(row.id, { status: "viewed" });
  };

  const offerOne = async (peer: string, src: SourceFile, meta: { name: string; size: number; mime: string; sha256: string; thumb: string | null; batchId: string | null }) => {
    const link = linkForPeer(useConnect.getState(), peer);
    const transferId = Crypto.randomUUID();
    const key = toBase64(Crypto.getRandomBytes(32));
    const now = Date.now();
    const disappearing = src.kind === "snap" && Boolean(src.disappearing);
    const row: TransferRow = {
      id: transferId,
      transferId,
      peer,
      peerName: peerName(peer),
      outgoing: 1,
      kind: src.kind,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      sha256: meta.sha256,
      thumb: meta.thumb,
      status: "offered",
      bytesDone: 0,
      uri: src.uri,
      disappearing: disappearing ? 1 : 0,
      durationMs: src.kind === "voice" ? (src.durationMs ?? null) : null,
      batchId: meta.batchId,
      error: null,
      ts: now,
      expiresAt: now + OFFER_TTL_MS,
    };
    await fdb.insertTransfer(row).catch(() => {});
    upsert(row);
    if (!link) {
      end(row.id, "failed", "Not connected. Both phones need Connect open.");
      return "Not connected";
    }
    keys.set(row.id, key);
    const sent = sendToPeer(peer, {
      t: "file.offer",
      transferId,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      sha256: meta.sha256,
      fileKey: key,
      ...(meta.thumb && !disappearing ? { thumb: meta.thumb } : {}),
      expiresAt: row.expiresAt,
      kind: src.kind,
      ...(disappearing ? { disappearing: true } : {}),
      ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
    });
    if (!sent) {
      end(row.id, "failed", "Not connected. Both phones need Connect open.");
      return "Not connected";
    }
    return null;
  };

  return {
    started: false,
    loaded: false,
    available: false,
    transfers: [],
    progress: {},

    start: () => {
      if (get().started) return;
      set({ started: true, available: ConnectFiles.isAvailable() });
      // Messages wait until history has loaded, so nothing new is overwritten by the startup cleanup.
      const after = (fn: () => unknown) => void ready?.then(fn);
      onConnectMessage("file.offer", (peer, m) => after(() => onOffer(peer, m)));
      onConnectMessage("file.accept", (peer, m, link) => after(() => onAccept(peer, m, link)));
      onConnectMessage("file.decline", (peer, m) => after(() => onDecline(peer, m)));
      onConnectMessage("file.sent", (peer, m, link) => after(() => onSent(peer, m, link)));
      onConnectMessage("file.cancel", (peer, m) => after(() => onCancel(peer, m)));
      onConnectMessage("file.viewed", (peer, m) => after(() => onViewed(peer, m)));
      onConnectCleanup({
        forgetPeer: async (peer) => {
          await ready;
          await get().removeForPeer(peer);
        },
        reset: () => {
          // Storage and files on disk are cleared by resetConnect; this drops what is held in memory.
          rowToPayload.forEach((payload) => ConnectFiles.cancelPayload(payload));
          keys.clear();
          payloadToRow.clear();
          rowToPayload.clear();
          unclaimed.clear();
          set({ transfers: [], progress: {} });
        },
      });
      ConnectFiles.addListener("onTransferUpdate", onTransferUpdate);
      ConnectFiles.addListener("onFileReceived", onFileReceived);
      setInterval(sweep, 15_000);
      ready = (async () => {
        try {
          await fdb.failInterrupted();
          const rows = await fdb.listTransfers();
          // Keep anything that arrived while history was loading.
          set((s) => ({ loaded: true, transfers: [...s.transfers, ...rows.filter((r) => !s.transfers.some((t) => t.id === r.id))].sort((a, b) => b.ts - a.ts) }));
        } catch {
          set({ loaded: true });
        }
      })();
    },

    offer: async (peers, src) => {
      const result: OfferResult = { ok: 0, failed: [] };
      const failAll = (reason: string) => ({ ok: 0, failed: peers.map((peer) => ({ peer, reason })) });
      if (!ConnectFiles.isAvailable()) return failAll("File sharing is not available in this build of Cowork.");
      const name = safeName(src.name, src.kind === "voice" ? "voice.m4a" : "file");
      const mime = cleanMime(src.mime || mimeFromName(name));
      const size = src.size && src.size > 0 ? src.size : sizeOf(src.uri);
      const check = checkOutgoing(name, size ?? 0, mime);
      if (!check.ok) return failAll(check.reason);
      let sha256: string;
      try {
        sha256 = (await ConnectFiles.sha256File(src.uri)).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("bad hash");
      } catch {
        return failAll("Could not read this file.");
      }
      const thumb = mediaClass(mime) === "image" && !(src.kind === "snap" && src.disappearing) ? await makeThumb(src.uri) : null;
      const batchId = peers.length > 1 ? Crypto.randomUUID() : null;
      for (const peer of [...new Set(peers)]) {
        const err = await offerOne(peer, src, { name, size: size!, mime, sha256, thumb, batchId });
        if (err) result.failed.push({ peer, reason: err });
        else result.ok += 1;
      }
      return result;
    },

    accept: async (id) => {
      const row = find(id);
      if (!row || row.outgoing || row.status !== "incoming") return;
      if (row.expiresAt <= Date.now() || !keys.has(id)) return end(id, "expired");
      if (!ConnectFiles.isAvailable()) return end(id, "failed", "File sharing is not available in this build of Cowork.");
      patch(id, { status: "accepted" });
      if (!sendToPeer(row.peer, { t: "file.accept", transferId: row.transferId })) end(id, "failed", "Not connected anymore. Ask them to send it again.");
    },

    decline: async (id) => {
      const row = find(id);
      if (!row || row.outgoing || row.status !== "incoming") return;
      sendToPeer(row.peer, { t: "file.decline", transferId: row.transferId });
      end(id, "declined");
    },

    cancel: async (id) => {
      const row = find(id);
      if (!row || !isLiveStatus(row.status)) return;
      if (!row.outgoing && row.status === "incoming") return get().decline(id);
      const payload = rowToPayload.get(id);
      if (payload) ConnectFiles.cancelPayload(payload);
      sendToPeer(row.peer, { t: "file.cancel", transferId: row.transferId });
      end(id, "canceled");
    },

    retry: async (id) => {
      const row = find(id);
      if (!row || !row.outgoing || !row.uri || isLiveStatus(row.status)) return { ok: 0, failed: [{ peer: row?.peer ?? "", reason: "Nothing to retry." }] };
      if (!fileExists(row.uri)) return { ok: 0, failed: [{ peer: row.peer, reason: "The original file is no longer on this phone." }] };
      return get().offer([row.peer], { uri: row.uri, name: row.name, size: row.size, mime: row.mime, kind: row.kind, disappearing: Boolean(row.disappearing), durationMs: row.durationMs });
    },

    markViewed: async (id) => {
      const row = find(id);
      if (!row || row.outgoing || !row.disappearing || row.status !== "received") return;
      if (row.uri) ConnectFiles.deleteFile(row.uri);
      patch(id, { status: "viewed", uri: null, thumb: null });
      sendToPeer(row.peer, { t: "file.viewed", transferId: row.transferId });
    },

    remove: async (id) => {
      const row = find(id);
      if (!row) return;
      if (isLiveStatus(row.status)) await get().cancel(id);
      // Only files Connect saved are deleted; a sender's original stays where it was.
      if (!row.outgoing && row.uri) ConnectFiles.deleteFile(row.uri);
      forget(id);
      await fdb.deleteTransfer(id).catch(() => {});
      set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) }));
    },

    removeForPeer: async (peer) => {
      for (const t of get().transfers.filter((x) => x.peer === peer && isLiveStatus(x.status))) await get().cancel(t.id);
      const rows = await fdb.deleteTransfersForPeer(peer).catch(() => []);
      rows.forEach((r) => {
        if (!r.outgoing && r.uri) ConnectFiles.deleteFile(r.uri);
      });
      get().transfers.filter((t) => t.peer === peer).forEach((t) => forget(t.id));
      set((s) => ({ transfers: s.transfers.filter((t) => t.peer !== peer) }));
    },
  };
});

/** Starts listening for file messages and native events. Safe to call more than once. */
export function startFiles() {
  useFiles.getState().start();
}
