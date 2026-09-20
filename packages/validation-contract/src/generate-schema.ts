import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderValidationSchema } from "./schema-artifact.js";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const outputPath = resolve(
  packageRoot,
  "Specs",
  "contracts",
  "validation-profile.v1.schema.json",
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderValidationSchema(), "utf8");
console.log(`generated ${outputPath}`);
