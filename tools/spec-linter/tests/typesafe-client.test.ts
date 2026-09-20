import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  createSemanticLinterClient,
  readSemanticLinterApiKey,
} from "../src/typesafe-client.js";

describe("semantic linter client configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the configured runtime credential without CLI input", () => {
    const configuredValue = `test-credential-${Date.now()}`;
    vi.stubEnv("TYPESAFE_API_KEY", configuredValue);

    expect(readSemanticLinterApiKey()).toBe(configuredValue);
    expect(createSemanticLinterClient()).toBeInstanceOf(TypeSafeClient);
  });

  it("fails clearly when the runtime credential is unavailable", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");

    expect(() => readSemanticLinterApiKey()).toThrow(
      "The semantic linter could not find its configured runtime credential.",
    );
  });
});
