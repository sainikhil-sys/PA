import { beforeEach, describe, expect, it, vi } from "vitest";

// SecureStore stand-in with async gaps, so concurrent callers really interleave like on a phone.
const store = new Map<string, string>();
let writes = 0;
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => {
    await new Promise((r) => setTimeout(r, 5));
    return store.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    await new Promise((r) => setTimeout(r, 5));
    writes++;
    store.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    store.delete(k);
  },
}));
vi.mock("../../src/features/connect/random", () => ({}));

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("Connect identity", () => {
  beforeEach(() => {
    store.clear();
    writes = 0;
    vi.resetModules();
  });

  it("gives every caller the same key on a fresh install (Connect, Calls, Walkie and Groups start together)", async () => {
    const { loadIdentity } = await import("../../src/features/connect/identity");
    const keys = await Promise.all([loadIdentity(), loadIdentity(), loadIdentity(), loadIdentity()]);
    const hex = new Set(keys.map((k) => toHex(k.publicKey)));
    expect(hex.size).toBe(1);
    expect(writes).toBe(1);
  });

  it("returns the stored key after a restart", async () => {
    const first = await (await import("../../src/features/connect/identity")).loadIdentity();
    vi.resetModules();
    const again = await (await import("../../src/features/connect/identity")).loadIdentity();
    expect(toHex(again.publicKey)).toBe(toHex(first.publicKey));
    expect(writes).toBe(1);
  });

  it("makes a new key after a reset, once", async () => {
    const mod = await import("../../src/features/connect/identity");
    const first = await mod.loadIdentity();
    await mod.resetIdentity();
    const [a, b] = await Promise.all([mod.loadIdentity(), mod.loadIdentity()]);
    expect(toHex(a.publicKey)).toBe(toHex(b.publicKey));
    expect(toHex(a.publicKey)).not.toBe(toHex(first.publicKey));
    expect(writes).toBe(2);
  });
});
