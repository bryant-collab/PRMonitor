import { z } from "zod";
import {
  canonicalPathKey,
  isPathWithin,
  statusFromExit,
  transitionStepState,
  type ExitObservation,
  type PreparedCommand,
  type RunState,
  type StepState,
  type ValidationReason,
} from "./execution.js";
import { stableIdSchema, validationPhaseSchema } from "./schema.js";
import type { ValidationPhase, ValidationProfile } from "./schema.js";
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
  "PHASE_NOT_SELECTED",
  "SNAPSHOT_MISMATCH",
  "INVALID_TRANSITION",
  "PROCESS_OUTCOME_UNCERTAIN",
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

export function recordManualAttestation(
  input: RecordManualAttestationInput,
): ManualAttestation {
  const parsed = manualAttestationSchema.safeParse({
    kind: "manual",
    ...input,
  });
  if (!parsed.success) {
    throw new TypeError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
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
  current: {
    worktreePath: string;
    baselineRevision: string;
    currentRevision: string;
  },
): boolean {
  const platform = /^[A-Za-z]:[\\/]|^\\\\/u.test(current.worktreePath)
    ? "win32"
    : "posix";
  return (
    canonicalPathKey(attestation.worktreePath, platform) ===
      canonicalPathKey(current.worktreePath, platform) &&
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
  current: {
    worktreePath: string;
    baselineRevision: string;
    currentRevision: string;
  },
): ManualAttestationView {
  return {
    label: manualOutcomeLabel(attestation.outcome),
    historical: !isManualAttestationCurrent(attestation, current),
    attestation,
  };
}

export const outputEvidenceSchema = z
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
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.safe && evidence.reason !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "safe output cannot have a failure reason",
      });
    }
    if (!evidence.safe && evidence.reason !== "REDACTION_FAILURE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "unsafe output must use reason REDACTION_FAILURE",
      });
    }
    if (evidence.truncated && evidence.truncationMarker === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truncationMarker"],
        message: "truncated output needs a marker",
      });
    }
    if (!evidence.truncated && evidence.truncationMarker !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truncationMarker"],
        message: "a truncation marker is only valid for truncated output",
      });
    }
    const expectedOmitted = Math.max(
      0,
      evidence.processedByteCount - evidence.retainedByteCount,
    );
    if (evidence.omittedByteCount !== expectedOmitted) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["omittedByteCount"],
        message:
          "omittedByteCount must equal processedByteCount minus retainedByteCount",
      });
    }
  });

export const commandStepEvidenceSchema = z
  .object({
    kind: z.literal("command"),
    stepId: stableIdSchema,
    phase: validationPhaseSchema.optional(),
    executedPhase: z.enum(["baseline", "post_change"]).optional(),
    status: z.enum([
      "pending",
      "running",
      "passed",
      "failed",
      "interrupted",
      "not_run",
    ]),
    reason: validationReasonSchema.optional(),
    startedAt: z.string().min(1).optional(),
    completedAt: z.string().min(1).optional(),
    executable: z.string().min(1),
    arguments: z.array(z.string()),
    canonicalWorkingDirectory: z.string().min(1).optional(),
    resolvedExecutable: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    outputLimitBytes: z.number().int().positive().optional(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().min(1).nullable().optional(),
    stdout: outputEvidenceSchema.optional(),
    stderr: outputEvidenceSchema.optional(),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.status === "running" && step.startedAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "running commands need startedAt",
      });
    }
    if (
      ["passed", "failed", "interrupted"].includes(step.status) &&
      step.completedAt === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "completed commands need completedAt",
      });
    }
    if (
      ["passed", "failed", "interrupted"].includes(step.status) &&
      (step.stdout === undefined || step.stderr === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stdout"],
        message: "completed commands need bounded stdout and stderr evidence",
      });
    }
    if (
      ["passed", "failed", "interrupted"].includes(step.status) &&
      step.canonicalWorkingDirectory === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalWorkingDirectory"],
        message: "executed commands need a canonical working directory",
      });
    }
    if (step.status === "passed" && step.exitCode !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exitCode"],
        message: "passed commands need observed exit code 0",
      });
    }
    if (step.status === "passed" && step.reason !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "passed commands cannot have a failure reason",
      });
    }
    if (step.status === "failed" && step.reason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "failed commands need a machine-readable reason",
      });
    }
    if (
      step.status === "interrupted" &&
      ![
        "TIMED_OUT",
        "USER_CANCELLED",
        "APPLICATION_SHUTDOWN",
        "APPLICATION_RESTARTED",
        "PROCESS_OUTCOME_UNCERTAIN",
      ].includes(step.reason ?? "")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message:
          "interrupted commands need a timeout, cancellation, shutdown, or restart reason",
      });
    }
    if (step.status === "not_run" && step.reason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "not-run commands need a machine-readable reason",
      });
    }
  });

export const manualStepEvidenceSchema = z
  .object({
    kind: z.literal("manual"),
    stepId: stableIdSchema,
    phase: validationPhaseSchema.optional(),
    executedPhase: z.enum(["baseline", "post_change"]).optional(),
    status: z.enum(["pending", "passed", "failed", "not_run"]),
    reason: validationReasonSchema.optional(),
    attestation: manualAttestationSchema.optional(),
  })
  .strict()
  .superRefine((step, context) => {
    if (
      step.attestation !== undefined &&
      step.attestation.checkId !== step.stepId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attestation", "checkId"],
        message: "manual attestation checkId must match stepId",
      });
    }
    if (step.status === "passed" && step.attestation?.outcome !== "verified") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attestation"],
        message: "verified manual steps need a verified attestation",
      });
    }
    if (step.status === "failed" && step.attestation?.outcome !== "failed") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attestation"],
        message: "failed manual steps need a failed attestation",
      });
    }
    if (
      step.status === "not_run" &&
      step.attestation !== undefined &&
      step.attestation.outcome !== "not_run"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attestation"],
        message: "not-run manual steps need a not-run attestation",
      });
    }
  });

// Refinements wrap each object in ZodEffects, so use a tagged union without
// the discriminated-union helper here. The `kind` literals remain the runtime
// discriminator while preserving the cross-field invariants above.
export const validationStepEvidenceSchema = z.union([
  commandStepEvidenceSchema,
  manualStepEvidenceSchema,
]);

export type CommandStepEvidence = z.infer<typeof commandStepEvidenceSchema>;
export type ManualStepEvidence = z.infer<typeof manualStepEvidenceSchema>;
export type ValidationStepEvidence = z.infer<
  typeof validationStepEvidenceSchema
>;

export const validationWarningSchema = z
  .object({
    code: z.enum([
      "NO_PROFILE",
      "CONFIRMATION_REQUIRED",
      "INVALID_PROFILE",
      "VALIDATION_REVIEW_REQUIRED",
    ]),
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
    phase: validationPhaseSchema.optional(),
    status: z.enum(["running", "passed", "failed", "interrupted", "not_run"]),
    reason: validationReasonSchema.optional(),
    startedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
    steps: z.array(validationStepEvidenceSchema),
    manualAttestations: z.array(manualAttestationSchema),
    warnings: z.array(validationWarningSchema),
  })
  .strict()
  .superRefine((run, context) => {
    const seen = new Set<string>();
    run.steps.forEach((step, index) => {
      if (seen.has(step.stepId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "stepId"],
          message: "step IDs must be unique",
        });
      }
      seen.add(step.stepId);
    });
    const manualIds = new Set<string>();
    run.manualAttestations.forEach((attestation, index) => {
      if (manualIds.has(attestation.checkId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manualAttestations", index, "checkId"],
          message: "manual attestation check IDs must be unique",
        });
      }
      manualIds.add(attestation.checkId);
    });

    const terminal = run.status !== "running";
    if (terminal && run.completedAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "completed runs need completedAt",
      });
    }
    if (run.status === "running" && run.completedAt !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "running runs cannot have completedAt",
      });
    }
    if (
      run.status === "passed" &&
      run.steps.some((step) => step.status !== "passed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "passed runs need every step to be passed",
      });
    }
    if (
      run.status === "failed" &&
      !run.steps.some((step) => step.status === "failed")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "failed runs need a failed step",
      });
    }
    if (
      run.status === "interrupted" &&
      !run.steps.some((step) => step.status === "interrupted") &&
      run.reason !== "APPLICATION_RESTARTED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "interrupted runs need an interrupted step",
      });
    }
    if (
      run.status === "not_run" &&
      run.steps.length > 0 &&
      !run.steps.some((step) => step.status === "not_run")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "not-run runs need a not-run step",
      });
    }
    if (
      terminal &&
      run.steps.some(
        (step) => step.status === "pending" || step.status === "running",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "completed runs cannot contain pending or running steps",
      });
    }
    if (terminal) {
      let stopped = false;
      run.steps.forEach((step, index) => {
        if (stopped && step.status !== "not_run") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "status"],
            message:
              "steps after the first failed, interrupted, or skipped step must be not_run",
          });
        }
        if (
          step.status === "failed" ||
          step.status === "interrupted" ||
          (step.status === "not_run" && step.reason !== "PHASE_NOT_SELECTED")
        ) {
          stopped = true;
        }
      });
    }
  });

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
  const phases = new Set(
    input.snapshot.profile.steps.map((step) => step.phase ?? "post_change"),
  );
  const phase: ValidationPhase = phases.size === 1 ? [...phases][0]! : "both";
  const steps: ValidationStepEvidence[] = input.snapshot.profile.steps.map(
    (step) => {
      if (step.kind === "command") {
        return {
          kind: "command",
          stepId: step.id,
          phase: step.phase ?? "post_change",
          status: "pending",
          executable: step.executable,
          arguments: [...step.arguments],
        };
      }
      return {
        kind: "manual",
        stepId: step.id,
        phase: step.phase ?? "post_change",
        status: "pending",
      };
    },
  );
  return {
    recordType: "validation-run",
    schemaVersion: 1,
    runId: input.runId,
    snapshotId: input.snapshot.snapshotId,
    phase,
    status: "running",
    startedAt: input.startedAt,
    steps,
    manualAttestations: [],
    warnings: [],
  };
}

/**
 * A profile step tagged `both` is eligible in either phase.  F14 uses this
 * helper when it creates separate baseline and post-change evidence sets so
 * that the phase policy is shared rather than reimplemented by a consumer.
 */
export function isValidationStepEligible(
  step: ValidationProfile["steps"][number],
  requestedPhase: "baseline" | "post_change",
): boolean {
  const configuredPhase = step.phase ?? "post_change";
  return configuredPhase === "both" || configuredPhase === requestedPhase;
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
  const reason: ValidationReason | undefined = outputFailed
    ? "REDACTION_FAILURE"
    : exit.reason;
  const evidence: CommandStepEvidence = {
    kind: "command",
    stepId: input.prepared.stepId,
    phase: input.prepared.phase ?? "post_change",
    status,
    ...(reason === undefined ? {} : { reason }),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    executable: input.prepared.executable,
    arguments: [...input.prepared.arguments],
    canonicalWorkingDirectory: input.prepared.canonicalWorkingDirectory,
    resolvedExecutable: input.prepared.resolvedExecutable,
    timeoutSeconds: input.prepared.timeoutSeconds,
    outputLimitBytes: input.prepared.outputLimitBytes,
    ...(input.observation.exitCode === undefined
      ? {}
      : { exitCode: input.observation.exitCode }),
    ...(input.observation.signal === undefined
      ? {}
      : { signal: input.observation.signal }),
    stdout,
    stderr,
  };
  const parsed = commandStepEvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    throw new TypeError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
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

export interface AggregateValidationEvidenceInput {
  automated: readonly CommandStepEvidence[];
  manual?: readonly ManualAttestation[];
  unavailableReason?:
    "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE";
}

export function aggregateValidationEvidence(
  input: AggregateValidationEvidenceInput,
): ValidationAggregate {
  const automated = input.automated.map((step) => ({ ...step }));
  const manual = [...(input.manual ?? [])];
  const warnings: ValidationWarning[] = [];
  if (input.unavailableReason !== undefined) {
    warnings.push(validationWarning(input.unavailableReason));
    return {
      status: "not_run",
      reason: input.unavailableReason,
      automated,
      manual,
      warnings,
    };
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
  if (
    automated.some(
      (step) => step.stdout?.safe === false || step.stderr?.safe === false,
    )
  ) {
    return {
      status: "failed",
      reason: "REDACTION_FAILURE",
      automated,
      manual,
      warnings,
    };
  }
  if (automated.some((step) => step.status === "interrupted")) {
    const interrupted = automated.find((step) => step.status === "interrupted");
    const interruptedReason = interrupted?.reason;
    const reason: ValidationReason =
      interruptedReason === "USER_CANCELLED" ||
      interruptedReason === "APPLICATION_SHUTDOWN" ||
      interruptedReason === "APPLICATION_RESTARTED" ||
      interruptedReason === "TIMED_OUT" ||
      interruptedReason === "PROCESS_OUTCOME_UNCERTAIN"
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
  if (
    automated.some(
      (step) =>
        step.status === "not_run" ||
        step.status === "pending" ||
        step.status === "running",
    )
  ) {
    return {
      status: "not_run",
      reason: "PRIOR_STEP_STOPPED",
      automated,
      manual,
      warnings,
    };
  }
  if (manual.some((attestation) => attestation.outcome === "failed")) {
    return {
      status: "failed",
      reason: "MANUAL_CHECK_FAILED",
      automated,
      manual,
      warnings,
    };
  }
  if (manual.some((attestation) => attestation.outcome === "not_run")) {
    return {
      status: "not_run",
      reason: "MANUAL_CHECK_NOT_RUN",
      automated,
      manual,
      warnings,
    };
  }
  return { status: "passed", automated, manual, warnings };
}

export function completeValidationRun(input: {
  run: ValidationRunEvidence;
  steps: readonly ValidationStepEvidence[];
  completedAt: string;
  manualAttestations?: readonly ManualAttestation[];
  unavailableReason?:
    "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE";
}): ValidationRunEvidence {
  if (input.run.status !== "running") {
    throw new TypeError("only a running validation run can be completed");
  }
  if (
    input.steps.length !== input.run.steps.length ||
    input.steps.some(
      (step, index) =>
        step.kind !== input.run.steps[index]?.kind ||
        step.stepId !== input.run.steps[index]?.stepId,
    )
  ) {
    throw new TypeError(
      "completed validation steps must preserve the running run's ordered step identity",
    );
  }
  const manualAttestations = [...(input.manualAttestations ?? [])];
  const manualStepIds = new Set(
    input.steps
      .filter((step) => step.kind === "manual")
      .map((step) => step.stepId),
  );
  if (
    manualAttestations.some(
      (attestation) => !manualStepIds.has(attestation.checkId),
    )
  ) {
    throw new TypeError(
      "manual attestations must belong to a manual validation step",
    );
  }
  const attestationsByCheckId = new Map(
    manualAttestations.map(
      (attestation) => [attestation.checkId, attestation] as const,
    ),
  );
  const steps = input.steps.map((step): ValidationStepEvidence => {
    if (step.kind !== "manual") {
      return { ...step };
    }
    const attestation = attestationsByCheckId.get(step.stepId);
    if (attestation === undefined) {
      return { ...step };
    }
    const status =
      attestation.outcome === "verified"
        ? "passed"
        : attestation.outcome === "failed"
          ? "failed"
          : "not_run";
    return {
      ...step,
      status,
      attestation,
      ...(status === "not_run" && step.reason === undefined
        ? { reason: "MANUAL_CHECK_NOT_RUN" as const }
        : {}),
    };
  });
  const automated = steps.filter(
    (step): step is CommandStepEvidence => step.kind === "command",
  );
  const aggregate = aggregateValidationEvidence({
    automated,
    manual: manualAttestations,
    unavailableReason: input.unavailableReason,
  });
  let completedSteps = steps;
  if (input.unavailableReason !== undefined) {
    completedSteps = steps.map((step) =>
      step.status === "pending" || step.status === "running"
        ? {
            ...step,
            status: "not_run" as const,
            reason: input.unavailableReason,
          }
        : { ...step },
    );
  } else {
    const firstIncomplete = steps.findIndex(
      (step) => step.status === "pending" || step.status === "running",
    );
    if (firstIncomplete >= 0) {
      const incomplete = steps[firstIncomplete];
      if (incomplete?.status === "running") {
        throw new TypeError(
          "a running step must be interrupted or completed before the validation run can close",
        );
      }
      completedSteps = steps.map((step, index) => {
        if (index < firstIncomplete || index > firstIncomplete) {
          return { ...step };
        }
        return {
          ...step,
          status: "not_run" as const,
          reason:
            step.kind === "manual"
              ? ("MANUAL_CHECK_NOT_RUN" as const)
              : ("PRIOR_STEP_STOPPED" as const),
        };
      });
      completedSteps = stopRemainingSteps(completedSteps, firstIncomplete);
    }
  }
  const hasUnattestedManualStep = completedSteps.some(
    (step) =>
      step.kind === "manual" &&
      (step.status === "pending" || step.status === "not_run"),
  );
  const finalStatus =
    aggregate.status === "passed" && hasUnattestedManualStep
      ? "not_run"
      : aggregate.status;
  const finalReason =
    aggregate.status === "passed" && hasUnattestedManualStep
      ? ("MANUAL_CHECK_NOT_RUN" as const)
      : aggregate.reason;
  const completed: ValidationRunEvidence = {
    ...input.run,
    status: finalStatus,
    ...(finalReason === undefined ? {} : { reason: finalReason }),
    completedAt: input.completedAt,
    steps: completedSteps,
    manualAttestations: aggregate.manual,
    warnings: aggregate.warnings,
  };
  const parsed = validationRunEvidenceSchema.safeParse(completed);
  if (!parsed.success) {
    throw new TypeError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

export function finalizeIncompleteValidationRun(
  run: ValidationRunEvidence,
  completedAt: string,
): ValidationRunEvidence {
  if (run.status !== "running") {
    return run;
  }
  const firstRunning = run.steps.findIndex((step) => step.status === "running");
  const steps: ValidationStepEvidence[] = run.steps.map(
    (step, index): ValidationStepEvidence => {
      if (step.status === "running") {
        return {
          ...step,
          status: "interrupted",
          reason: "APPLICATION_RESTARTED",
          completedAt,
          stdout: step.stdout ?? emptyOutput(),
          stderr: step.stderr ?? emptyOutput(),
        };
      }
      if (index > firstRunning && step.status === "pending") {
        return { ...step, status: "not_run", reason: "PRIOR_STEP_STOPPED" };
      }
      return { ...step };
    },
  );
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
  | {
      ok: false;
      issues: Array<{
        path: (string | number)[];
        message: string;
        code: string;
      }>;
    } {
  const parsed = validationRunEvidenceSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, run: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    })),
  };
}

export function validateRunAgainstSnapshot(
  run: ValidationRunEvidence,
  snapshot: ValidationSnapshot,
): { ok: true } | { ok: false; reason: "SNAPSHOT_MISMATCH"; message: string } {
  const snapshotResult = validateValidationSnapshot(snapshot);
  const runResult = validationRunEvidenceSchema.safeParse(run);
  if (
    !snapshotResult.ok ||
    !runResult.success ||
    run.snapshotId !== snapshot.snapshotId
  ) {
    return {
      ok: false,
      reason: "SNAPSHOT_MISMATCH",
      message: "run evidence does not match its immutable snapshot",
    };
  }

  const expectedSteps = snapshotResult.snapshot.profile.steps;
  if (runResult.data.steps.length !== expectedSteps.length) {
    return {
      ok: false,
      reason: "SNAPSHOT_MISMATCH",
      message: "run step count does not match its immutable profile",
    };
  }
  for (const [index, expected] of expectedSteps.entries()) {
    const actual = runResult.data.steps[index];
    if (
      actual === undefined ||
      actual.kind !== expected.kind ||
      actual.stepId !== expected.id
    ) {
      return {
        ok: false,
        reason: "SNAPSHOT_MISMATCH",
        message: "run step identity does not match its immutable profile",
      };
    }
    if (expected.kind === "command" && actual.kind === "command") {
      if (
        actual.executable !== expected.executable ||
        JSON.stringify(actual.arguments) !== JSON.stringify(expected.arguments)
      ) {
        return {
          ok: false,
          reason: "SNAPSHOT_MISMATCH",
          message: "run command input does not match its immutable profile",
        };
      }
      if (
        actual.canonicalWorkingDirectory !== undefined &&
        !isPathWithin(
          snapshotResult.snapshot.worktree.canonicalRoot,
          actual.canonicalWorkingDirectory,
          {
            platform: /^[A-Za-z]:[\\/]|^\\\\/u.test(
              snapshotResult.snapshot.worktree.canonicalRoot,
            )
              ? "win32"
              : "posix",
          },
        )
      ) {
        return {
          ok: false,
          reason: "SNAPSHOT_MISMATCH",
          message: "run working directory is outside its immutable worktree",
        };
      }
    }
  }
  const manualIds = new Set(
    expectedSteps
      .filter((step) => step.kind === "manual")
      .map((step) => step.id),
  );
  const platform = /^[A-Za-z]:[\\/]|^\\\\/u.test(
    snapshotResult.snapshot.worktree.canonicalRoot,
  )
    ? "win32"
    : "posix";
  if (
    runResult.data.manualAttestations.some(
      (attestation) =>
        !manualIds.has(attestation.checkId) ||
        canonicalPathKey(attestation.worktreePath, platform) !==
          canonicalPathKey(
            snapshotResult.snapshot.worktree.canonicalRoot,
            platform,
          ) ||
        attestation.worktreeBaselineRevision !==
          snapshotResult.snapshot.worktree.baselineRevision ||
        (snapshotResult.snapshot.worktree.currentRevision !== undefined &&
          attestation.worktreeCurrentRevision !==
            snapshotResult.snapshot.worktree.currentRevision),
    )
  ) {
    return {
      ok: false,
      reason: "SNAPSHOT_MISMATCH",
      message: "manual evidence does not match the immutable worktree state",
    };
  }
  return { ok: true };
}

export function publicationWarningForValidation(
  result: ValidationAggregate,
): ValidationWarning | undefined {
  if (result.status === "passed") {
    return undefined;
  }
  if (
    result.reason === "NO_PROFILE" ||
    result.reason === "CONFIRMATION_REQUIRED" ||
    result.reason === "INVALID_PROFILE"
  ) {
    return validationWarning(result.reason);
  }
  return validationWarning("VALIDATION_REVIEW_REQUIRED", {
    status: result.status,
    reason: result.reason,
  });
}

export type { ValidationProfile };
