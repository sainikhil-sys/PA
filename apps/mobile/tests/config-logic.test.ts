import { describe, expect, it } from "vitest";
import { decideGate, FOREGROUND_MAX_AGE_MS, isStale, parseCached, parseConfig, POLL_INTERVAL_MS, showOptionalUpdate, visibleAnnouncements, type ClientConfig } from "../src/features/config/logic";
import { buildClientHeaders } from "../src/lib/client-headers";

function config(over: Partial<ClientConfig> = {}): ClientConfig {
  return {
    configVersion: 1,
    maintenance: { active: false, message: null, endsAt: null },
    update: { status: "ok", latestVersion: "1.1.0", message: null, storeUrl: "https://play.google.com/store/apps/details?id=me.antropic.cowork" },
    announcements: [],
    settings: {},
    ...over,
  };
}

describe("version headers", () => {
  it("sends platform, version and the build as a whole number", () => {
    expect(buildClientHeaders("1.2.0", "14")).toEqual({ "X-Cowork-Platform": "android", "X-Cowork-App-Version": "1.2.0", "X-Cowork-Build": "14" });
  });
  it("leaves out a missing or malformed version and build", () => {
    expect(buildClientHeaders(null, null)).toEqual({ "X-Cowork-Platform": "android" });
    expect(buildClientHeaders("1.0 beta\n", "14a")).toEqual({ "X-Cowork-Platform": "android" });
    expect(buildClientHeaders("", "-3")).toEqual({ "X-Cowork-Platform": "android" });
  });
  it("accepts a numeric build", () => {
    expect(buildClientHeaders("1.0.0", 7)["X-Cowork-Build"]).toBe("7");
  });
});

describe("staleness", () => {
  const now = 1_000_000_000;
  it("treats a missing copy as stale", () => expect(isStale(null, now, FOREGROUND_MAX_AGE_MS)).toBe(true));
  it("keeps a copy younger than 5 minutes on foreground", () => expect(isStale(now - FOREGROUND_MAX_AGE_MS + 1, now, FOREGROUND_MAX_AGE_MS)).toBe(false));
  it("refetches at 5 minutes", () => expect(isStale(now - FOREGROUND_MAX_AGE_MS, now, FOREGROUND_MAX_AGE_MS)).toBe(true));
  it("treats a clock that moved back as stale", () => expect(isStale(now + 1000, now, FOREGROUND_MAX_AGE_MS)).toBe(true));
  it("polls every 15 minutes", () => expect(POLL_INTERVAL_MS).toBe(15 * 60_000));
});

describe("parsing", () => {
  it("reads the server's configuration and drops a malformed announcement only", () => {
    const c = parseConfig({ ...config(), announcements: [{ id: "a", title: "T", body: "B", severity: "info", placement: "banner", href: null, dismissible: true }, { nope: 1 }] });
    expect(c?.announcements.map((a) => a.id)).toEqual(["a"]);
  });
  it("rejects something that isn't a configuration", () => {
    expect(parseConfig({ hello: "world" })).toBeNull();
    expect(parseConfig(null)).toBeNull();
  });
  it("round-trips the cached copy and ignores a corrupt one", () => {
    const text = JSON.stringify({ config: config(), fetchedAt: 123, dismissedUpdateVersion: "1.1.0" });
    expect(parseCached(text)).toEqual({ config: config(), fetchedAt: 123, dismissedUpdateVersion: "1.1.0" });
    expect(parseCached("{not json")).toBeNull();
    expect(parseCached(JSON.stringify({ config: config() }))).toBeNull();
    expect(parseCached(null)).toBeNull();
  });
});

describe("update and maintenance decision", () => {
  const none = { updateRequired: null, maintenance: null };
  it("shows nothing for an ordinary configuration", () => {
    expect(decideGate({ config: config(), source: "network", ...none }).kind).toBe("none");
    expect(decideGate({ config: null, source: null, ...none }).kind).toBe("none");
  });
  it("shows the update screen for a 426, with its store link", () => {
    expect(decideGate({ config: null, source: null, updateRequired: { message: "Update", storeUrl: "https://x" }, maintenance: null })).toEqual({ kind: "update", message: "Update", storeUrl: "https://x" });
  });
  it("keeps a required update known from the cached copy, even offline", () => {
    const c = config({ update: { status: "required", latestVersion: "2.0.0", message: "Please update", storeUrl: "https://s" } });
    expect(decideGate({ config: c, source: "cache", ...none })).toEqual({ kind: "update", message: "Please update", storeUrl: "https://s" });
  });
  it("puts a required update ahead of maintenance", () => {
    const c = config({ update: { status: "required", latestVersion: "2.0.0", message: null, storeUrl: null }, maintenance: { active: true, message: "Down", endsAt: null } });
    expect(decideGate({ config: c, source: "network", ...none }).kind).toBe("update");
  });
  it("shows maintenance from the server's configuration or a 503", () => {
    const c = config({ maintenance: { active: true, message: "Down", endsAt: "2026-11-12T10:00:00Z" } });
    expect(decideGate({ config: c, source: "network", ...none })).toEqual({ kind: "maintenance", message: "Down", endsAt: "2026-11-12T10:00:00Z" });
    expect(decideGate({ config: config(), source: "network", updateRequired: null, maintenance: { message: "503", endsAt: null } }).kind).toBe("maintenance");
  });
  it("never blocks on maintenance from an old cached copy", () => {
    const c = config({ maintenance: { active: true, message: "Down", endsAt: null } });
    expect(decideGate({ config: c, source: "cache", ...none }).kind).toBe("none");
  });
});

describe("Home notices", () => {
  const optional = config({ update: { status: "optional", latestVersion: "1.3.0", message: null, storeUrl: null } });
  it("shows the optional update once per version", () => {
    expect(showOptionalUpdate(optional, null)).toBe(true);
    expect(showOptionalUpdate(optional, "1.3.0")).toBe(false);
    expect(showOptionalUpdate(optional, "1.2.0")).toBe(true);
    expect(showOptionalUpdate(config(), null)).toBe(false);
  });
  it("hides a dismissed announcement at once", () => {
    const a = { id: "x", title: "T", body: "B", severity: "info" as const, placement: "banner" as const, href: null, dismissible: true };
    const c = config({ announcements: [a, { ...a, id: "y" }] });
    expect(visibleAnnouncements(c, ["x"]).map((v) => v.id)).toEqual(["y"]);
    expect(visibleAnnouncements(null, [])).toEqual([]);
  });
});
