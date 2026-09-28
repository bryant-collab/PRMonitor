import { z } from "zod";

export const F28_SCHEMA_VERSION = 1 as const;
export const F28_MAX_SCOPES = 250 as const;
export const F28_MAX_ATTEMPTS = 16 as const;
export const F28_MAX_EVIDENCE_REFS = 16 as const;
export const F28_MAX_EVIDENCE_TEXT = 512 as const;
export const F28_DEFAULT_RETRY_BASE_MS = 1_000 as const;
export const F28_MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function stableDigest(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    first ^= codePoint;
    first = Math.imul(first, 0x01000193);
    second ^= codePoint + 0x9e3779b9;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`
    .repeat(3)
    .slice(0, 40);
}

export const f28TriggerSchema = z.enum([
  "startup",
  "wake",
  "online",
  "explicit",
  "renderer_replaced",
]);
export type F28RecoveryTrigger = z.infer<typeof f28TriggerSchema>;

export const f28ScopeKindSchema = z.enum([
  "application",
  "managed_pr",
  "review_bundle",
  "ai_operation",
  "sync_operation",
  "publication",
]);
export type F28RecoveryScopeKind = z.infer<typeof f28ScopeKindSchema>;

export const f28StageSchema = z.enum([
  "LIFECYCLE",
  "SCHEDULER",
  "HOLDS",
  "LOCAL_WORK",
  "AI",
  "REVIEW_PUBLICATION",
  "SYNC_PUBLICATION",
  "FINALIZE",
]);
export type F28RecoveryStage = z.infer<typeof f28StageSchema>;

export const f28ClassificationSchema = z.enum([
  "COMPLETED",
  "ADOPTED",
  "SAFE_TO_RETRY",
  "WAITING_FOR_NETWORK",
  "INTERRUPTED",
  "UNCERTAIN",
  "BLOCKED",
  "SKIPPED",
]);
export type F28RecoveryClassification = z.infer<typeof f28ClassificationSchema>;

export const f28ActionSchema = z.enum([
  "NONE",
  "WAIT",
  "RETRY",
  "RECONCILE",
  "CONTINUE_AI_WORK",
  "RETRY_RESOLUTION",
  "INSPECT",
  "MANUAL_REPAIR",
  "RE_EVALUATE",
  "DISCARD",
  "REVIEW",
]);
export type F28RecoveryAction = z.infer<typeof f28ActionSchema>;

export const f28ReasonSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    code: z.string().regex(identifierPattern).max(128),
    what: z.string().min(1).max(F28_MAX_EVIDENCE_TEXT),
    why: z.string().min(1).max(F28_MAX_EVIDENCE_TEXT),
    nextAction: f28ActionSchema,
    retryable: z.boolean(),
    correlationId: z.string().regex(identifierPattern).max(128),
    evidenceRefs: z
      .array(z.string().regex(identifierPattern).max(128))
      .max(F28_MAX_EVIDENCE_REFS),
  })
  .strict();
export type F28RecoveryReason = z.infer<typeof f28ReasonSchema>;

export const f28LifecycleSnapshotSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    applicationSessionId: z.string().regex(identifierPattern).max(128),
    lifecyclePhase: z.string().regex(identifierPattern).max(64),
    rendererAttached: z.boolean(),
    explicitShutdown: z.boolean(),
    online: z.boolean(),
    wallClockAt: z.string().regex(timestampPattern),
    monotonicNowMs: z.number().finite().nonnegative(),
  })
  .strict();
export type F28LifecycleSnapshot = z.infer<typeof f28LifecycleSnapshotSchema>;

export const f28ScopeInputSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    kind: f28ScopeKindSchema,
    id: z.string().regex(identifierPattern).max(128),
    owner: z.string().regex(identifierPattern).max(128),
    stage: f28StageSchema,
    expectedRevision: z.string().regex(identifierPattern).max(128).optional(),
    inputRevision: z.string().regex(identifierPattern).max(128).optional(),
    repositoryKey: z.string().regex(identifierPattern).max(128).optional(),
    branch: z.string().regex(identifierPattern).max(128).optional(),
    worktreeId: z.string().regex(identifierPattern).max(128).optional(),
    effectId: z.string().regex(identifierPattern).max(128).optional(),
  })
  .strict();
export type F28RecoveryScopeInput = z.infer<typeof f28ScopeInputSchema>;

export const f28OwnerOutcomeSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    classification: f28ClassificationSchema,
    reason: f28ReasonSchema,
    evidenceRefs: z
      .array(z.string().regex(identifierPattern).max(128))
      .max(F28_MAX_EVIDENCE_REFS),
    nextAttemptAt: z.string().regex(timestampPattern).optional(),
    ownerRevision: z.string().regex(identifierPattern).max(128).optional(),
  })
  .strict();
export type F28OwnerOutcome = z.infer<typeof f28OwnerOutcomeSchema>;

export const f28RecoveryScopeRecordSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    scopeKey: z.string().regex(identifierPattern).max(128),
    sessionId: z.string().regex(identifierPattern).max(128),
    scope: f28ScopeInputSchema,
    stage: f28StageSchema,
    classification: f28ClassificationSchema,
    attemptCount: z.number().int().min(0).max(F28_MAX_ATTEMPTS),
    version: z.number().int().min(1),
    reason: f28ReasonSchema.optional(),
    evidenceRefs: z
      .array(z.string().regex(identifierPattern).max(128))
      .max(F28_MAX_EVIDENCE_REFS),
    nextAttemptAt: z.string().regex(timestampPattern).optional(),
    createdAt: z.string().regex(timestampPattern),
    updatedAt: z.string().regex(timestampPattern),
  })
  .strict();
export type F28RecoveryScopeRecord = z.infer<
  typeof f28RecoveryScopeRecordSchema
>;

export const f28RecoveryAttemptRecordSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    attemptId: z.string().regex(identifierPattern).max(128),
    sessionId: z.string().regex(identifierPattern).max(128),
    scopeKey: z.string().regex(identifierPattern).max(128),
    stage: f28StageSchema,
    attemptNumber: z.number().int().min(1).max(F28_MAX_ATTEMPTS),
    status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
    expectedRevision: z.string().regex(identifierPattern).max(128).optional(),
    classification: f28ClassificationSchema.optional(),
    reason: f28ReasonSchema.optional(),
    evidenceRefs: z
      .array(z.string().regex(identifierPattern).max(128))
      .max(F28_MAX_EVIDENCE_REFS),
    startedAt: z.string().regex(timestampPattern),
    completedAt: z.string().regex(timestampPattern).optional(),
    nextAttemptAt: z.string().regex(timestampPattern).optional(),
  })
  .strict();
export type F28RecoveryAttemptRecord = z.infer<
  typeof f28RecoveryAttemptRecordSchema
>;

export const f28RecoverySessionRecordSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    sessionId: z.string().regex(identifierPattern).max(128),
    requestKey: z.string().regex(identifierPattern).max(128),
    trigger: f28TriggerSchema,
    status: z.enum(["RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
    stage: f28StageSchema,
    lifecycle: f28LifecycleSnapshotSchema,
    scopeCount: z.number().int().min(0).max(F28_MAX_SCOPES),
    completedCount: z.number().int().min(0).max(F28_MAX_SCOPES),
    attentionCount: z.number().int().min(0).max(F28_MAX_SCOPES),
    retryCount: z.number().int().min(0).max(F28_MAX_SCOPES),
    version: z.number().int().min(1),
    createdAt: z.string().regex(timestampPattern),
    updatedAt: z.string().regex(timestampPattern),
  })
  .strict();
export type F28RecoverySessionRecord = z.infer<
  typeof f28RecoverySessionRecordSchema
>;

export const f28RecoveryProjectionSchema = z
  .object({
    schemaVersion: z.literal(F28_SCHEMA_VERSION),
    kind: z.literal("f28-recovery"),
    sessionId: z.string().regex(identifierPattern).max(128),
    trigger: f28TriggerSchema,
    status: z.enum(["RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
    stage: f28StageSchema,
    lifecycle: f28LifecycleSnapshotSchema,
    summary: z
      .object({
        scopes: z.number().int().min(0).max(F28_MAX_SCOPES),
        completed: z.number().int().min(0).max(F28_MAX_SCOPES),
        attention: z.number().int().min(0).max(F28_MAX_SCOPES),
        retrying: z.number().int().min(0).max(F28_MAX_SCOPES),
      })
      .strict(),
    scopes: z.array(f28RecoveryScopeRecordSchema).max(F28_MAX_SCOPES),
    nextAttemptAt: z.string().regex(timestampPattern).optional(),
    updatedAt: z.string().regex(timestampPattern),
  })
  .strict();
export type F28RecoveryProjection = z.infer<typeof f28RecoveryProjectionSchema>;

export interface F28RecoveryRequest {
  readonly trigger: F28RecoveryTrigger;
  readonly requestId: string;
  readonly scope?: F28RecoveryScopeInput;
  readonly expectedRevision?: string;
}

export interface F28RecoverySessionResult {
  readonly session: F28RecoverySessionRecord;
  readonly projection: F28RecoveryProjection;
  readonly coalesced: boolean;
}

export const F28_RECOVERY_STAGES: readonly F28RecoveryStage[] = [
  "LIFECYCLE",
  "SCHEDULER",
  "HOLDS",
  "LOCAL_WORK",
  "AI",
  "REVIEW_PUBLICATION",
  "SYNC_PUBLICATION",
  "FINALIZE",
];

export function f28ScopeKey(input: {
  readonly kind: F28RecoveryScopeKind;
  readonly id: string;
  readonly expectedRevision?: string;
  readonly owner?: string;
  readonly stage?: F28RecoveryStage;
}): string {
  const source = `${input.owner ?? ""}\n${input.stage ?? ""}\n${input.kind}\n${input.id}\n${input.expectedRevision ?? ""}`;
  const digest = stableDigest(source);
  return `f28-scope-${digest.slice(0, 40)}`;
}

export function f28RequestKey(input: {
  readonly trigger: F28RecoveryTrigger;
  readonly requestId: string;
  readonly applicationSessionId: string;
  readonly scope?: F28RecoveryScopeInput;
  readonly expectedRevision?: string;
}): string {
  const scope =
    input.scope === undefined
      ? "application"
      : f28ScopeKey({
          kind: input.scope.kind,
          id: input.scope.id,
          expectedRevision:
            input.expectedRevision ?? input.scope.expectedRevision,
          owner: input.scope.owner,
          stage: input.scope.stage,
        });
  const coalescingTrigger =
    input.trigger === "wake" || input.trigger === "online"
      ? "environment"
      : input.trigger;
  const requestIdentity = input.requestId;
  const source = `${coalescingTrigger}\n${input.applicationSessionId}\n${scope}\n${requestIdentity}`;
  const digest = stableDigest(source);
  return `f28-request-${digest.slice(0, 40)}`;
}

export function f28BackoffMs(
  attemptNumber: number,
  baseMs = F28_DEFAULT_RETRY_BASE_MS,
  capMs = F28_MAX_RETRY_DELAY_MS,
): number {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1)
    throw new Error("F28_INVALID_ATTEMPT_NUMBER");
  if (!Number.isSafeInteger(baseMs) || baseMs < 1)
    throw new Error("F28_INVALID_BACKOFF_BASE");
  if (!Number.isSafeInteger(capMs) || capMs < baseMs)
    throw new Error("F28_INVALID_BACKOFF_CAP");
  return Math.min(capMs, baseMs * 2 ** Math.min(attemptNumber - 1, 20));
}

export function f28NextRetryAt(
  now: string,
  attemptNumber: number,
  baseMs = F28_DEFAULT_RETRY_BASE_MS,
  capMs = F28_MAX_RETRY_DELAY_MS,
): string {
  if (!timestampPattern.test(now)) throw new Error("F28_INVALID_NOW");
  return new Date(
    Date.parse(now) + f28BackoffMs(attemptNumber, baseMs, capMs),
  ).toISOString();
}

export function f28IsTerminalClassification(
  classification: F28RecoveryClassification,
): boolean {
  return [
    "COMPLETED",
    "ADOPTED",
    "BLOCKED",
    "INTERRUPTED",
    "UNCERTAIN",
    "SKIPPED",
  ].includes(classification);
}

export function f28IsAttentionClassification(
  classification: F28RecoveryClassification,
): boolean {
  return ["BLOCKED", "INTERRUPTED", "UNCERTAIN"].includes(classification);
}

export function f28IsRetryableClassification(
  classification: F28RecoveryClassification,
): boolean {
  return ["SAFE_TO_RETRY", "WAITING_FOR_NETWORK"].includes(classification);
}

export type F28EffectObservation =
  | {
      readonly kind: "commit";
      readonly expectedCommitSha: string;
      readonly observedCommitSha?: string;
      readonly evidence: "MATCHING" | "ABSENT" | "DIVERGENT" | "UNKNOWN";
    }
  | {
      readonly kind: "push";
      readonly expectedOldSha: string;
      readonly expectedCommitSha: string;
      readonly observedRefSha?: string;
      readonly evidence:
        "MATCHING" | "EXPECTED_OLD" | "DIVERGENT" | "DELETED" | "UNKNOWN";
    }
  | {
      readonly kind: "response";
      readonly expectedResponseId?: string;
      readonly matchingResponseCount: number;
      readonly evidence: "MATCHING" | "ABSENT" | "MULTIPLE" | "UNKNOWN";
    };

export function f28ClassifyEffectObservation(
  observation: F28EffectObservation,
): F28RecoveryClassification {
  if (observation.kind === "commit") {
    if (
      observation.evidence === "MATCHING" &&
      observation.observedCommitSha === observation.expectedCommitSha
    )
      return "ADOPTED";
    if (observation.evidence === "ABSENT") return "SAFE_TO_RETRY";
    return "UNCERTAIN";
  }
  if (observation.kind === "push") {
    if (
      observation.evidence === "MATCHING" &&
      observation.observedRefSha === observation.expectedCommitSha
    )
      return "ADOPTED";
    if (
      observation.evidence === "EXPECTED_OLD" &&
      observation.observedRefSha === observation.expectedOldSha
    )
      return "SAFE_TO_RETRY";
    return "UNCERTAIN";
  }
  if (
    observation.evidence === "MATCHING" &&
    observation.matchingResponseCount === 1
  )
    return "ADOPTED";
  if (
    observation.evidence === "ABSENT" &&
    observation.matchingResponseCount === 0
  )
    return "SAFE_TO_RETRY";
  return "UNCERTAIN";
}

export function isF28RecoveryProjection(
  value: unknown,
): value is F28RecoveryProjection {
  return f28RecoveryProjectionSchema.safeParse(value).success;
}
