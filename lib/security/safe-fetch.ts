import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges (IPv4 + IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true; // not an IP at all: treat as unsafe
}

/** Throws unless every address the host resolves to is public. */
async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private addresses are not allowed");
    return;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("Private addresses are not allowed");
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Private addresses are not allowed");
}

/**
 * fetch() for user- or feed-supplied URLs: http(s) only, public hosts only, and redirects are
 * followed by hand (max 4) with the same check on every hop, so a redirect can't reach internal
 * services. (A DNS answer could still change between check and connect; the window is tiny and
 * Vercel functions have no private network to reach.)
 */
export async function safeFetch(raw: string | URL, init: RequestInit = {}, maxRedirects = 4): Promise<Response> {
  let url = new URL(raw);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are supported");
    if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
    await assertPublicHost(url.hostname);
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= maxRedirects) throw new Error("Too many redirects");
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    return res;
  }
}
