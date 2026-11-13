import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Connect on Spaces routes with the database replaced by a recorder: each query resolves to what
 * state.run returns for its operation and table. getSpace (which applies every Space visibility
 * rule) is replaced by state.space.
 */
type Query = { op: string; table: string; data?: unknown };
type SpaceView = { id: string; anonymous: boolean; myStatus: "active" | "requested" | null; myRole: string | null; canRead: boolean; canPost: boolean; canModerate: boolean; archived: boolean };

const state = vi.hoisted(() => {
  // The key proof derives the server key from this secret.
  process.env.ENCRYPTION_KEY ||= "test-secret-for-connect-keys";
  const tableProxy = (name: string): unknown => new Proxy({ __name: name }, { get: (o, p) => (p === "__name" ? o.__name : { column: String(p) }) });
  return {
    tableProxy,
    signedIn: true,
    space: null as null | SpaceView,
    queries: [] as Query[],
    run: (() => []) as (q: Query) => unknown[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/api", () => ({
  apiGuard: async () =>
    state.signedIn
      ? { user: { id: "11111111-1111-4111-8111-111111111111", email: "me@example.com", createdAt: new Date("2026-01-01"), disabledAt: null } }
      : { response: Response.json({ ok: false, message: "Sign in first." }, { status: 401 }) },
}));
vi.mock("@/lib/security/ratelimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} }, errMessage: (e: unknown) => String(e) }));
vi.mock("@/lib/social/service", () => ({
  SocialError: class SocialError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/spaces/service", async () => {
  const { SocialError } = await import("@/lib/social/service");
  return {
    getSpace: async () => {
      if (!state.space) throw new SocialError(404, "That Space doesn't exist, or was removed.");
      return state.space;
    },
  };
});
vi.mock("@/lib/db", () => {
  const schema = new Proxy({}, { get: (_t, name) => state.tableProxy(String(name)) });
  const db = () => {
    const q: Query = { op: "", table: "" };
    const chain: unknown = new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            state.queries.push(q);
            try {
              resolve(state.run(q));
            } catch (err) {
              reject(err);
            }
          };
        }
        return (...args: { __name?: string }[]) => {
          const p = String(prop);
          if (["select", "selectDistinct", "insert", "update", "delete"].includes(p) && !q.op) {
            q.op = p;
            if (p !== "select" && p !== "selectDistinct") q.table = args[0]?.__name ?? "";
          }
          if (p === "from") q.table = args[0]?.__name ?? "";
          if (p === "values" || p === "set") q.data = args[0];
          return chain;
        };
      },
    });
    return chain;
  };
  return { db, schema };
});
vi.mock("drizzle-orm", () => {
  const f = () => ({});
  return { and: f, or: f, eq: f, ne: f, gt: f, lt: f, inArray: f, desc: f, asc: f, count: f, sql: f };
});
vi.mock("drizzle-orm/pg-core", () => ({ alias: (_t: unknown, name: string) => state.tableProxy(name) }));

const notes = await import("@/app/api/spaces/[id]/notes/route");
const note = await import("@/app/api/spaces/[id]/notes/[noteId]/route");
const rooms = await import("@/app/api/spaces/[id]/rooms/route");
const room = await import("@/app/api/spaces/[id]/rooms/[roomId]/route");
const presence = await import("@/app/api/spaces/[id]/rooms/[roomId]/presence/route");
const keys = await import("@/app/api/connect/keys/route");
const resolve = await import("@/app/api/connect/keys/resolve/route");

const ME = "11111111-1111-4111-8111-111111111111";
const SPACE = "33333333-3333-4333-8333-333333333333";
const NOTE = "44444444-4444-4444-8444-444444444444";
const ROOM = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";

const member: SpaceView = { id: SPACE, anonymous: false, myStatus: "active", myRole: "member", canRead: true, canPost: true, canModerate: false, archived: false };

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://cowork.test${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ps = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const noteRow = (extra: Record<string, unknown> = {}) => ({
  id: NOTE,
  spaceId: SPACE,
  title: "Plan",
  body: "Bring snacks",
  version: 3,
  createdBy: OTHER,
  updatedBy: OTHER,
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-02T10:00:00Z"),
  ...extra,
});
const roomRow = (extra: Record<string, unknown> = {}) => ({
  id: ROOM,
  spaceId: SPACE,
  kind: "focus",
  title: "Study",
  createdBy: OTHER,
  timerStatus: "idle",
  durationSec: 1500,
  endsAt: null,
  remainingSec: null,
  mediaUrl: null,
  mediaKind: null,
  mediaStartAt: null,
  updatedBy: OTHER,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

/** Every Space route, with a valid body. */
const ROUTES: { name: string; write: boolean; call: () => Promise<Response> }[] = [
  { name: "GET notes", write: false, call: () => notes.GET(req("GET", "/n"), ps({ id: SPACE })) },
  { name: "POST notes", write: true, call: () => notes.POST(req("POST", "/n", { title: "T", body: "" }), ps({ id: SPACE })) },
  { name: "GET note", write: false, call: () => note.GET(req("GET", "/n"), ps({ id: SPACE, noteId: NOTE })) },
  { name: "PUT note", write: true, call: () => note.PUT(req("PUT", "/n", { title: "T", body: "", version: 3 }), ps({ id: SPACE, noteId: NOTE })) },
  { name: "DELETE note", write: true, call: () => note.DELETE(req("DELETE", "/n"), ps({ id: SPACE, noteId: NOTE })) },
  { name: "GET rooms", write: false, call: () => rooms.GET(req("GET", "/r"), ps({ id: SPACE })) },
  { name: "POST rooms", write: true, call: () => rooms.POST(req("POST", "/r", { kind: "focus", title: "Study" }), ps({ id: SPACE })) },
  { name: "GET room", write: false, call: () => room.GET(req("GET", "/r"), ps({ id: SPACE, roomId: ROOM })) },
  { name: "PATCH room", write: true, call: () => room.PATCH(req("PATCH", "/r", { action: "start", minutes: 25 }), ps({ id: SPACE, roomId: ROOM })) },
  { name: "DELETE room", write: true, call: () => room.DELETE(req("DELETE", "/r"), ps({ id: SPACE, roomId: ROOM })) },
  { name: "POST presence", write: true, call: () => presence.POST(req("POST", "/p", { consent: true }), ps({ id: SPACE, roomId: ROOM })) },
  { name: "DELETE presence", write: false, call: () => presence.DELETE(req("DELETE", "/p"), ps({ id: SPACE, roomId: ROOM })) },
];

beforeEach(() => {
  state.signedIn = true;
  state.space = { ...member };
  state.queries = [];
  state.run = () => [];
});

describe("membership checks on every Space route", () => {
  it.each(ROUTES)("$name: signed out is 401 and touches nothing", async (r) => {
    state.signedIn = false;
    expect((await r.call()).status).toBe(401);
    expect(state.queries).toEqual([]);
  });

  it.each(ROUTES)("$name: a Space the person may not see is 404 and touches nothing", async (r) => {
    state.space = null;
    const res = await r.call();
    expect(res.status).toBe(404);
    expect(state.queries).toEqual([]);
  });

  it.each(ROUTES)("$name: a non-member of a public Space is refused", async (r) => {
    state.space = { ...member, myStatus: null, myRole: null, canPost: false };
    const res = await r.call();
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("Join this Space to see its notes and rooms.");
    expect(state.queries).toEqual([]);
  });

  it.each(ROUTES)("$name: a pending join request is refused", async (r) => {
    state.space = { ...member, myStatus: "requested", myRole: null, canPost: false };
    expect((await r.call()).status).toBe(403);
    expect(state.queries).toEqual([]);
  });

  it.each(ROUTES)("$name: anonymous Spaces have no notes or rooms", async (r) => {
    state.space = { ...member, anonymous: true };
    const res = await r.call();
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/anonymous Spaces/);
    expect(state.queries).toEqual([]);
  });

  it.each(ROUTES.filter((r) => r.write))("$name: archived Spaces are read-only", async (r) => {
    state.space = { ...member, canPost: false, archived: true };
    const res = await r.call();
    expect(res.status).toBe(409);
    expect(state.queries).toEqual([]);
  });

  it("a bad Space id is 400 before anything is read", async () => {
    const res = await notes.GET(req("GET", "/n"), ps({ id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(state.queries).toEqual([]);
  });

  it("notes and rooms are always looked up inside the caller's Space", async () => {
    state.run = (q) => (q.table === "spaceNotes" ? [noteRow()] : q.table === "spaceRooms" ? [roomRow()] : []);
    await note.GET(req("GET", "/n"), ps({ id: SPACE, noteId: NOTE }));
    await room.GET(req("GET", "/r"), ps({ id: SPACE, roomId: ROOM }));
    // A note or room from another Space is simply not found (the query filters by spaceId too).
    state.run = () => [];
    expect((await note.GET(req("GET", "/n"), ps({ id: SPACE, noteId: NOTE }))).status).toBe(404);
    expect((await room.GET(req("GET", "/r"), ps({ id: SPACE, roomId: ROOM }))).status).toBe(404);
  });
});

describe("Space notes", () => {
  it("GET returns the note with the editor's display name, never an email", async () => {
    state.run = (q) => (q.table === "spaceNotes" ? [noteRow()] : q.table === "socialProfiles" ? [{ id: OTHER, name: "Asha" }] : []);
    const res = await note.GET(req("GET", "/n"), ps({ id: SPACE, noteId: NOTE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: NOTE, title: "Plan", body: "Bring snacks", version: 3, updatedBy: "Asha", updatedAt: "2026-11-02T10:00:00.000Z", mine: false });
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it("a save from the current version goes through and bumps the version", async () => {
    state.run = (q) => {
      if (q.table === "spaceNotes" && q.op === "update") return [noteRow({ title: "New", version: 4, updatedBy: ME })];
      if (q.table === "spaceNotes") return [noteRow()];
      return [];
    };
    const res = await note.PUT(req("PUT", "/n", { title: "New", body: "x", version: 3 }), ps({ id: SPACE, noteId: NOTE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.note).toMatchObject({ title: "New", version: 4 });
  });

  it("a stale version answers 409 with latest in exactly the GET shape", async () => {
    const latest = noteRow({ title: "Their edit", body: "Saved first", version: 5, updatedAt: new Date("2026-11-03T09:00:00Z") });
    state.run = (q) => {
      if (q.table === "spaceNotes" && q.op === "update") return []; // version 3 no longer matches
      if (q.table === "spaceNotes") return [latest];
      if (q.table === "socialProfiles") return [{ id: OTHER, name: "Asha" }];
      return [];
    };
    const res = await note.PUT(req("PUT", "/n", { title: "Mine", body: "Mine too", version: 3 }), ps({ id: SPACE, noteId: NOTE }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("version_conflict");
    expect(body.message).toMatch(/Someone else saved this note/);
    const got = await (await note.GET(req("GET", "/n"), ps({ id: SPACE, noteId: NOTE }))).json();
    expect(body.latest).toEqual(got);
    expect(body.latest.version).toBe(5);
  });

  it("PUT needs a version", async () => {
    const res = await note.PUT(req("PUT", "/n", { title: "T", body: "" }), ps({ id: SPACE, noteId: NOTE }));
    expect(res.status).toBe(400);
  });

  it("only the note's creator or a moderator deletes it", async () => {
    state.run = (q) => (q.table === "spaceNotes" && q.op === "select" ? [noteRow({ createdBy: OTHER })] : []);
    expect((await note.DELETE(req("DELETE", "/n"), ps({ id: SPACE, noteId: NOTE }))).status).toBe(403);
    expect(state.queries.some((q) => q.op === "delete")).toBe(false);
    state.space = { ...member, myRole: "moderator", canModerate: true };
    expect((await note.DELETE(req("DELETE", "/n"), ps({ id: SPACE, noteId: NOTE }))).status).toBe(200);
    state.space = { ...member };
    state.run = (q) => (q.table === "spaceNotes" && q.op === "select" ? [noteRow({ createdBy: ME })] : []);
    expect((await note.DELETE(req("DELETE", "/n"), ps({ id: SPACE, noteId: NOTE }))).status).toBe(200);
  });

  it("create stores the Space and the author", async () => {
    state.run = (q) => (q.op === "insert" ? [{ id: NOTE, version: 1 }] : [{ n: 0 }]);
    const res = await notes.POST(req("POST", "/n", { title: "  Agenda ", body: "1." }), ps({ id: SPACE }));
    expect(await res.json()).toEqual({ ok: true, id: NOTE, version: 1 });
    expect(state.queries.find((q) => q.op === "insert")?.data).toMatchObject({ spaceId: SPACE, title: "Agenda", createdBy: ME, updatedBy: ME });
  });
});

describe("Space rooms", () => {
  it("presence needs consent in the body", async () => {
    expect((await presence.POST(req("POST", "/p", {}), ps({ id: SPACE, roomId: ROOM }))).status).toBe(400);
    expect((await presence.POST(req("POST", "/p", { consent: false }), ps({ id: SPACE, roomId: ROOM }))).status).toBe(400);
    expect(state.queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("people blocked either way are left out of who's here", async () => {
    const BLOCKED = "77777777-7777-4777-8777-777777777777";
    state.run = (q) => {
      if (q.table === "spaceRooms") return [roomRow()];
      if (q.table === "spaceRoomPresence") return [{ roomId: ROOM, userId: ME }, { roomId: ROOM, userId: OTHER }, { roomId: ROOM, userId: BLOCKED }];
      if (q.table === "userBlocks") return [{ blockerId: BLOCKED, blockedId: ME }];
      if (q.table === "socialProfiles") return [{ id: ME, name: "Me" }, { id: OTHER, name: "Asha" }];
      return [];
    };
    const res = await presence.POST(req("POST", "/p", { consent: true }), ps({ id: SPACE, roomId: ROOM }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room.present.map((x: { userId: string }) => x.userId)).toEqual([ME, OTHER]);
    expect(body.room.present.find((x: { isMe: boolean }) => x.isMe).name).toBe("Me");
    expect(state.queries.find((q) => q.op === "insert")?.data).toMatchObject({ roomId: ROOM, userId: ME });

    const list = await (await rooms.GET(req("GET", "/r"), ps({ id: SPACE }))).json();
    expect(list.items[0]).toMatchObject({ id: ROOM, present: 2 });
  });

  it("timer changes answer with server time and the synced end", async () => {
    state.run = (q) => {
      if (q.table === "spaceRooms" && q.op === "update") return [roomRow({ timerStatus: "running", durationSec: 600, endsAt: new Date(Date.now() + 600_000) })];
      if (q.table === "spaceRooms") return [roomRow()];
      return [];
    };
    const res = await room.PATCH(req("PATCH", "/r", { action: "start", minutes: 10 }), ps({ id: SPACE, roomId: ROOM }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room.timer.status).toBe("running");
    expect(Date.parse(body.room.timer.endsAt) - Date.parse(body.room.serverNow)).toBeGreaterThan(590_000);
    expect(state.queries.find((q) => q.op === "update")?.data).toMatchObject({ timerStatus: "running", durationSec: 600, updatedBy: ME });
  });

  it("a rule refusal is a plain 4xx, and nothing is saved", async () => {
    state.run = (q) => (q.table === "spaceRooms" ? [roomRow()] : []);
    const res = await room.PATCH(req("PATCH", "/r", { action: "pause" }), ps({ id: SPACE, roomId: ROOM }));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("The timer isn't running.");
    const bad = await room.PATCH(req("PATCH", "/r", { action: "media", url: "https://example.com/song.mp3" }), ps({ id: SPACE, roomId: ROOM }));
    expect(bad.status).toBe(400);
    expect(state.queries.some((q) => q.op === "update")).toBe(false);
  });

  it("listen rooms store only the cleaned link", async () => {
    state.run = (q) => (q.table === "spaceRooms" ? [roomRow({ kind: "listen" })] : []);
    await room.PATCH(req("PATCH", "/r", { action: "media", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=tracking" }), ps({ id: SPACE, roomId: ROOM }));
    expect(state.queries.find((q) => q.op === "update")?.data).toMatchObject({ mediaUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", mediaKind: "spotify" });
  });

  it("only the room's creator or a moderator deletes it", async () => {
    state.run = (q) => (q.table === "spaceRooms" && q.op === "select" ? [roomRow({ createdBy: OTHER })] : []);
    expect((await room.DELETE(req("DELETE", "/r"), ps({ id: SPACE, roomId: ROOM }))).status).toBe(403);
    state.space = { ...member, myRole: "owner", canModerate: true };
    expect((await room.DELETE(req("DELETE", "/r"), ps({ id: SPACE, roomId: ROOM }))).status).toBe(200);
  });
});

describe("Connect key lookup scoping", () => {
  const MATE = "88888888-8888-4888-8888-888888888888";
  const FRIEND = "99999999-9999-4999-8999-999999999999";
  const STRANGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const BLOCKED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const key = (c: string) => c.repeat(64);
  const owners: Record<string, string> = { [key("1")]: ME, [key("2")]: MATE, [key("3")]: FRIEND, [key("4")]: STRANGER, [key("5")]: BLOCKED };

  it("returns keys of yourself, Space mates and friends; never strangers or blocked people; never emails", async () => {
    state.run = (q) => {
      if (q.table === "connectKeys") return Object.entries(owners).map(([publicKey, userId]) => ({ publicKey, userId }));
      // Shared active membership of a non-anonymous Space (the "me" alias joined to "them").
      if (q.table === "me") return [{ userId: MATE }, { userId: BLOCKED }];
      if (q.table === "friendships") return [{ low: ME, high: FRIEND }];
      if (q.table === "userBlocks") return [{ blockerId: ME, blockedId: BLOCKED }];
      if (q.table === "socialProfiles") return [{ id: MATE, name: "Mate" }, { id: FRIEND, name: "Friend" }];
      return [];
    };
    const res = await resolve.POST(req("POST", "/k", { keys: Object.keys(owners) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((x: { userId: string }) => x.userId).sort();
    expect(ids).toEqual([ME, MATE, FRIEND].sort());
    expect(body.items.find((x: { userId: string }) => x.userId === ME).isMe).toBe(true);
    expect(body.items.find((x: { userId: string }) => x.userId === FRIEND).name).toBe("Friend");
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it("signed out is 401; malformed or too many keys are 400 before any lookup", async () => {
    state.signedIn = false;
    expect((await resolve.POST(req("POST", "/k", { keys: [key("2")] }))).status).toBe(401);
    state.signedIn = true;
    expect((await resolve.POST(req("POST", "/k", { keys: ["nothex"] }))).status).toBe(400);
    expect((await resolve.POST(req("POST", "/k", { keys: [] }))).status).toBe(400);
    expect((await resolve.POST(req("POST", "/k", { keys: Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, "0")) }))).status).toBe(400);
    expect(state.queries).toEqual([]);
  });

  it("GET lists only your own keys with what the app needs to prove a new one", async () => {
    state.run = (q) => (q.table === "connectKeys" ? [{ publicKey: key("1"), label: "Pixel", createdAt: new Date("2026-11-01T00:00:00Z") }] : []);
    const body = await (await keys.GET(req("GET", "/k"))).json();
    expect(body).toMatchObject({ account: ME, items: [{ publicKey: key("1"), label: "Pixel", createdAt: "2026-11-01T00:00:00.000Z" }] });
    expect("serverKey" in body).toBe(true);
  });

  it("registration without a valid proof is refused and stores nothing", async () => {
    const res = await keys.POST(req("POST", "/k", { publicKey: key("2"), proof: key("0"), label: "Phone" }));
    expect(res.status).toBe(400);
    expect(state.queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("registration with the app's proof is stored for the caller; someone else's key is 409", async () => {
    const { createHmac, createPublicKey, diffieHellman, generateKeyPairSync } = await import("node:crypto");
    const { serverKey } = await (await keys.GET(req("GET", "/k"))).json();
    const pair = generateKeyPairSync("x25519");
    const publicKey = Buffer.from(pair.publicKey.export({ format: "der", type: "spki" })).subarray(-32).toString("hex");
    const server = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(serverKey, "hex")]), format: "der", type: "spki" });
    const shared = diffieHellman({ privateKey: pair.privateKey, publicKey: server });
    const proof = createHmac("sha256", shared).update(`cowork-connect-key-v1|${ME}|${publicKey}`).digest("hex");

    state.queries = [];
    state.run = (q) => (q.op === "select" && q.table === "connectKeys" && state.queries.length === 1 ? [] : [{ n: 0 }]);
    const res = await keys.POST(req("POST", "/k", { publicKey: publicKey.toUpperCase(), proof, label: "Pixel" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.queries.find((q) => q.op === "insert")?.data).toEqual({ userId: ME, publicKey, label: "Pixel" });

    state.queries = [];
    state.run = (q) => (q.table === "connectKeys" ? [{ userId: OTHER }] : []);
    expect((await keys.POST(req("POST", "/k", { publicKey, proof, label: "" }))).status).toBe(409);
    expect(state.queries.some((q) => q.op === "insert")).toBe(false);
  });
});
