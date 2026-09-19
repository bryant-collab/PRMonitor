import { z } from "zod";
import {
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_OUTPUT_LIMIT_BYTES,
  MAX_TIMEOUT_SECONDS,
  validationProfileV1Schema,
  VALIDATION_SCHEMA_VERSION,
  type ValidationProfile,
} from "./schema.js";
import type { ValidationResolution } from "./trust.js";
import { hashValidationProfile } from "./trust.js";

const authorizationReferenceSchema = z
  .object({
    authorizationType: z.enum(["approval", "one-run"]),
    id: z.string().min(1).max(256),
  })
  .strict();

const repositoryIdentitySchema = z
  .object({
    id: z.string().min(1).max(512),
  })
  .strict();

const worktreeIdentitySchema = z
  .object({
    canonicalRoot: z.string().min(1).max(4_096),
    baselineRevision: z.string().min(1).max(512),
    currentRevision: z.string().min(1).max(512).optional(),
  })
  .strict();

const effectiveLimitsSchema = z
  .object({
    defaultTimeoutSeconds: z.literal(DEFAULT_TIMEOUT_SECONDS),
    maxTimeoutSeconds: z.literal(MAX_TIMEOUT_SECONDS),
    defaultOutputLimitBytes: z.literal(DEFAULT_OUTPUT_LIMIT_BYTES),
    maxOutputLimitBytes: z.literal(MAX_OUTPUT_LIMIT_BYTES),
  })
  .strict();

export const validationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(VALIDATION_SCHEMA_VERSION),
    snapshotId: z.string().min(1).max(256),
    createdAt: z.string().min(1).max(128),
    profile: validationProfileV1Schema,
    source: z.enum(["one-run", "saved", "checked-in"]),
    repositoryIdentity: repositoryIdentitySchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    authorization: authorizationReferenceSchema,
    worktree: worktreeIdentitySchema,
    effectiveLimits: effectiveLimitsSchema,
  })
  .strict();

export type WorktreeIdentity = z.infer<typeof worktreeIdentitySchema>;
export type EffectiveValidationLimits = z.infer<typeof effectiveLimitsSchema>;
export type ValidationSnapshot = z.infer<typeof validationSnapshotSchema>;

export interface CreateValidationSnapshotInput {
  resolved: Extract<ValidationResolution, { status: "ready" }>;
  snapshotId: string;
  createdAt: string;
  worktree: WorktreeIdentity;
}

export interface SnapshotIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

export type SnapshotValidationResult =
  | { ok: true; snapshot: ValidationSnapshot }
  | {
      ok: false;
      code: "INVALID_SNAPSHOT" | "UNSUPPORTED_SCHEMA_VERSION" | "SNAPSHOT_MISMATCH";
      issues: SnapshotIssue[];
    };

const effectiveLimits: EffectiveValidationLimits = {
  defaultTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  defaultOutputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
  maxOutputLimitBytes: MAX_OUTPUT_LIMIT_BYTES,
};

function issuesFromZod(error: z.ZodError): SnapshotIssue[] {
  return error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code }));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

export function createValidationSnapshot(input: CreateValidationSnapshotInput): Readonly<ValidationSnapshot> {
  if (input.resolved.status !== "ready") {
    throw new TypeError("a validation snapshot requires a ready, trusted profile");
  }
  const snapshot: ValidationSnapshot = {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    snapshotId: input.snapshotId,
    createdAt: input.createdAt,
    profile: JSON.parse(JSON.stringify(input.resolved.profile)) as ValidationProfile,
    source: input.resolved.source,
    repositoryIdentity: { id: input.resolved.repositoryId },
    contentHash: input.resolved.contentHash,
    authorization: input.resolved.authorization,
    worktree: { ...input.worktree },
    effectiveLimits: { ...effectiveLimits },
  };
  const result = validateValidationSnapshot(snapshot);
  if (!result.ok) {
    throw new TypeError(result.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return deepFreeze(result.snapshot);
}

export function validateValidationSnapshot(input: unknown): SnapshotValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      code: "INVALID_SNAPSHOT",
      issues: [{ path: [], message: "snapshot must be an object", code: "invalid_type" }],
    };
  }
  const version = (input as Record<string, unknown>).schemaVersion;
  if (version !== VALIDATION_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
      issues: [
        {
          path: ["schemaVersion"],
          message: `unsupported validation snapshot schema version: ${String(version)}`,
          code: "unsupported_schema_version",
        },
      ],
    };
  }
  const parsed = validationSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_SNAPSHOT", issues: issuesFromZod(parsed.error) };
  }
  const expectedHash = hashValidationProfile(parsed.data.profile);
  if (parsed.data.contentHash !== expectedHash) {
    return {
      ok: false,
      code: "SNAPSHOT_MISMATCH",
      issues: [
        {
          path: ["contentHash"],
          message: "contentHash does not match the snapshotted normalized profile",
          code: "content_hash_mismatch",
        },
      ],
    };
  }
  const authorizationMatchesSource =
    (parsed.data.source === "one-run" && parsed.data.authorization.authorizationType === "one-run") ||
    (parsed.data.source !== "one-run" && parsed.data.authorization.authorizationType === "approval");
  if (!authorizationMatchesSource) {
    return {
      ok: false,
      code: "SNAPSHOT_MISMATCH",
      issues: [
        {
          path: ["authorization", "authorizationType"],
          message: "authorization type does not match profile source",
          code: "authorization_source_mismatch",
        },
      ],
    };
  }
  return { ok: true, snapshot: deepFreeze(parsed.data) };
}

export function parseValidationSnapshot(input: unknown): SnapshotValidationResult {
  return validateValidationSnapshot(input);
}

export function serializeValidationSnapshot(snapshot: ValidationSnapshot): string {
  const result = validateValidationSnapshot(snapshot);
  if (!result.ok) {
    throw new TypeError("cannot serialize an invalid validation snapshot");
  }
  return JSON.stringify(result.snapshot);
}

export function snapshotProfile(snapshot: ValidationSnapshot): ValidationProfile {
  return snapshot.profile;
}
