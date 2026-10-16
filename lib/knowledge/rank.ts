/** Pure helpers for retrieval (unit tested). */

/** Reciprocal Rank Fusion: merge ranked lists without needing comparable scores. */
export function reciprocalRankFusion<T extends { id: string }>(lists: T[][], k = 60): (T & { rrf: number })[] {
  const scores = new Map<string, { item: T; rrf: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const prev = scores.get(item.id);
      const add = 1 / (k + rank + 1);
      if (prev) prev.rrf += add;
      else scores.set(item.id, { item, rrf: add });
    });
  }
  return [...scores.values()].sort((a, b) => b.rrf - a.rrf).map(({ item, rrf }) => ({ ...item, rrf }));
}

/**
 * Split text into overlapping chunks on paragraph/sentence boundaries.
 * ~1200 chars with 150 overlap suits small open embedding models.
 */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      const cut = para > size * 0.5 ? para : sentence > size * 0.5 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Citations must only reference retrieved sources: drop any [n] the model invented. */
export function stripInvalidCitations(text: string, validCount: number): string {
  return text.replace(/\[(\d{1,2})\]/g, (m, n: string) => (Number(n) >= 1 && Number(n) <= validCount ? m : ""));
}
