import { zodToJsonSchema } from "zod-to-json-schema";
import { validationProfileV1Schema } from "./schema.js";

export function renderValidationSchema(): string {
  const schema = zodToJsonSchema(validationProfileV1Schema, {
    $refStrategy: "none",
    name: "ValidationProfileV1",
  });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
