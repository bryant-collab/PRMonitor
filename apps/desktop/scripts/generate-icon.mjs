/* global Buffer, process */

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const output = path.join(appRoot, "build", "prmonitor.png");

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, checksum]);
}

function pixel(rgba, red, green, blue, alpha = 255) {
  rgba.push(red, green, blue, alpha);
}

function createPng(size = 256) {
  const scale = size / 64;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0];
    for (let x = 0; x < size; x += 1) {
      const edge =
        x < 4 * scale ||
        y < 4 * scale ||
        x >= size - 4 * scale ||
        y >= size - 4 * scale;
      const background = edge ? [10, 20, 38] : [18, 36, 63];
      let color = background;
      const inPanel =
        x >= 12 * scale && x < 52 * scale && y >= 12 * scale && y < 52 * scale;
      if (
        inPanel &&
        (x - 32 * scale) ** 2 + (y - 32 * scale) ** 2 < (20 * scale) ** 2
      )
        color = [21, 184, 166];
      const mark =
        (x >= 24 * scale &&
          x < 30 * scale &&
          y >= 20 * scale &&
          y < 44 * scale) ||
        (x >= 30 * scale &&
          x < 39 * scale &&
          y >= 20 * scale &&
          y < 25 * scale) ||
        (x >= 30 * scale &&
          x < 39 * scale &&
          y >= 30 * scale &&
          y < 35 * scale) ||
        (x >= 39 * scale &&
          x < 44 * scale &&
          y >= 23 * scale &&
          y < 32 * scale);
      if (mark) color = [246, 250, 252];
      pixel(row, ...color);
    }
    rows.push(Buffer.from(row));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, createPng());
process.stdout.write(`generated ${path.relative(process.cwd(), output)}\n`);
