import { redactSecrets } from "@/lib/security/sanitize";

/**
 * Pure helpers for the owner's memory: cue detection, a narrow heuristic
 * extractor, secret and grounding gates, dedupe and keyword (IDF) ranking.
 * No I/O here so every rule is unit-tested.
 */

export const MEMORY_KINDS = ["preference", "fact", "person", "project"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

const STOP = new Set(
  (
    "i me my mine myself you your yours we us our ours he him his she her it its they them their " +
    "a an the this that these those there here " +
    "be is am are was were been being do does did done have has had having will would shall should can could may might must " +
    "to of in on at for with by from as into about and or but if so than then too very just also not no " +
    "what which who whom when where why how all any some each every " +
    "please remember note thanks thank ok okay yes hi hello hey dont don't forget keep mind going forward now"
  ).split(" "),
);

/** Normalise curly quotes so the regexes below match what phones type. */
function straight(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
}

/** Lowercased content words with a light plural stem. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const words = straight(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/);
  for (const raw of words) {
    let w = raw.replace(/^['-]+|['-]+$/g, "");
    if (w.endsWith("'s")) w = w.slice(0, -2);
    if (w.length < 2 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

/** Lowercase, punctuation removed, whitespace collapsed: for exact-duplicate checks. */
export function normalizeMemory(text: string): string {
  return straight(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CUE =
  /\b(remember(?!\s+to\b)|don't forget (?:that|my)|keep in mind|for future reference|from now on|going forward|i(?:\s+(?:always|never|usually|prefer|would prefer|would rather|hate|dislike|don't like|can't stand)|'d (?:prefer|rather))\b|i'?m (?:allergic|vegetarian|vegan|based in)\b|i am (?:allergic|vegetarian|vegan|based in)\b|i work (?:at|for|as)\b|i live in\b|call me\b)/i;

/** True when the owner's own message reads like something to remember. */
export function hasMemoryCue(message: string): boolean {
  return CUE.test(straight(message));
}

function firstSentence(text: string): string {
  const cut = text.split(/[.!?](?:\s|$)/)[0] ?? "";
  return cut
    .slice(0, 300)
    .trim()
    .replace(/[\s,;:.!?-]+$/, "");
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

const NOT_A_NAME = /^(?:back|later|tomorrow|when|at|if|after|before|on|in|now|today|tonight|asap|please|anytime|again|soon|whenever)$/i;

/** Narrow deterministic extractor, used only when the planner model is unavailable. */
export function heuristicMemories(message: string): { content: string; kind: MemoryKind }[] {
  const m = straight(message);
  const out: { content: string; kind: MemoryKind }[] = [];
  const push = (content: string, kind: MemoryKind) => {
    const c = capitalise(firstSentence(content));
    if (c.length >= 3 && !out.some((o) => normalizeMemory(o.content) === normalizeMemory(c))) out.push({ content: c, kind });
  };

  const fact = /\b(?:remember(?:\s+that|\s*:)|don't forget that)\s+(.+)/i.exec(m);
  if (fact) push(fact[1]!, "fact");
  else {
    const mine = /\b(?:remember|don't forget)\s+(my\s+.+)/i.exec(m);
    if (mine) push(mine[1]!, "fact");
  }

  const pref = /\bI(?:\s+prefer|'d\s+(?:prefer|rather)|\s+would\s+(?:prefer|rather))\b.+/i.exec(m);
  if (pref) push(pref[0], "preference");

  const fromNow = /\bfrom now on,?\s+(.+)/i.exec(m);
  if (fromNow) push(fromNow[1]!, "preference");

  const call = /\bcall me\s+([\p{L}][\p{L}'-]*)(?=\s*(?:[,.!?]|$))/iu.exec(m);
  if (call && !NOT_A_NAME.test(call[1]!)) push(`Call me ${call[1]}`, "preference");

  return out.slice(0, 3);
}

const SENSITIVE_WORDS =
  /\b(password|passcode|passphrase|pin code|otp|one[- ]time code|2fa code|api[ _-]?key|secret key|access token|private key|seed phrase|recovery (?:code|phrase)|cvv|security code|ssn|social security|routing number|account number|card number|iban)\b/i;

/** Passwords, codes, account or card numbers and key-like tokens are never saved. */
export function looksSensitive(text: string): boolean {
  if (SENSITIVE_WORDS.test(text)) return true;
  if (/(?:\d[ -]?){13,}/.test(text)) return true;
  if (redactSecrets(text) !== text) return true;
  return /\b[A-Za-z0-9_-]{32,}\b/.test(text);
}

/** At least 60% of the memory's words must come from the owner's own message. */
export function groundedIn(message: string, content: string): boolean {
  const c = tokens(content);
  if (c.size === 0) return false;
  const m = tokens(message);
  let hit = 0;
  for (const t of c) if (m.has(t)) hit++;
  return hit / c.size >= 0.6;
}

export type Duplicate = { relation: "same" | "refines"; id: string; content: string };

/** Find an existing memory that already says this ("same") or that the candidate adds detail to ("refines"). */
export function findDuplicate(existing: { id: string; content: string }[], candidate: string): Duplicate | null {
  const norm = normalizeMemory(candidate);
  const a = tokens(candidate);
  let best: (Duplicate & { score: number }) | null = null;
  for (const row of existing) {
    if (normalizeMemory(row.content) === norm) return { relation: "same", id: row.id, content: row.content };
    const b = tokens(row.content);
    if (a.size === 0 || b.size === 0) continue;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    const jaccard = inter / union;
    let relation: Duplicate["relation"] | null = null;
    if (inter === b.size && a.size > b.size && inter >= 2 && jaccard >= 0.5) relation = "refines";
    else if (inter === a.size && jaccard >= 0.5) relation = "same";
    else if (jaccard >= 0.8) relation = "same";
    if (relation && (!best || jaccard > best.score)) best = { relation, id: row.id, content: row.content, score: jaccard };
  }
  return best ? { relation: best.relation, id: best.id, content: best.content } : null;
}

/**
 * Keyword-overlap ranking. Each shared token scores a BM25-style IDF, so a word
 * in every memory (like "prefer") adds almost nothing. The best matches are
 * topped up with the newest few, then shown newest first.
 */
export function rankMemories<T extends { id: string; content: string; createdAt: Date }>(rows: T[], text: string, opts: { max?: number; fill?: number; matchLimit?: number } = {}): T[] {
  const max = opts.max ?? 15;
  const fill = opts.fill ?? 5;
  const matchLimit = opts.matchLimit ?? 10;
  const newest = (x: T, y: T) => y.createdAt.getTime() - x.createdAt.getTime();
  const q = tokens(text);
  const byAge = [...rows].sort(newest);
  if (q.size === 0) return byAge.slice(0, Math.min(fill, max));

  const rowTokens = new Map(rows.map((r) => [r.id, tokens(r.content)]));
  const df = new Map<string, number>();
  for (const set of rowTokens.values()) for (const t of set) if (q.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = rows.length;
  const idf = (t: string) => {
    const d = df.get(t) ?? 0;
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  };

  const scored = rows
    .map((r) => {
      let score = 0;
      for (const t of rowTokens.get(r.id)!) if (q.has(t)) score += idf(t);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || newest(x.r, y.r))
    .slice(0, matchLimit)
    .map((x) => x.r);
  const picked = new Set(scored.map((r) => r.id));
  const recent = byAge.filter((r) => !picked.has(r.id)).slice(0, fill);
  return [...scored, ...recent].slice(0, max).sort(newest);
}
