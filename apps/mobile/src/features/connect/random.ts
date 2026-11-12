import * as Crypto from "expo-crypto";

// The @noble crypto libraries draw randomness from globalThis.crypto.getRandomValues. React Native
// does not provide it, so back it with expo-crypto (the platform's secure random source).
// Imported for its side effect before anything that generates keys.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== "function") {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: Crypto.getRandomValues };
}
