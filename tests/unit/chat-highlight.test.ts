import { describe, expect, it } from "vitest";
import { codeFromHast, langLabel, normalizeLang, tokenize, type Token } from "@/lib/chat/highlight";

const join = (t: Token[]) => t.map((x) => x.text).join("");
const kindOf = (t: Token[], text: string) => t.find((x) => x.text === text)?.kind;

const SAMPLES: Record<string, string> = {
  ts: 'import { a } from "./a";\nexport function f<T>(x: T): T {\n  // note\n  const s = `hi ${x}`;\n  return arr[1] ?? x; /* end */\n}\n',
  python: 'def f(x):\n    """doc"""\n    # c\n    return {"a": True, \'b\': None}\n',
  sql: "SELECT id, name FROM users WHERE id = 1 -- c\n/* block */ order by name;",
  json: '{"a": true, "b": null, "c": 1.5, "d": [1, "x"]}',
  go: 'package main\nfunc main() { fmt.Println("hi", 0x1F) }',
  rust: "fn f<'a>(x: &'a str) -> char { let c = 'x'; c }",
  bash: 'export A="b" # c\necho ${#arr[@]} $HOME',
  yaml: "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest # c\n",
  css: ".a:hover { color: #fff; margin: 0 4px !important; } /* c */",
  html: '<!-- c --><div class="a" id=x>Don\'t <b>stop</b></div>',
};

describe("tokenize", () => {
  it("round-trips every sample exactly", () => {
    for (const [lang, code] of Object.entries(SAMPLES)) expect(join(tokenize(code, lang)), lang).toBe(code);
    expect(join(tokenize("anything at all", "nope"))).toBe("anything at all");
    expect(tokenize("", "ts")).toEqual([]);
  });

  it("stops an unterminated quote at the line end", () => {
    const t = tokenize('const s = "abc\nconst y = 1', "ts");
    expect(join(t)).toBe('const s = "abc\nconst y = 1');
    expect(t.find((x) => x.kind === "string")?.text).toBe('"abc');
    expect(t.filter((x) => x.kind === "keyword").map((x) => x.text.trim())).toEqual(["const", "const"]);
  });

  it("runs an open block comment and an open template to the end", () => {
    const c = tokenize("a /* open\nstill", "ts");
    expect(c[c.length - 1]).toEqual({ kind: "comment", text: "/* open\nstill" });
    const s = tokenize("x = `open\nmore", "js");
    expect(s[s.length - 1]).toEqual({ kind: "string", text: "`open\nmore" });
  });

  it("marks TS keywords, strings, comments, calls and numbers", () => {
    const t = tokenize('const x = "a"; // hi', "ts");
    expect(kindOf(t, "const")).toBe("keyword");
    expect(kindOf(t, '"a"')).toBe("string");
    expect(kindOf(t, "// hi")).toBe("comment");
    const f = tokenize("foo(1)", "ts");
    expect(kindOf(f, "foo")).toBe("fn");
    expect(kindOf(f, "1")).toBe("number");
  });

  it("handles Python", () => {
    const t = tokenize('def f():\n    """doc"""\n    # c\n    return True or None', "py");
    expect(kindOf(t, "def")).toBe("keyword");
    expect(kindOf(t, "f")).toBe("fn");
    expect(kindOf(t, '"""doc"""')).toBe("string");
    expect(kindOf(t, "# c")).toBe("comment");
    expect(kindOf(t, "True")).toBe("literal");
    expect(kindOf(t, "None")).toBe("literal");
  });

  it("matches SQL keywords case-insensitively", () => {
    const t = tokenize("select * FROM t -- c", "sql");
    expect(kindOf(t, "select")).toBe("keyword");
    expect(kindOf(t, "FROM")).toBe("keyword");
    expect(kindOf(t, "-- c")).toBe("comment");
  });

  it("marks JSON keys, literals and numbers", () => {
    const t = tokenize('{"a": true, "b": null, "c": 1.5}', "json");
    expect(kindOf(t, '"a"')).toBe("prop");
    expect(kindOf(t, '"c"')).toBe("prop");
    expect(kindOf(t, "true")).toBe("literal");
    expect(kindOf(t, "null")).toBe("literal");
    expect(kindOf(t, "1.5")).toBe("number");
  });

  it("tells Rust lifetimes from char literals", () => {
    const t = tokenize("fn f<'a>(x: &'a str) { let c = 'x'; }", "rust");
    expect(t.some((x) => x.kind === "string" && x.text.startsWith("'a"))).toBe(false);
    expect(kindOf(t, "'x'")).toBe("string");
  });

  it("keeps index expressions intact", () => {
    const t = tokenize("arr[1]", "ts");
    expect(join(t)).toBe("arr[1]");
    expect(t.map((x) => x.kind)).toEqual(["plain", "punct", "number", "punct"]);
  });

  it("returns one plain token for unknown languages", () => {
    expect(tokenize("hello [1] world", "text")).toEqual([{ kind: "plain", text: "hello [1] world" }]);
  });
});

describe("language names", () => {
  it("normalizes aliases", () => {
    expect(normalizeLang("typescript")).toBe("ts");
    expect(normalizeLang("py")).toBe("python");
    expect(normalizeLang("sh")).toBe("bash");
    expect(normalizeLang("yml")).toBe("yaml");
    expect(normalizeLang("C++")).toBe("cpp");
    expect(normalizeLang("md")).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });
  it("labels", () => {
    expect(langLabel("ts")).toBe("TypeScript");
    expect(langLabel("")).toBeNull();
    expect(langLabel("brainfuck")).toBe("brainfuck");
  });
});

describe("codeFromHast", () => {
  it("reads code and language from a pre node", () => {
    const node = { type: "element", tagName: "pre", children: [{ type: "element", tagName: "code", properties: { className: ["language-ts"] }, children: [{ type: "text", value: "let a = 1\n" }] }] };
    expect(codeFromHast(node)).toEqual({ code: "let a = 1", lang: "ts" });
  });
  it("returns null without a code child", () => {
    expect(codeFromHast({ type: "element", tagName: "pre", children: [{ type: "text", value: "x" }] })).toBeNull();
  });
  it("leaves lang undefined without a class", () => {
    expect(codeFromHast({ type: "element", tagName: "pre", children: [{ type: "element", tagName: "code", children: [{ type: "text", value: "x" }] }] })?.lang).toBeUndefined();
  });
});
