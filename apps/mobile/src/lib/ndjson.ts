/**
 * Incremental newline-delimited JSON parser for the chat stream. Pure, so it is unit tested.
 * Feed it decoded text chunks in order; it returns every complete line parsed as JSON and keeps the
 * unfinished tail for the next chunk. Malformed lines are skipped, never thrown.
 */
export class NdjsonParser<T = unknown> {
  private buffer = "";

  push(chunk: string): T[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((l) => parseLine<T>(l));
  }

  /** Call once the stream ends: parses a final line that had no trailing newline. */
  flush(): T[] {
    const rest = this.buffer;
    this.buffer = "";
    return parseLine<T>(rest);
  }
}

function parseLine<T>(line: string): T[] {
  const s = line.trim();
  if (!s) return [];
  try {
    return [JSON.parse(s) as T];
  } catch {
    return [];
  }
}
