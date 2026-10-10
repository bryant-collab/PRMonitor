import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { boundedJsonLines } from "../src/main/ai/bounded-json-lines";

async function collect(
  chunks: readonly Buffer[],
  lineLimit = 256,
  totalLimit = 1024,
) {
  const values: unknown[] = [];
  for await (const value of boundedJsonLines(
    Readable.from(chunks),
    lineLimit,
    totalLimit,
  ))
    values.push(value);
  return values;
}
it("decodes split UTF-8 JSONL events and a final unterminated event", async () => {
  const bytes = Buffer.from('{"text":"café"}\r\n\n{"done":true}');
  const split = bytes.indexOf(0xc3) + 1;
  expect(
    await collect([
      bytes.subarray(0, split),
      bytes.subarray(split, 17),
      bytes.subarray(17),
    ]),
  ).toEqual([{ text: "café" }, { done: true }]);
});
it("bounds an unterminated line before accumulating it and closes its stream", async () => {
  const stream = Readable.from([
    Buffer.alloc(128, 120),
    Buffer.alloc(129, 120),
  ]);
  await expect(async () => {
    for await (const _ of boundedJsonLines(stream, 256, 1024)) {
      /* drain */
    }
  }).rejects.toThrow("exceeded");
  expect(stream.destroyed).toBe(true);
});
it("bounds aggregate output and returns a fixed malformed-output error", async () => {
  await expect(collect([Buffer.from("{}\n".repeat(400))])).rejects.toThrow(
    "exceeded",
  );
  await expect(
    collect([Buffer.from("private fixture diagnostics")]),
  ).rejects.toThrow("AI program returned invalid output.");
});
