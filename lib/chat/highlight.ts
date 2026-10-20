/**
 * A small, dependency-free syntax tokenizer for chat code blocks. One left to
 * right pass per block; heuristic, not a parser. Invariant: joining the token
 * texts always gives back the input exactly, so nothing is ever lost or changed.
 */

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "literal" | "fn" | "prop" | "punct";
export type Token = { kind: TokenKind; text: string };

/** Longer blocks render plain to bound re-render cost while streaming. */
export const MAX_HIGHLIGHT_CHARS = 20_000;

type Spec = {
  line: string[];
  block?: [string, string][];
  quotes: string;
  triple?: boolean;
  keywords: Set<string>;
  literals: Set<string>;
  /** Case-insensitive keywords (SQL, Dockerfile). */
  ci?: boolean;
  /** Which identifiers count as keys: JSON strings before ':', YAML/CSS words before ':', INI/TOML words before '='. */
  keys?: "json" | "yaml" | "css" | "ini";
  /** HTML/XML: tag and attribute names; text between tags stays plain. */
  tags?: boolean;
  /** Identifiers may contain '-' (CSS, YAML, HTML attributes). */
  dash?: boolean;
  /** Rust: ' is a char literal only when it closes ('x'), otherwise a lifetime. */
  rustChar?: boolean;
};

const words = (s: string) => new Set(s.split(" "));

const C_LIKE = "if else for while do switch case break continue return default try catch finally throw new class extends implements interface enum import export package static public private protected void const struct typedef sizeof goto this super";
const JS_KW = words(
  "const let var function return if else for while do switch case break continue default try catch finally throw new delete typeof instanceof in of class extends super this import export from as async await yield static get set void with debugger",
);
const TS_KW = new Set([...JS_KW, ...words("interface type enum implements namespace declare readonly abstract private public protected keyof infer is satisfies module")]);
const JS_LIT = words("true false null undefined NaN Infinity");

const SPECS: Record<string, Spec> = {
  js: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", keywords: JS_KW, literals: JS_LIT },
  ts: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", keywords: TS_KW, literals: JS_LIT },
  python: {
    line: ["#"],
    quotes: "\"'",
    triple: true,
    keywords: words("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await match case"),
    literals: words("True False None self"),
  },
  bash: { line: ["#"], quotes: "\"'", keywords: words("if then else elif fi for while until do done case esac in function return export local readonly echo exit set unset source alias cd"), literals: words("true false") },
  powershell: { line: ["#"], block: [["<#", "#>"]], quotes: "\"'", keywords: words("function param if else elseif foreach for while do switch return try catch finally throw begin process end"), literals: words("$true $false $null"), ci: true },
  yaml: { line: ["#"], quotes: "\"'", keywords: new Set(), literals: words("true false null yes no on off ~"), keys: "yaml", dash: true },
  json: { line: ["//"], block: [["/*", "*/"]], quotes: '"', keywords: new Set(), literals: words("true false null"), keys: "json" },
  toml: { line: ["#"], quotes: "\"'", triple: true, keywords: new Set(), literals: words("true false"), keys: "ini", dash: true },
  ini: { line: [";", "#"], quotes: "\"'", keywords: new Set(), literals: words("true false yes no on off"), keys: "ini", dash: true },
  css: { line: [], block: [["/*", "*/"]], quotes: "\"'", keywords: words("@media @import @keyframes @font-face @supports @layer @apply !important"), literals: new Set(), keys: "css", dash: true },
  html: { line: [], block: [["<!--", "-->"]], quotes: "\"'", keywords: new Set(), literals: new Set(), tags: true, dash: true },
  sql: {
    line: ["--"],
    block: [["/*", "*/"]],
    quotes: "'\"",
    ci: true,
    keywords: words(
      "select from where and or not insert into values update set delete create table alter drop index primary key foreign references join left right inner outer full on as group by order having limit offset distinct union all case when then else end in is like between exists returning with default constraint unique view begin commit rollback asc desc cascade",
    ),
    literals: words("null true false"),
  },
  go: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", keywords: words("package import func return if else for range switch case default break continue go defer select chan map struct interface type var const fallthrough goto"), literals: words("true false nil iota") },
  rust: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: '"',
    rustChar: true,
    keywords: words("fn let mut const static struct enum impl trait pub use mod crate self super return if else match for while loop in break continue as where type unsafe async await move ref dyn"),
    literals: words("true false None Some Ok Err Self"),
  },
  c: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", keywords: words(`${C_LIKE} int char float double long short unsigned signed bool auto register extern union inline #include #define #ifdef #ifndef #endif #if #else #pragma`), literals: words("true false NULL") },
  cpp: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", keywords: words(`${C_LIKE} int char float double long short unsigned signed bool auto namespace using template typename virtual override const_cast static_cast dynamic_cast operator inline friend explicit noexcept constexpr #include #define #ifdef #ifndef #endif #pragma`), literals: words("true false nullptr NULL") },
  csharp: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", keywords: words(`${C_LIKE} using namespace var int string bool double float decimal object async await readonly override virtual abstract sealed partial internal get set in out ref is as foreach`), literals: words("true false null") },
  java: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", keywords: words(`${C_LIKE} int long double float boolean char byte short final abstract synchronized throws instanceof var record`), literals: words("true false null") },
  kotlin: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", triple: true, keywords: words("fun val var class object interface if else when for while do return break continue try catch finally throw import package is in as data sealed open override private public internal suspend companion"), literals: words("true false null this") },
  swift: { line: ["//"], block: [["/*", "*/"]], quotes: '"', triple: true, keywords: words("func let var class struct enum protocol extension if else guard switch case default for while repeat return break continue import in is as try catch throw throws async await init self public private internal static"), literals: words("true false nil") },
  scala: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", triple: true, keywords: words("def val var class object trait extends with if else match case for while yield return import package new try catch finally throw implicit lazy override sealed"), literals: words("true false null") },
  dart: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", triple: true, keywords: words("void var final const class extends implements with if else for while do switch case return break continue import export async await try catch finally throw new late required static"), literals: words("true false null this") },
  php: { line: ["//", "#"], block: [["/*", "*/"]], quotes: "\"'", keywords: words("function return if else elseif foreach for while do switch case break continue class extends implements new public private protected static use namespace echo try catch finally throw fn match"), literals: words("true false null TRUE FALSE NULL") },
  ruby: { line: ["#"], quotes: "\"'", keywords: words("def end class module if elsif else unless while until for in do return yield begin rescue ensure raise require include attr_accessor self then case when"), literals: words("true false nil") },
  lua: { line: ["--"], quotes: "\"'", keywords: words("function local end if then else elseif for while do repeat until return break in and or not"), literals: words("true false nil") },
  r: { line: ["#"], quotes: "\"'", keywords: words("function if else for while repeat return next break in library"), literals: words("TRUE FALSE NULL NA Inf NaN") },
  graphql: { line: ["#"], quotes: '"', triple: true, keywords: words("query mutation subscription fragment on type input enum interface union schema scalar extend implements directive"), literals: words("true false null") },
  dockerfile: { line: ["#"], quotes: "\"'", ci: true, keywords: words("from run cmd copy add env arg workdir expose entrypoint volume user label healthcheck shell onbuild stopsignal as"), literals: new Set() },
};
SPECS.xml = SPECS.html!;

const ALIASES: Record<string, string> = {
  js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js", node: "js",
  ts: "ts", typescript: "ts", tsx: "ts", mts: "ts", cts: "ts",
  py: "python", python: "python", python3: "python",
  sh: "bash", bash: "bash", zsh: "bash", shell: "bash", console: "bash", shellscript: "bash",
  yml: "yaml", yaml: "yaml",
  rs: "rust", rust: "rust",
  go: "go", golang: "go",
  "c++": "cpp", cpp: "cpp", cc: "cpp", hpp: "cpp", cxx: "cpp",
  cs: "csharp", csharp: "csharp", "c#": "csharp",
  kt: "kotlin", kts: "kotlin", kotlin: "kotlin",
  ps1: "powershell", powershell: "powershell", pwsh: "powershell",
  html: "html", htm: "html", vue: "html", svelte: "html",
  xml: "xml", svg: "xml",
  css: "css", scss: "css", less: "css",
  sql: "sql", psql: "sql", mysql: "sql", postgres: "sql", postgresql: "sql", sqlite: "sql",
  json: "json", jsonc: "json", json5: "json",
  toml: "toml", ini: "ini", cfg: "ini", conf: "ini", properties: "ini",
  graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", docker: "dockerfile",
  lua: "lua", r: "r", dart: "dart", scala: "scala", swift: "swift", php: "php",
  rb: "ruby", ruby: "ruby", java: "java", c: "c", h: "c",
}; // prettier-ignore

/** Fence language to a tokenizer id, or null when it should stay plain (md, text, csv, diff, unknown). */
export function normalizeLang(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return ALIASES[lang.trim().toLowerCase()] ?? null;
}

const LABELS: Record<string, string> = {
  js: "JavaScript", ts: "TypeScript", python: "Python", bash: "Shell", powershell: "PowerShell", yaml: "YAML", json: "JSON",
  toml: "TOML", ini: "INI", css: "CSS", html: "HTML", xml: "XML", sql: "SQL", go: "Go", rust: "Rust", c: "C", cpp: "C++",
  csharp: "C#", java: "Java", kotlin: "Kotlin", swift: "Swift", scala: "Scala", dart: "Dart", php: "PHP", ruby: "Ruby",
  lua: "Lua", r: "R", graphql: "GraphQL", dockerfile: "Dockerfile",
  md: "Markdown", markdown: "Markdown", text: "Text", txt: "Text", plaintext: "Text", csv: "CSV", diff: "Diff",
}; // prettier-ignore

/** Human label for the code block header, or null when there is no language. */
export function langLabel(lang: string | null | undefined): string | null {
  const raw = lang?.trim();
  if (!raw) return null;
  const id = normalizeLang(raw);
  if (raw.toLowerCase() === "jsx") return "JSX";
  if (raw.toLowerCase() === "tsx") return "TSX";
  return (id && LABELS[id]) || LABELS[raw.toLowerCase()] || raw.slice(0, 24);
}

const NUM = /(0x[\da-f_]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)[a-z]*/iy;
const IDENT = /[A-Za-z_$][\w$]*/y;
const IDENT_DASH = /[A-Za-z_$@!#][\w$-]*/y;
const RUST_CHAR = /'(\\.|[^\\'\n])'/y;
const PUNCT = "{}[]()<>=;,.:+-*/%!&|^~?@#";
const ID_CHAR = /[\w$]/;

function nextNonSpace(code: string, from: number): string {
  for (let k = from; k < code.length; k++) {
    const c = code[k]!;
    if (c !== " " && c !== "\t") return c;
  }
  return "";
}

function prevNonSpace(code: string, from: number): string {
  for (let k = from - 1; k >= 0; k--) {
    const c = code[k]!;
    if (c !== " " && c !== "\t") return c;
  }
  return "";
}

export function tokenize(code: string, lang: string | null | undefined): Token[] {
  const id = normalizeLang(lang);
  const spec = id ? SPECS[id] : undefined;
  if (!code) return [];
  if (!spec) return [{ kind: "plain", text: code }];

  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  const n = code.length;
  let i = 0;
  let inTag = false;

  outer: while (i < n) {
    const ch = code[i]!;

    if (spec.block) {
      for (const [open, close] of spec.block) {
        if (code.startsWith(open, i)) {
          const end = code.indexOf(close, i + open.length);
          const j = end < 0 ? n : end + close.length;
          push("comment", code.slice(i, j));
          i = j;
          continue outer;
        }
      }
    }

    // HTML/XML: outside a tag everything is text.
    if (spec.tags && !inTag) {
      if (ch === "<" && /[A-Za-z/!?]/.test(code[i + 1] ?? "")) {
        inTag = true;
        push("punct", code[i + 1] === "/" ? "</" : "<");
        i += code[i + 1] === "/" ? 2 : 1;
        continue;
      }
      const lt = code.indexOf("<", i + 1);
      const j = lt < 0 ? n : lt;
      push("plain", code.slice(i, j));
      i = j;
      continue;
    }

    for (const l of spec.line) {
      // '#' only starts a comment at a word boundary (keeps `${#arr}` and `a#b` intact).
      if (code.startsWith(l, i) && (l !== "#" || i === 0 || /\s/.test(code[i - 1]!))) {
        const end = code.indexOf("\n", i);
        const j = end < 0 ? n : end;
        push("comment", code.slice(i, j));
        i = j;
        continue outer;
      }
    }

    if (spec.triple) {
      for (const q of ['"""', "'''"]) {
        if (code.startsWith(q, i)) {
          const end = code.indexOf(q, i + 3);
          const j = end < 0 ? n : end + 3;
          push("string", code.slice(i, j));
          i = j;
          continue outer;
        }
      }
    }

    if (ch === "'" && spec.rustChar) {
      RUST_CHAR.lastIndex = i;
      const m = RUST_CHAR.exec(code);
      if (m) {
        push("string", m[0]);
        i += m[0].length;
      } else {
        push("punct", ch);
        i++;
      }
      continue;
    }

    if (spec.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n) {
        const c = code[j]!;
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === ch) {
          j++;
          break;
        }
        // Unterminated ' and " stop at the line end so a streaming block doesn't colour the rest.
        if (c === "\n" && ch !== "`") break;
        j++;
      }
      j = Math.min(j, n);
      const kind = spec.keys === "json" && nextNonSpace(code, j) === ":" ? "prop" : "string";
      push(kind, code.slice(i, j));
      i = j;
      continue;
    }

    if (/\d/.test(ch) && (i === 0 || !ID_CHAR.test(code[i - 1]!))) {
      NUM.lastIndex = i;
      const m = NUM.exec(code);
      if (m) {
        push("number", m[0]);
        i += m[0].length;
        continue;
      }
    }

    const re = spec.dash ? IDENT_DASH : IDENT;
    re.lastIndex = i;
    const m = re.exec(code);
    if (m && m[0] !== "-") {
      const w = m[0];
      const key = spec.ci ? w.toLowerCase() : w;
      const after = nextNonSpace(code, i + w.length);
      let kind: TokenKind = "plain";
      if (spec.tags) {
        const before = prevNonSpace(code, i);
        kind = before === "<" || before === "/" ? "keyword" : "prop";
      } else if (spec.keywords.has(key)) kind = "keyword";
      else if (spec.literals.has(key) || spec.literals.has(w)) kind = "literal";
      else if ((spec.keys === "yaml" || spec.keys === "css") && after === ":") kind = "prop";
      else if (spec.keys === "ini" && after === "=") kind = "prop";
      else if (after === "(" && !spec.keys) kind = "fn";
      push(kind, w);
      i += w.length;
      continue;
    }

    if (PUNCT.includes(ch)) {
      if (spec.tags && ch === ">") inTag = false;
      push("punct", ch);
      i++;
      continue;
    }

    push("plain", ch);
    i++;
  }
  return out;
}

/** The parts of a hast node we read (hast types are not a direct dependency). */
type HastLike = { type?: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastLike[] };

function textOf(node: HastLike): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** Reads the code and fence language from react-markdown's `pre` node. */
export function codeFromHast(node: unknown): { code: string; lang?: string } | null {
  const pre = node as HastLike | null | undefined;
  const codeEl = pre?.children?.find((c) => c.type === "element" && c.tagName === "code");
  if (!codeEl) return null;
  const cls = codeEl.properties?.className;
  const list = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(/\s+/) : [];
  const lang = list.find((c) => c.startsWith("language-"))?.slice("language-".length) || undefined;
  const raw = textOf(codeEl);
  return { code: raw.endsWith("\n") ? raw.slice(0, -1) : raw, lang };
}
