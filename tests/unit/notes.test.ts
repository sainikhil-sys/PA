import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { normalizeTags, normalizeBookmarkUrl, searchTerms, noteIndexText, plainExcerpt, hostOf } = await import("@/lib/notes/text");
const { parseLinkMeta } = await import("@/lib/notes/meta");
const { heuristicPlan } = await import("@/lib/agent/plan");

describe("normalizeTags", () => {
  it("splits, strips #, lowercases, de-dupes and drops invalid tags", () => {
    expect(normalizeTags(" #Pricing, ideas ,IDEAS,, bad tag!")).toEqual(["pricing", "ideas", "bad"]);
    expect(normalizeTags(["#Q3", "q3", "Road-map", "snake_case"])).toEqual(["q3", "road-map", "snake_case"]);
  });
  it("drops tags over 32 chars or starting with a symbol, and caps at 12", () => {
    expect(normalizeTags(["a".repeat(32), "b".repeat(33), "-x", "_y"])).toEqual(["a".repeat(32)]);
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(12);
  });
  it("keeps non-latin letters", () => {
    expect(normalizeTags("café, 日本")).toEqual(["café", "日本"]);
  });
});

describe("normalizeBookmarkUrl", () => {
  it("adds https to a bare host and keeps http", () => {
    expect(normalizeBookmarkUrl("example.com/a")).toBe("https://example.com/a");
    expect(normalizeBookmarkUrl("http://example.com/")).toBe("http://example.com/");
  });
  it("rejects anything that isn't a plain http(s) URL", () => {
    for (const bad of ["javascript:alert(1)", "ftp://x", "mailto:a@b.c", "https://user:pass@host.com", "not a url", "", "data:text/html,hi"]) {
      expect(normalizeBookmarkUrl(bad), bad).toBeNull();
    }
  });
  it("strips tracking params and keeps the rest", () => {
    expect(normalizeBookmarkUrl("https://x.com/p?id=1&utm_source=n")).toBe("https://x.com/p?id=1");
    expect(normalizeBookmarkUrl("https://x.com/p?utm_campaign=a&fbclid=b&gclid=c&q=2")).toBe("https://x.com/p?q=2");
  });
  it("hostOf drops www", () => {
    expect(hostOf("https://www.example.com/x")).toBe("example.com");
  });
});

describe("searchTerms", () => {
  it("wraps each word, max 6, and escapes LIKE wildcards", () => {
    expect(searchTerms("  pricing   page ")).toEqual(["%pricing%", "%page%"]);
    expect(searchTerms("a b c d e f g h")).toHaveLength(6);
    expect(searchTerms("50%_off")).toEqual(["%50\\%\\_off%"]);
    expect(searchTerms("back\\slash")).toEqual(["%back\\\\slash%"]);
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("parseLinkMeta", () => {
  const url = "https://www.example.com/post";
  it("prefers og:title over <title>", () => {
    const html = `<html><head><title>Plain</title><meta property="og:title" content="OG title"></head><body></body></html>`;
    expect(parseLinkMeta(html, url).title).toBe("OG title");
  });
  it("falls back to <title>, then the hostname", () => {
    expect(parseLinkMeta("<head><title> Just  title </title></head>", url).title).toBe("Just title");
    expect(parseLinkMeta("<head></head>", url)).toEqual({ title: "example.com", description: null });
  });
  it("reads the description in either attribute order and quote style", () => {
    expect(parseLinkMeta(`<head><meta content="First" name="description"></head>`, url).description).toBe("First");
    expect(parseLinkMeta(`<head><meta name='description' content='Single quoted'></head>`, url).description).toBe("Single quoted");
  });
  it("uses og:description when there is no meta description", () => {
    expect(parseLinkMeta(`<head><meta property="og:description" content="From OG"></head>`, url).description).toBe("From OG");
  });
  it("decodes entities and strips tags and invisible characters", () => {
    const html = `<head><title>A &amp; B &#39;x&#x27; &#8217;s</title><meta name="description" content="Hi&#8203; &lt;b&gt;there&lt;/b&gt;​"></head>`;
    const meta = parseLinkMeta(html, url);
    expect(meta.title).toBe("A & B 'x' ’s");
    expect(meta.description).toBe("Hi there");
  });
  it("caps lengths", () => {
    const html = `<head><title>${"t".repeat(400)}</title><meta name="description" content="${"d".repeat(900)}"></head>`;
    const meta = parseLinkMeta(html, url);
    expect(meta.title.length).toBe(200);
    expect(meta.description!.length).toBe(500);
  });
  it("ignores a <title> inside <script>", () => {
    const html = `<head><script>document.write("<title>Injected</title>")</script></head>`;
    expect(parseLinkMeta(html, url).title).toBe("example.com");
  });
});

describe("noteIndexText", () => {
  const base = { title: "T", content: "", url: null, linkDescription: null, tags: [] as string[] };
  it("includes link, description and tags only when present", () => {
    const text = noteIndexText({ ...base, content: "Body", url: "https://x.com", linkDescription: "Desc", tags: ["a", "b"] });
    expect(text).toBe("Link: https://x.com\n\nPage description (from the web): Desc\n\nTags: #a #b\n\nBody");
    expect(noteIndexText({ ...base, content: "Only body" })).toBe("Only body");
  });
  it("falls back to the title and is deterministic", () => {
    expect(noteIndexText(base)).toBe("T");
    const n = { ...base, content: "x", tags: ["q"] };
    expect(noteIndexText(n)).toBe(noteIndexText({ ...n }));
  });
});

describe("plainExcerpt", () => {
  it("strips markdown, images and code", () => {
    expect(plainExcerpt("# Title\n**bold** [link](https://x.com) ![img](y.png)\n```js\ncode\n```")).toBe("Title bold link");
    expect(plainExcerpt("keep snake_case and _em_")).toBe("keep snake_case and em");
  });
  it("truncates with an ellipsis", () => {
    const out = plainExcerpt("word ".repeat(200), 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("planner heuristics", () => {
  it("routes bookmark questions to knowledge", () => {
    expect(heuristicPlan("what was that bookmark about pricing").sources).toContain("knowledge");
  });
  it("still proposes add_note", () => {
    expect(heuristicPlan("save a note: call the bank").actions[0]?.kind).toBe("add_note");
  });
});
