import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderValidationSchema } from "./schema-artifact.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outputPath = resolve(packageRoot, "Specs", "contracts", "validation-profile.v1.schema.json");
const expected = Buffer.from(renderValidationSchema(), "utf8");
const actual = await readFile(outputPath);

if (!actual.equals(expected)) {
  throw new Error(`validation schema drift detected at ${outputPath}; run npm run generate:validation-schema explicitly to update it`);
}

console.log(`verified validation schema (read-only): ${outputPath}`);
