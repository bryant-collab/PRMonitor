export * from "./schema.js";
export * from "./trust.js";
export * from "./execution.js";
export * from "./output.js";
export * from "./snapshot.js";
export * from "./evidence.js";
export * from "./consumer.js";

import { parseValidationProfile, type ValidationProfile } from "./schema.js";

export function readStoredValidationProfile(serialized: string): ReturnType<typeof parseValidationProfile> {
  try {
    return parseValidationProfile(JSON.parse(serialized) as unknown);
  } catch {
    return {
      ok: false,
      code: "INVALID_PROFILE",
      issues: [{ path: [], message: "stored profile is not valid JSON", code: "invalid_json" }],
    };
  }
}

export function serializeValidationProfile(profile: ValidationProfile): string {
  const parsed = parseValidationProfile(profile);
  if (!parsed.ok) {
    throw new TypeError("cannot serialize an invalid validation profile");
  }
  return JSON.stringify(parsed.profile);
}
