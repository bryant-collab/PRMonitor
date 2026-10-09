import type { Readable } from "node:stream";

// Bound bytes before decoding/concatenating. readline would first buffer a
// complete line, allowing an unterminated provider line to grow without limit.
export async function* boundedJsonLines(
  stream: Readable,
  lineLimit = 256 * 1024,
  totalLimit = 8 * 1024 * 1024,
): AsyncIterable<unknown> {
  let partial = Buffer.alloc(0);
  let total = 0;
  const parse = (line: Buffer): unknown => {
    try {
      return JSON.parse(line.toString("utf8")) as unknown;
    } catch {
      throw new Error("AI program returned invalid output.");
    }
  };
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as string);
    total += chunk.length;
    if (total > totalLimit)
      throw new Error("AI output exceeded the supported size.");
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const slice = chunk.subarray(offset, end);
      if (partial.length + slice.length > lineLimit)
        throw new Error("AI output exceeded the supported size.");
      const line = partial.length ? Buffer.concat([partial, slice]) : slice;
      if (newline < 0) {
        partial = Buffer.from(line);
        break;
      }
      partial = Buffer.alloc(0);
      if (line.toString("utf8").trim()) yield parse(line);
      offset = end + 1;
    }
  }
  if (partial.toString("utf8").trim()) yield parse(partial);
}
