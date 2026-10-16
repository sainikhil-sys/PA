import { describe, expect, it } from "vitest";
import { buildReplyMime, extractBody, parseFrom } from "@/lib/integrations/mime";
import { chunkText, reciprocalRankFusion, stripInvalidCitations } from "@/lib/knowledge/rank";
import { dedupeItems, normalizeUrl, parseFeed, parseFeedConfig } from "@/lib/news/parse";
import { inQuietHours, localDayBounds } from "@/lib/time";
import { parseConfirmation, spokenSummary, toSpeakable } from "@/lib/voice/speech-text";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Big story &amp; more</title><link>https://ex.com/a?utm_source=x&amp;id=1</link><description><![CDATA[<p>Short <b>summary</b> here.</p>]]></description><pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>No link</title></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom entry</title><link rel="alternate" href="https://ex.org/b"/><summary>Atom summary</summary><updated>2026-10-14T09:00:00Z</updated></entry></feed>`;

describe("news feeds", () => {
  const src = { name: "Ex", url: "https://ex.com/rss", category: "world" };
  it("parses RSS into short metadata, never full articles", () => {
    const [item, ...rest] = parseFeed(RSS, src);
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({ title: "Big story & more", url: "https://ex.com/a?id=1", summary: "Short summary here.", sourceName: "Ex" });
    expect(item!.summary.length).toBeLessThanOrEqual(200);
  });
  it("parses Atom", () => {
    expect(parseFeed(ATOM, src)[0]).toMatchObject({ title: "Atom entry", url: "https://ex.org/b", summary: "Atom summary" });
  });
  it("dedupes by URL and title", () => {
    const a = { url: "https://x/1", title: "Same Title!", summary: "", publishedAt: new Date(2), sourceName: "A", category: "world" };
    expect(dedupeItems([a, { ...a, url: "https://y/2", title: "same title" }, { ...a, url: "https://x/1", title: "Other" }])).toHaveLength(1);
  });
  it("normalizes tracking params and reads env config", () => {
    expect(normalizeUrl("https://a.com/p?utm_campaign=z&q=1#top")).toBe("https://a.com/p?q=1");
    expect(parseFeedConfig("My Feed|https://f.com/rss|tech;bad|http://x|y")).toEqual([{ name: "My Feed", url: "https://f.com/rss", category: "tech" }]);
  });
});

describe("retrieval", () => {
  it("fuses ranked lists so items found by both rank first", () => {
    const r = reciprocalRankFusion([[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]]);
    expect(r[0]!.id).toBe("b");
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
  });
  it("chunks with overlap and keeps short texts whole", () => {
    expect(chunkText("short")).toEqual(["short"]);
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(long, 300, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
  });
  it("removes citations the model invented", () => {
    expect(stripInvalidCitations("Yes [1] and [7].", 2)).toBe("Yes [1] and .");
  });
});

describe("gmail mime", () => {
  it("prevents header injection in reply drafts", () => {
    const mime = buildReplyMime({ to: "a@b.com\r\nBcc: evil@x.com", subject: "Hi\nBcc: evil@x.com", body: "Body" });
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toContain("Subject: Re: Hi Bcc: evil@x.com");
  });
  it("parses From headers and prefers text/plain bodies", () => {
    expect(parseFrom('"Anita K" <Anita@Acme.com>')).toEqual({ name: "Anita K", email: "anita@acme.com" });
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    expect(extractBody({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64("<p>H</p>") } }, { mimeType: "text/plain", body: { data: b64("Plain") } }] })).toBe("Plain");
  });
});

describe("time", () => {
  it("handles overnight quiet hours", () => {
    expect(inQuietHours("23:30", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("06:59", "22:00", "07:00")).toBe(true);
    expect(inQuietHours("12:00", "22:00", "07:00")).toBe(false);
    expect(inQuietHours("12:00", null, null)).toBe(false);
  });
  it("computes local day bounds across timezones", () => {
    const b = localDayBounds("America/New_York", 0, new Date("2026-10-14T03:00:00Z")); // still Oct 13 in NY
    expect(b.date).toBe("2026-10-13");
    expect(b.start.toISOString()).toBe("2026-10-13T04:00:00.000Z");
  });
});

describe("voice", () => {
  it("makes markdown speakable and short", () => {
    expect(toSpeakable("**Hi** [1] see [docs](https://x)\n- one")).toBe("Hi see docs one");
    expect(spokenSummary("First. Second! Third? Fourth.").text).toBe("First. Second!");
  });
  it("understands spoken confirmations", () => {
    expect(parseConfirmation("Yes please")).toBe("yes");
    expect(parseConfirmation("no, cancel that")).toBe("no");
    expect(parseConfirmation("what?")).toBeNull();
  });
});
