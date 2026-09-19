import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { validationProfileV1Schema } from "./schema.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outputPath = resolve(packageRoot, "Specs", "contracts", "validation-profile.v1.schema.json");

const schema = zodToJsonSchema(validationProfileV1Schema, {
  $refStrategy: "none",
  name: "ValidationProfileV1",
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`generated ${outputPath}`);
