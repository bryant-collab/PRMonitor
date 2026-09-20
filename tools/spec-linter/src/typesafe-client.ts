import { TypeSafeClient } from "@typesafe-ai/sdk";

const API_KEY_ENVIRONMENT_VARIABLE = "TYPESAFE_API_KEY";

export function readSemanticLinterApiKey(): string {
  const apiKey = process.env[API_KEY_ENVIRONMENT_VARIABLE]?.trim();
  if (!apiKey) {
    throw new Error(
      "The semantic linter could not find its configured runtime credential.",
    );
  }
  return apiKey;
}

export function createSemanticLinterClient(): TypeSafeClient {
  return new TypeSafeClient({ apiKey: readSemanticLinterApiKey() });
}
