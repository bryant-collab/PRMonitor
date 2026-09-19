import { z } from "zod";
import {
  statusFromExit,
  transitionStepState,
  type ExitObservation,
  type PreparedCommand,
  type RunState,
  type StepState,
  type ValidationReason,
} from "./execution.js";
import { stableIdSchema } from "./schema.js";
import type { ValidationProfile } from "./schema.js";
import type { ValidationWarning } from "./trust.js";
import { validationWarning } from "./trust.js";
import type { ValidationSnapshot } from "./snapshot.js";
import { validateValidationSnapshot } from "./snapshot.js";
import type { OutputEvidence } from "./output.js";

export const validationReasonSchema = z.enum([
  "NO_PROFILE",
  "CONFIRMATION_REQUIRED",
  "INVALID_PROFILE",
  "START_FAILED",
  "NON_ZERO_EXIT",
  "TIMED_OUT",
  "USER_CANCELLED",
  "APPLICATION_SHUTDOWN",
  "APPLICATION_RESTARTED",
  "PRIOR_STEP_STOPPED",
  "WORKTREE_PATH_INVALID",
  "REDACTION_FAILURE",
  "EXECUTABLE_NOT_RESOLVED",
  "MANUAL_CHECK_FAILED",
  "MANUAL_CHECK_NOT_RUN",
  "NO_AUTOMATED_COMMANDS",
  "SNAPSHOT_MISMATCH",
  "INVALID_TRANSITION",
]);

export const manualOutcomeSchema = z.enum(["verified", "failed", "not_run"]);

export const manualAttestationSchema = z
  .object({
    kind: z.literal("manual"),
    checkId: stableIdSchema,
    outcome: manualOutcomeSchema,
    attestedBy: z.string().min(1).max(256).optional(),
    timestamp: z.string().min(1).max(128),
    worktreePath: z.string().min(1).max(4_096),
    worktreeBaselineRevision: z.string().min(1).max(512),
    worktreeCurrentRevision: z.string().min(1).max(512),
    notes: z.string().max(16_384).optional(),
  })
  .strict();

export type ManualOutcome = z.infer<typeof manualOutcomeSchema>;
export type ManualAttestation = z.infer<typeof manualAttestationSchema>;

export interface RecordManualAttestationInput {
  checkId: string;
  outcome: ManualOutcome;
  timestamp: string;
  worktreePath: string;
  worktreeBaselineRevision: string;
  worktreeCurrentRevision: string;
  attestedBy?: string;
  notes?: string;
}

export function recordManualAttestation(input: RecordManualAttestationInput): ManualAttestation {
  const parsed = manualAttestationSchema.safeParse({ kind: "manual", ...input });
  if (!parsed.success) {
    throw new TypeError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

export function manualOutcomeLabel(outcome: ManualOutcome): string {
  switch (outcome) {
    case "verified":
      return "Verified manually";
    case "failed":
      return "Manual check failed";
    case "not_run":
      return "Not run";
  }
}

export function isManualAttestationCurrent(
  attestation: ManualAttestation,
  current: { worktreePath: string; baselineRevision: string; currentRevision: string },
): boolean {
  return (
    attestation.worktreePath === current.worktreePath &&
    attestation.worktreeBaselineRevision === current.baselineRevision &&
    attestation.worktreeCurrentRevision === current.currentRevision
  );
}

export interface ManualAttestationView {
  label: string;
  historical: boolean;
  attestation: ManualAttestation;
}

export function manualAttestationView(
  attestation: ManualAttestation,
  current: { worktreePath: string; baselineRevision: string; currentRevision: string },
): ManualAttestationView {
  return {
    label: manualOutcomeLabel(attestation.outcome),
    historical: !isManualAttestationCurrent(attestation, current),
    attestation,
  };
}

const outputEvidenceSchema = z
  .object({
    text: z.string(),
    originalByteCount: z.number().int().nonnegative(),
    processedByteCount: z.number().int().nonnegative(),
    retainedByteCount: z.number().int().nonnegative(),
    omittedByteCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    truncationMarker: z.string().optional(),
    redacted: z.boolean(),
    safe: z.boolean(),
    reason: z.literal("REDACTION_FAILURE").optional(),
  })
  .strict();

const commandStepEvidenceSchema = z
  .object({
    kind: z.literal("command"),
    stepId: stableIdSchema,
    status: z.enum(["pending", "running", "passed", "failed", "interrupted", "not_run"]),
    reason: validationReasonSchema.optional(),
    startedAt: z.string().min(1).optional(),
    completedAt: z.string().min(1).optional(),
    executable: z.string().min(1),
    arguments: z.array(z.string()),
    canonicalWorkingDirectory: z.string().min(1).optional(),
    resolvedExecutable: z.string().min(1).optional(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().min(1).nullable().optional(),
    stdout: outputEvidenceSchema.optional(),
    stderr: outputEvidenceSchema.optional(),
  })
  .strict();

const manualStepEvidenceSchema = z
  .object({
    kind: z.literal("manual"),
    stepId: stableIdSchema,
    status: z.enum(["pending", "passed", "failed", "not_run"]),
    reason: validationReasonSchema.optional(),
    attestation: manualAttestationSchema.optional(),
  })
  .strict();

export const validationStepEvidenceSchema = z.discriminatedUnion("kind", [
  commandStepEvidenceSchema,
  manualStepEvidenceSchema,
]);

export type CommandStepEvidence = z.infer<typeof commandStepEvidenceSchema>;
export type ManualStepEvidence = z.infer<typeof manualStepEvidenceSchema>;
export type ValidationStepEvidence = z.infer<typeof validationStepEvidenceSchema>;

export const validationWarningSchema = z
  .object({
    code: z.enum(["NO_PROFILE", "CONFIRMATION_REQUIRED", "INVALID_PROFILE"]),
    title: z.string().min(1),
    message: z.string().min(1),
    remediation: z.string().min(1),
  })
  .strict();

export const validationRunEvidenceSchema = z
  .object({
    recordType: z.literal("validation-run"),
    schemaVersion: z.literal(1),
    runId: z.string().min(1).max(256),
    snapshotId: z.string().min(1).max(256).optional(),
    status: z.enum(["running", "passed", "failed", "interrupted", "not_run"]),
    reason: validationReasonSchema.optional(),
    startedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
    steps: z.array(validationStepEvidenceSchema),
    manualAttestations: z.array(manualAttestationSchema),
    warnings: z.array(validationWarningSchema),
  })
  .strict();

export type ValidationRunEvidence = z.infer<typeof validationRunEvidenceSchema>;

export interface NoRunValidationRecord {
  recordType: "validation-run";
  schemaVersion: 1;
  runId: string;
  snapshotId?: string;
  status: "not_run";
  reason: "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE";
  startedAt: string;
  completedAt: string;
  steps: [];
  manualAttestations: ManualAttestation[];
  warnings: [ValidationWarning];
}

export function createNoRunValidationRecord(input: {
  runId: string;
  startedAt: string;
  completedAt?: string;
  reason: NoRunValidationRecord["reason"];
  manualAttestations?: readonly ManualAttestation[];
  snapshotId?: string;
}): NoRunValidationRecord {
  const warning = validationWarning(input.reason);
  return {
    recordType: "validation-run",
    schemaVersion: 1,
    runId: input.runId,
    ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
    status: "not_run",
    reason: input.reason,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? input.startedAt,
    steps: [],
    manualAttestations: [...(input.manualAttestations ?? [])],
    warnings: [warning],
  };
}

function emptyOutput(): OutputEvidence {
  return {
    text: "",
    originalByteCount: 0,
    processedByteCount: 0,
    retainedByteCount: 0,
    omittedByteCount: 0,
    truncated: false,
    redacted: false,
    safe: true,
  };
}

export function createInitialValidationRun(input: {
  snapshot: ValidationSnapshot;
  runId: string;
  startedAt: string;
}): ValidationRunEvidence {
  const steps: ValidationStepEvidence[] = input.snapshot.profile.steps.map((step) => {
    if (step.kind === "command") {
      return {
        kind: "command",
        stepId: step.id,
        status: "pending",
        executable: step.executable,
        arguments: [...step.arguments],
      };
    }
    return { kind: "manual", stepId: step.id, status: "pending" };
  });
  return {
    recordType: "validation-run",
    schemaVersion: 1,
    runId: input.runId,
    snapshotId: input.snapshot.snapshotId,
    status: "running",
    startedAt: input.startedAt,
    steps,
    manualAttestations: [],
    warnings: [],
  };
}

export function createCommandStepEvidence(input: {
  prepared: PreparedCommand;
  startedAt: string;
  completedAt: string;
  observation: ExitObservation;
  stdout?: OutputEvidence;
  stderr?: OutputEvidence;
}): CommandStepEvidence {
  const stdout = input.stdout ?? emptyOutput();
  const stderr = input.stderr ?? emptyOutput();
  const outputFailed = !stdout.safe || !stderr.safe;
  const exit = statusFromExit(input.observation);
  const status: StepState = outputFailed ? "failed" : exit.status;
  const reason: ValidationReason | undefined = outputFailed ? "REDACTION_FAILURE" : exit.reason;
  return {
    kind: "command",
    stepId: input.prepared.stepId,
    status,
    ...(reason === undefined ? {} : { reason }),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    executable: input.prepared.executable,
    arguments: [...input.prepared.arguments],
    canonicalWorkingDirectory: input.prepared.canonicalWorkingDirectory,
    resolvedExecutable: input.prepared.resolvedExecutable,
    ...(input.observation.exitCode === undefined ? {} : { exitCode: input.observation.exitCode }),
    ...(input.observation.signal === undefined ? {} : { signal: input.observation.signal }),
    stdout,
    stderr,
  };
}

export function stopRemainingSteps(
  steps: readonly ValidationStepEvidence[],
  failedStepIndex: number,
): ValidationStepEvidence[] {
  return steps.map((step, index) => {
    if (index <= failedStepIndex || step.status !== "pending") {
      return { ...step };
    }
    return { ...step, status: "not_run", reason: "PRIOR_STEP_STOPPED" };
  });
}

export function applyStepStatus(
  step: ValidationStepEvidence,
  next: Exclude<StepState, "running" | "pending">,
  reason?: ValidationReason,
): ValidationStepEvidence {
  const transition = transitionStepState(step.status, next);
  if (!transition.ok) {
    throw new TypeError(transition.message);
  }
  return {
    ...step,
    status: next,
    ...(reason === undefined ? {} : { reason }),
  } as ValidationStepEvidence;
}

export interface ValidationAggregate {
  status: RunState;
  reason?: ValidationReason | "MANUAL_CHECK_NOT_RUN";
  automated: CommandStepEvidence[];
  manual: ManualAttestation[];
  warnings: ValidationWarning[];
}

export function aggregateValidationEvidence(input: {
  automated: readonly CommandStepEvidence[];
  manual?: readonly ManualAttestation[];
  unavailableReason?: "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE";
}): ValidationAggregate {
  const automated = input.automated.map((step) => ({ ...step }));
  const manual = [...(input.manual ?? [])];
  const warnings: ValidationWarning[] = [];
  if (input.unavailableReason !== undefined) {
    warnings.push(validationWarning(input.unavailableReason));
    return { status: "not_run", reason: input.unavailableReason, automated, manual, warnings };
  }
  if (automated.length === 0) {
    if (manual.some((attestation) => attestation.outcome === "failed")) {
      return {
        status: "failed",
        reason: "MANUAL_CHECK_FAILED",
        automated,
        manual,
        warnings,
      };
    }
    return {
      status: "not_run",
      reason: "NO_AUTOMATED_COMMANDS",
      automated,
      manual,
      warnings,
    };
  }
  if (automated.some((step) => step.stdout?.safe === false || step.stderr?.safe === false)) {
    return { status: "failed", reason: "REDACTION_FAILURE", automated, manual, warnings };
  }
  if (automated.some((step) => step.status === "interrupted")) {
    const interrupted = automated.find((step) => step.status === "interrupted");
    const interruptedReason = interrupted?.reason;
    const reason: ValidationReason =
      interruptedReason === "USER_CANCELLED" ||
      interruptedReason === "APPLICATION_SHUTDOWN" ||
      interruptedReason === "APPLICATION_RESTARTED" ||
      interruptedReason === "TIMED_OUT"
        ? interruptedReason
        : "TIMED_OUT";
    return { status: "interrupted", reason, automated, manual, warnings };
  }
  if (automated.some((step) => step.status === "failed")) {
    const failed = automated.find((step) => step.status === "failed");
    const failedReason = validationReasonSchema.safeParse(failed?.reason);
    return {
      status: "failed",
      reason: failedReason.success ? failedReason.data : "NON_ZERO_EXIT",
      automated,
      manual,
      warnings,
    };
  }
  if (automated.some((step) => step.status === "not_run" || step.status === "pending" || step.status === "running")) {
    return { status: "not_run", reason: "PRIOR_STEP_STOPPED", automated, manual, warnings };
  }
  if (manual.some((attestation) => attestation.outcome === "failed")) {
    return { status: "failed", reason: "MANUAL_CHECK_FAILED", automated, manual, warnings };
  }
  if (manual.some((attestation) => attestation.outcome === "not_run")) {
    return { status: "not_run", reason: "MANUAL_CHECK_NOT_RUN", automated, manual, warnings };
  }
  return { status: "passed", automated, manual, warnings };
}

export function completeValidationRun(input: {
  run: ValidationRunEvidence;
  steps: readonly ValidationStepEvidence[];
  completedAt: string;
  manualAttestations?: readonly ManualAttestation[];
  unavailableReason?: "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE";
}): ValidationRunEvidence {
  if (input.run.status !== "running") {
    throw new TypeError("only a running validation run can be completed");
  }
  const automated = input.steps.filter((step): step is CommandStepEvidence => step.kind === "command");
  const aggregate = aggregateValidationEvidence({
    automated,
    manual: input.manualAttestations,
    unavailableReason: input.unavailableReason,
  });
  const hasUnattestedManualStep = input.steps.some(
    (step) => step.kind === "manual" && (step.status === "pending" || step.status === "not_run"),
  );
  const finalStatus = aggregate.status === "passed" && hasUnattestedManualStep ? "not_run" : aggregate.status;
  const finalReason =
    aggregate.status === "passed" && hasUnattestedManualStep ? ("MANUAL_CHECK_NOT_RUN" as const) : aggregate.reason;
  return {
    ...input.run,
    status: finalStatus,
    ...(finalReason === undefined ? {} : { reason: finalReason }),
    completedAt: input.completedAt,
    steps: input.steps.map((step) => ({ ...step })),
    manualAttestations: aggregate.manual,
    warnings: aggregate.warnings,
  };
}

export function finalizeIncompleteValidationRun(
  run: ValidationRunEvidence,
  completedAt: string,
): ValidationRunEvidence {
  if (run.status !== "running") {
    return run;
  }
  const firstRunning = run.steps.findIndex((step) => step.status === "running");
  const steps: ValidationStepEvidence[] = run.steps.map((step, index): ValidationStepEvidence => {
    if (step.status === "running") {
      return { ...step, status: "interrupted", reason: "APPLICATION_RESTARTED", completedAt };
    }
    if (index > firstRunning && step.status === "pending") {
      return { ...step, status: "not_run", reason: "PRIOR_STEP_STOPPED" };
    }
    return { ...step };
  });
  return {
    ...run,
    status: "interrupted",
    reason: "APPLICATION_RESTARTED",
    completedAt,
    steps,
  };
}

export function validateValidationRunEvidence(input: unknown):
  | { ok: true; run: ValidationRunEvidence }
  | { ok: false; issues: Array<{ path: (string | number)[]; message: string; code: string }> } {
  const parsed = validationRunEvidenceSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, run: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code })),
  };
}

export function validateRunAgainstSnapshot(
  run: ValidationRunEvidence,
  snapshot: ValidationSnapshot,
): { ok: true } | { ok: false; reason: "SNAPSHOT_MISMATCH"; message: string } {
  const snapshotResult = validateValidationSnapshot(snapshot);
  if (!snapshotResult.ok || run.snapshotId !== snapshot.snapshotId) {
    return { ok: false, reason: "SNAPSHOT_MISMATCH", message: "run evidence does not match its immutable snapshot" };
  }
  return { ok: true };
}

export function publicationWarningForValidation(result: ValidationAggregate): ValidationWarning | undefined {
  if (result.status === "passed") {
    return undefined;
  }
  if (result.reason === "NO_PROFILE" || result.reason === "CONFIRMATION_REQUIRED" || result.reason === "INVALID_PROFILE") {
    return validationWarning(result.reason);
  }
  return {
    code: "NO_PROFILE",
    title: "Review validation before publication",
    message: `Validation result is ${result.status} and does not grant publication authority.`,
    remediation: "Inspect the recorded validation evidence and make the separate explicit publication decision.",
  };
}

export type { ValidationProfile };
