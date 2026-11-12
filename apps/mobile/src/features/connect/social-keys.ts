import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fromHex, toHex, utf8 } from "./bytes";
import { loadIdentity } from "./identity";

/**
 * Connect key registry. Registering lets people in your circles recognise this phone when you meet
 * offline. The server only accepts a key with proof that this phone holds its private half:
 *   proof = HMAC-SHA256(X25519(our private key, server key), "cowork-connect-key-v1|<account>|<our public key>")
 * The private key never leaves the phone.
 */
export type KeyInfo = { account: string; serverKey: string | null; items: { publicKey: string; label: string; createdAt: string }[] };
export type ResolvedKey = { publicKey: string; userId: string; name: string; isMe: boolean };

const KEYS = ["connect", "keys"] as const;

export function useMyKeys() {
  return useQuery({
    queryKey: KEYS,
    queryFn: async () => {
      const [info, id] = await Promise.all([api<KeyInfo>("/api/connect/keys"), loadIdentity()]);
      const mine = toHex(id.publicKey);
      return { ...info, thisPhone: mine, registered: info.items.some((k) => k.publicKey === mine) };
    },
  });
}

export function useKeyActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS });
  return {
    register: useMutation({
      mutationFn: async (label: string) => {
        const info = await api<KeyInfo>("/api/connect/keys");
        if (!info.serverKey) throw new Error("Key registration is not set up on the server yet.");
        const id = await loadIdentity();
        const publicKey = toHex(id.publicKey);
        const shared = x25519.getSharedSecret(id.privateKey, fromHex(info.serverKey));
        const proof = toHex(hmac(sha256, shared, utf8(`cowork-connect-key-v1|${info.account}|${publicKey}`)));
        return api("/api/connect/keys", { body: { publicKey, proof, label } });
      },
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (publicKey: string) => api(`/api/connect/keys?key=${encodeURIComponent(publicKey)}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

/** Which of these Connect keys belong to people in your circles (others are not returned). */
export function useResolveKeys(keys: string[]) {
  const sorted = [...new Set(keys)].sort().slice(0, 100);
  return useQuery({
    queryKey: ["connect", "resolve", sorted.join(",")],
    queryFn: () => api<{ items: ResolvedKey[] }>("/api/connect/keys/resolve", { body: { keys: sorted } }).then((r) => r.items),
    enabled: sorted.length > 0,
    staleTime: 5 * 60_000,
  });
}
