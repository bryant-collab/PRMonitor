import { createHash } from "node:crypto";
import {
  MAX_PERSISTED_JSON_BYTES,
  MAX_PERSISTED_TEXT_BYTES,
  PERSISTENCE_RECORD_SCHEMA_VERSION,
  PersistenceError,
  type PersistenceReason,
} from "./types";

const UNSAFE_KEY =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|sdk|exception|environment|env)/iu;
const SAFE_USAGE_KEYS = new Set([
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
]);

type SafeJsonPrimitive = string | number | boolean | null;
export type SafeJsonValue =
  SafeJsonPrimitive | SafeJsonValue[] | { [key: string]: SafeJsonValue };

export interface EncodedSnapshot {
  readonly schemaVersion: number;
  readonly payload: string;
  readonly payloadHash: string;
}

function codecReason(
  code: "INVALID_RECORD" | "SECURITY_VIOLATION",
  what: string,
  details: Readonly<Record<string, string | number | boolean>> = {},
): PersistenceReason {
  return {
    code,
    stage: "health_record",
    what,
    why:
      code === "SECURITY_VIOLATION"
        ? "Persistence records must not contain credentials, prompts, SDK objects, or uncontrolled environment data."
        : "The value cannot be represented as a bounded versioned persistence record.",
    nextAction: "FIX_INPUT",
    correlationId: "codec",
    databaseId: "codec",
    details,
  };
}

function fail(
  code: "INVALID_RECORD" | "SECURITY_VIOLATION",
  what: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): never {
  throw new PersistenceError(codecReason(code, what, details));
}

function assertSafeText(value: string, label: string): void {
  if (value.length > MAX_PERSISTED_TEXT_BYTES) {
    fail("INVALID_RECORD", `${label} exceeds the persistence text limit.`, {
      maxBytes: MAX_PERSISTED_TEXT_BYTES,
    });
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint <= 31 &&
        codePoint !== 9 &&
        codePoint !== 10 &&
        codePoint !== 13) ||
        codePoint === 127)
    ) {
      fail("INVALID_RECORD", `${label} contains a control character.`);
    }
  }
}

function toSafeJson(
  value: unknown,
  depth: number,
  path: string,
): SafeJsonValue {
  if (depth > 20)
    fail("INVALID_RECORD", "The persistence value is too deeply nested.");
  if (value === null) return null;
  if (typeof value === "string") {
    assertSafeText(value, path);
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fail("INVALID_RECORD", `${path} contains a non-finite number.`);
    return value;
  }
  if (
    typeof value !== "object" ||
    value instanceof Date ||
    value instanceof Uint8Array
  ) {
    fail("INVALID_RECORD", `${path} contains an unsupported value.`);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      toSafeJson(item, depth + 1, `${path}[${index}]`),
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_RECORD", `${path} must contain plain objects only.`);
  }
  const result: Record<string, SafeJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    assertSafeText(key, `${path} key`);
    if (UNSAFE_KEY.test(key) && !SAFE_USAGE_KEYS.has(key)) {
      fail(
        "SECURITY_VIOLATION",
        `The persistence field ${key} is not allowed.`,
      );
    }
    result[key] = toSafeJson(item, depth + 1, `${path}.${key}`);
  }
  return result;
}

function canonicalize(value: SafeJsonValue): SafeJsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function encodeSnapshot(
  value: unknown,
  schemaVersion = PERSISTENCE_RECORD_SCHEMA_VERSION,
): EncodedSnapshot {
  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > 32
  ) {
    fail("INVALID_RECORD", "The persistence schema version is invalid.");
  }
  const safe = canonicalize(toSafeJson(value, 0, "payload"));
  const payload = JSON.stringify(safe);
  if (
    payload === undefined ||
    Buffer.byteLength(payload, "utf8") > MAX_PERSISTED_JSON_BYTES
  ) {
    fail(
      "INVALID_RECORD",
      "The persistence payload exceeds the JSON size limit.",
      {
        maxBytes: MAX_PERSISTED_JSON_BYTES,
      },
    );
  }
  return {
    schemaVersion,
    payload,
    payloadHash: createHash("sha256").update(payload, "utf8").digest("hex"),
  };
}

export function decodeSnapshot<T>(
  encoded: Pick<EncodedSnapshot, "schemaVersion" | "payload" | "payloadHash">,
  expectedSchemaVersion: number = PERSISTENCE_RECORD_SCHEMA_VERSION,
): T {
  if (encoded.schemaVersion !== expectedSchemaVersion) {
    fail(
      "INVALID_RECORD",
      "The persistence record uses an unsupported schema version.",
      {
        expectedSchemaVersion,
        actualSchemaVersion: encoded.schemaVersion,
      },
    );
  }
  const hash = createHash("sha256")
    .update(encoded.payload, "utf8")
    .digest("hex");
  if (hash !== encoded.payloadHash) {
    fail(
      "INVALID_RECORD",
      "The persistence payload hash does not match its content.",
    );
  }
  if (Buffer.byteLength(encoded.payload, "utf8") > MAX_PERSISTED_JSON_BYTES) {
    fail(
      "INVALID_RECORD",
      "The persistence payload exceeds the JSON size limit.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded.payload) as unknown;
  } catch {
    fail("INVALID_RECORD", "The persistence payload is not valid JSON.");
  }
  const safe = toSafeJson(parsed, 0, "payload");
  return safe as T;
}

export function contentHash(value: unknown): string {
  return encodeSnapshot(value).payloadHash;
}

export function assertBoundedIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    fail(
      "INVALID_RECORD",
      `${label} is not a valid provider-neutral identifier.`,
    );
  }
}

export function assertBoundedText(value: string, label: string): void {
  assertSafeText(value, label);
}
