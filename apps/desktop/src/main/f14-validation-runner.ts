import { randomUUID, createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  createCommandStepEvidence,
  createInitialValidationRun,
  createValidationSnapshot,
  createValidationConsumer,
  isValidationStepEligible,
  aggregateValidationEvidence,
  publicationWarningForValidation,
  recordManualAttestation as createManualAttestation,
  terminateProcessTree,
  validateValidationSnapshot,
  validationWarning,
  type CommandStepEvidence,
  type ExitObservation,
  type ManualAttestation,
  type PreparedCommand,
  type ProcessControlPort,
  type ValidationPhase,
  type ValidationProcessHandle,
  type ValidationResolution,
  type ValidationRunEvidence,
  type ValidationSnapshot,
  type ValidationStepEvidence,
  type ValidationWarning,
  type ValidationRunnerPort,
  type ValidationConsumer,
} from "@prmonitor/validation-contract";
import {
  StreamAccumulator,
  prepareCommand,
} from "@prmonitor/validation-contract";
import type {
  F13InspectionResult,
  F13SnapshotPhase,
} from "../shared/f13-contracts";
import type { ActivityWriter } from "./activity-service";
import type {
  F14ValidationRepositories,
  F14Consumer,
  F14ValidationRunRecord,
} from "./persistence/f14-repositories";

const execFileAsync = promisify(execFile);

export interface F14Clock {
  readonly now: () => string;
  readonly wait: (milliseconds: number) => Promise<void>;
}

export interface F14TimerPort {
  readonly setTimeout: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface F14WorktreeInspectionPort {
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?: F13SnapshotPhase,
  ) => Promise<F13InspectionResult>;
}

export interface F14ChildProcessLike {
  readonly pid?: number;
  readonly stdout?: AsyncIterable<Uint8Array> | null;
  readonly stderr?: AsyncIterable<Uint8Array> | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export interface F14SpawnPort {
  readonly spawn: (
    executable: string,
    arguments_: readonly string[],
    options: {
      readonly cwd: string;
      readonly env: Record<string, string>;
      readonly shell: false;
      readonly windowsHide: true;
      readonly detached: boolean;
      readonly stdio: readonly ["ignore", "pipe", "pipe"];
    },
  ) => F14ChildProcessLike;
}

export interface F14ValidationRequest {
  readonly operationId: string;
  readonly runId?: string;
  readonly idempotencyKey?: string;
  readonly correlationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly consumer: F14Consumer;
  readonly requestedPhase: ValidationPhase;
  readonly resolution: ValidationResolution;
  readonly snapshot?: Readonly<ValidationSnapshot>;
  readonly signal?: AbortSignal;
}

export interface F14ManualAttestationRequest {
  readonly runId: string;
  readonly ownerId: string;
  readonly checkId: string;
  readonly outcome: "verified" | "failed" | "not_run";
  readonly attestedBy?: string;
  readonly notes?: string;
}

export interface F14ValidationExecutionResult {
  readonly ok: boolean;
  readonly completed: boolean;
  readonly record: F14ValidationRunRecord;
  readonly run: ValidationRunEvidence;
  readonly linkedRuns?: readonly F14ValidationRunRecord[];
}

export interface F14ValidationReadModel {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly operationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly consumer: F14Consumer;
  readonly requestedPhase: ValidationPhase;
  readonly status: ValidationRunEvidence["status"];
  readonly reason?: ValidationRunEvidence["reason"];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly snapshot?: {
    readonly snapshotId: string;
    readonly source: ValidationSnapshot["source"];
    readonly repositoryId: string;
    readonly contentHash: string;
    readonly worktreePath: string;
    readonly baselineRevision: string;
    readonly currentRevision?: string;
  };
  readonly steps: readonly {
    readonly stepId: string;
    readonly kind: ValidationStepEvidence["kind"];
    readonly configuredPhase?: ValidationPhase;
    readonly executedPhase?: "baseline" | "post_change";
    readonly status: ValidationStepEvidence["status"];
    readonly reason?: ValidationStepEvidence["reason"];
    readonly executable?: string;
    readonly arguments?: readonly string[];
    readonly canonicalWorkingDirectory?: string;
    readonly resolvedExecutable?: string;
    readonly timeoutSeconds?: number;
    readonly outputLimitBytes?: number;
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly exitCode?: number | null;
    readonly signal?: string | null;
    readonly stdout?: CommandStepEvidence["stdout"];
    readonly stderr?: CommandStepEvidence["stderr"];
    readonly manualLabel?: string;
  }[];
  readonly manualAttestations: readonly ManualAttestation[];
  readonly warnings: readonly ValidationWarning[];
  readonly nextAction: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function defaultClock(): F14Clock {
  return {
    now: () => new Date().toISOString(),
    wait: (milliseconds) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
  };
}

function defaultTimer(): F14TimerPort {
  return {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  };
}

function emptyOutput(): CommandStepEvidence["stdout"] {
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

function unsafeOutput(): CommandStepEvidence["stdout"] {
  return {
    text: "",
    originalByteCount: 0,
    processedByteCount: 0,
    retainedByteCount: 0,
    omittedByteCount: 0,
    truncated: false,
    redacted: false,
    safe: false,
    reason: "REDACTION_FAILURE",
  };
}

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeDerivedId(prefix: string, value: string): string {
  return `${prefix}-${sha(value).slice(0, 32)}`;
}

function safeNextAction(
  status: ValidationRunEvidence["status"],
  reason?: ValidationRunEvidence["reason"],
): string {
  if (
    reason === "NO_PROFILE" ||
    reason === "CONFIRMATION_REQUIRED" ||
    reason === "INVALID_PROFILE"
  ) {
    return "CONFIGURE_VALIDATION_PROFILE";
  }
  if (status === "running") return "WAIT_FOR_VALIDATION";
  if (status === "passed") return "REVIEW_VALIDATION";
  return "REVIEW_VALIDATION_EVIDENCE";
}

function reasonForResolution(
  resolution: Exclude<ValidationResolution, { status: "ready" }>,
): "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE" {
  switch (resolution.status) {
    case "unavailable":
      return "NO_PROFILE";
    case "confirmation_required":
      return "CONFIRMATION_REQUIRED";
    case "invalid":
      return "INVALID_PROFILE";
  }
  return "INVALID_PROFILE";
}

function noRunEvidence(input: {
  runId: string;
  startedAt: string;
  completedAt?: string;
  requestedPhase: ValidationPhase;
  reason: ValidationRunEvidence["reason"];
  warning: ValidationWarning;
  snapshotId?: string;
}): ValidationRunEvidence {
  return {
    recordType: "validation-run",
    schemaVersion: 1,
    runId: input.runId,
    ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
    phase: input.requestedPhase,
    status: "not_run",
    reason: input.reason,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? input.startedAt,
    steps: [],
    manualAttestations: [],
    warnings: [input.warning],
  };
}

function processTreeId(child: F14ChildProcessLike): string {
  return child.pid === undefined
    ? `f14-process-${randomUUID()}`
    : String(child.pid);
}

async function* emptyStream(): AsyncIterable<Uint8Array> {
  // The explicit generator keeps the process boundary uniform for start
  // failures where Node has not created stdout/stderr streams.
}

export class StructuredValidationRunner implements ValidationRunnerPort<string> {
  private readonly spawnPort: F14SpawnPort;

  public constructor(options: { readonly spawn?: F14SpawnPort["spawn"] } = {}) {
    this.spawnPort = {
      spawn:
        options.spawn ??
        ((executable, arguments_, spawnOptions) =>
          spawn(executable, [...arguments_], {
            cwd: spawnOptions.cwd,
            env: spawnOptions.env,
            shell: false,
            windowsHide: true,
            detached: spawnOptions.detached,
            stdio: ["ignore", "pipe", "pipe"],
          }) as unknown as ChildProcess),
    };
  }

  public async start(input: {
    readonly snapshot: Readonly<ValidationSnapshot>;
    readonly command: PreparedCommand;
  }): Promise<ValidationProcessHandle<string>> {
    if (input.command.shell !== false)
      throw new Error("F14_SHELL_EXECUTION_MUST_BE_DISABLED");
    if (input.command.canonicalWorkingDirectory.length === 0)
      throw new Error("F14_WORKING_DIRECTORY_REQUIRED");
    const child = this.spawnPort.spawn(
      input.command.resolvedExecutable,
      input.command.arguments,
      {
        cwd: input.command.canonicalWorkingDirectory,
        env: { ...input.command.environment },
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let settled = false;
    const wait = new Promise<ExitObservation>((resolve) => {
      child.once("error", () => {
        if (settled) return;
        settled = true;
        resolve({ startError: true });
      });
      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode: code, signal });
      });
    });
    return {
      processTree: processTreeId(child),
      stdout: child.stdout ?? emptyStream(),
      stderr: child.stderr ?? emptyStream(),
      wait: () => wait,
    };
  }
}

export class NodeProcessControl implements ProcessControlPort<string> {
  private readonly platform: "win32" | "posix";

  public constructor(
    platform: "win32" | "posix" = process.platform === "win32"
      ? "win32"
      : "posix",
  ) {
    this.platform = platform;
  }

  public async requestGracefulTermination(processTree: string): Promise<void> {
    if (this.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", processTree, "/T"]).catch(
        () => undefined,
      );
      return;
    }
    const pid = Number(processTree);
    if (!Number.isInteger(pid) || pid <= 0) return;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // The process may have exited between observation and termination.
      }
    }
  }

  public async listSurvivingProcesses(
    processTree: string,
  ): Promise<readonly string[]> {
    const pid = Number(processTree);
    if (!Number.isInteger(pid) || pid <= 0) return [];
    try {
      process.kill(pid, 0);
      return [processTree];
    } catch {
      return [];
    }
  }

  public async forceTerminate(processes: readonly string[]): Promise<void> {
    for (const processTree of processes) {
      if (this.platform === "win32") {
        await execFileAsync("taskkill", [
          "/PID",
          processTree,
          "/T",
          "/F",
        ]).catch(() => undefined);
        continue;
      }
      const pid = Number(processTree);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
    }
  }
}

export interface F14ValidationRunnerOptions {
  readonly repositories: F14ValidationRepositories;
  readonly worktrees: F14WorktreeInspectionPort;
  readonly runner?: ValidationRunnerPort<string>;
  readonly processControl?: ProcessControlPort<string>;
  readonly clock?: F14Clock;
  readonly timer?: F14TimerPort;
  readonly platform?: "posix" | "win32";
  readonly environment?: Record<string, string | undefined>;
  readonly toolchainEnvironment?: Record<string, string | undefined>;
  readonly allowedEnvironmentKeys?: readonly string[];
  readonly knownSecrets?: readonly string[];
  readonly activity?: Pick<ActivityWriter, "append">;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly finished: Promise<void>;
  readonly resolveFinished: () => void;
}

export class ValidationRunService {
  private readonly runner: ValidationRunnerPort<string>;
  private readonly processControl: ProcessControlPort<string>;
  private readonly clock: F14Clock;
  private readonly timer: F14TimerPort;
  private readonly platform?: "posix" | "win32";
  private readonly environment: Record<string, string | undefined>;
  private readonly toolchainEnvironment: Record<string, string | undefined>;
  private readonly allowedEnvironmentKeys?: readonly string[];
  private readonly knownSecrets: readonly string[];
  private readonly active = new Map<string, ActiveRun>();

  public constructor(private readonly options: F14ValidationRunnerOptions) {
    this.runner = options.runner ?? new StructuredValidationRunner();
    this.processControl =
      options.processControl ?? new NodeProcessControl(options.platform);
    this.clock = options.clock ?? defaultClock();
    this.timer = options.timer ?? defaultTimer();
    this.platform = options.platform;
    this.environment = options.environment ?? process.env;
    this.toolchainEnvironment = options.toolchainEnvironment ?? process.env;
    this.allowedEnvironmentKeys = options.allowedEnvironmentKeys;
    this.knownSecrets = [...(options.knownSecrets ?? [])];
  }

  public async run(
    input: F14ValidationRequest,
  ): Promise<F14ValidationExecutionResult> {
    if (
      input.requestedPhase === "both" &&
      input.resolution.status === "ready"
    ) {
      const base =
        input.runId ??
        safeDerivedId("f14-run", `${input.operationId}:${input.correlationId}`);
      const key = input.idempotencyKey ?? safeDerivedId("f14-key", base);
      const baseline = await this.executeSingle({
        ...input,
        runId: `${base}-baseline`,
        idempotencyKey: `${key}-baseline`,
        requestedPhase: "baseline",
        snapshot: undefined,
      });
      const postChange = await this.executeSingle({
        ...input,
        runId: `${base}-post-change`,
        idempotencyKey: `${key}-post-change`,
        requestedPhase: "post_change",
        snapshot: undefined,
      });
      return {
        ...postChange,
        linkedRuns: [baseline.record, postChange.record],
      };
    }
    return this.executeSingle(input);
  }

  public async execute(
    input: F14ValidationRequest,
  ): Promise<F14ValidationExecutionResult> {
    return this.run(input);
  }

  public async start(
    input: F14ValidationRequest,
  ): Promise<F14ValidationExecutionResult> {
    return this.run(input);
  }

  public read(runId: string): F14ValidationRunRecord | undefined {
    return this.options.repositories.getRun(runId);
  }

  public readModel(runId: string): F14ValidationReadModel | undefined {
    const record = this.read(runId);
    return record === undefined ? undefined : toF14ValidationReadModel(record);
  }

  public list(operationId?: string): readonly F14ValidationReadModel[] {
    return this.options.repositories
      .listRuns(operationId)
      .map(toF14ValidationReadModel);
  }

  public cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (active === undefined) return false;
    active.controller.abort("USER_CANCELLED");
    return true;
  }

  public async shutdown(): Promise<void> {
    const activeRuns = [...this.active.values()];
    for (const active of activeRuns) {
      active.controller.abort("APPLICATION_SHUTDOWN");
    }
    await Promise.allSettled(activeRuns.map((active) => active.finished));
  }

  public rendererClosed(): void {
    // Renderer lifetime is intentionally unrelated to main-process validation.
  }

  public consumerContract(kind: F14Consumer): ValidationConsumer {
    return createValidationConsumer(kind);
  }

  public async reconcileStartup(): Promise<readonly F14ValidationRunRecord[]> {
    const recovered: F14ValidationRunRecord[] = [];
    for (const record of this.options.repositories.listRunning()) {
      const evidence = restartEvidence(record.evidence, this.clock.now());
      const updated = this.options.repositories.updateRun({
        runId: record.runId,
        evidence,
        nextAction: "REVIEW_VALIDATION_EVIDENCE",
        expectedVersion: record.version,
      });
      recovered.push(updated);
      this.emit(
        updated,
        "VALIDATION_FAILED",
        "VALIDATION_FAILED",
        "Application restart interrupted validation.",
      );
    }
    return recovered;
  }

  public async recordManualAttestation(
    input: F14ManualAttestationRequest,
  ): Promise<F14ValidationExecutionResult> {
    const record = this.options.repositories.getRun(input.runId);
    if (record === undefined) throw new Error("F14_VALIDATION_RUN_NOT_FOUND");
    if (record.ownerId !== input.ownerId)
      throw new Error("F14_VALIDATION_OWNER_CONFLICT");
    if (record.snapshot === undefined)
      throw new Error("F14_MANUAL_ATTESTATION_NEEDS_SNAPSHOT");
    const manualIndex = record.evidence.steps.findIndex(
      (step) =>
        step.kind === "manual" &&
        step.stepId === input.checkId &&
        step.executedPhase !== undefined,
    );
    if (manualIndex < 0) throw new Error("F14_MANUAL_CHECK_NOT_SELECTED");

    const inspection = await this.options.worktrees.inspectOperation(
      record.operationId,
      record.ownerId,
      "INSPECTION",
    );
    if (!inspection.ok || inspection.snapshot === undefined)
      throw new Error("F14_WORKTREE_INSPECTION_FAILED");
    const currentRevision =
      inspection.snapshot.manifest.headSha ??
      inspection.worktree.currentHeadSha;
    if (
      currentRevision === undefined ||
      currentRevision !== record.snapshot.worktree.currentRevision
    ) {
      throw new Error("F14_WORKTREE_REVISION_CHANGED");
    }
    const attestation = createManualAttestation({
      checkId: input.checkId,
      outcome: input.outcome,
      timestamp: this.clock.now(),
      worktreePath: record.snapshot.worktree.canonicalRoot,
      worktreeBaselineRevision: record.snapshot.worktree.baselineRevision,
      worktreeCurrentRevision: currentRevision,
      ...(input.attestedBy === undefined
        ? {}
        : { attestedBy: input.attestedBy }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    const steps = record.evidence.steps.map((step, index) => {
      if (index !== manualIndex || step.kind !== "manual") return { ...step };
      if (attestation.outcome === "verified") {
        const { reason: _reason, ...withoutReason } = step;
        return {
          ...withoutReason,
          status: "passed" as const,
          attestation,
        };
      }
      if (attestation.outcome === "failed")
        return {
          ...step,
          status: "failed" as const,
          attestation,
          reason: "MANUAL_CHECK_FAILED" as const,
        };
      return {
        ...step,
        status: "not_run" as const,
        attestation,
        reason: "MANUAL_CHECK_NOT_RUN" as const,
      };
    });
    const manualAttestations = [
      ...record.evidence.manualAttestations.filter(
        (existing) => existing.checkId !== input.checkId,
      ),
      attestation,
    ];
    const evidence = completeEvidence({
      run: { ...record.evidence, steps },
      requestedPhase: record.requestedPhase,
      completedAt: this.clock.now(),
      manualAttestations,
    });
    const updated = this.options.repositories.updateManualAttestation({
      runId: record.runId,
      attestation,
      evidence,
      nextAction: safeNextAction(evidence.status, evidence.reason),
      expectedVersion: record.version,
    });
    this.emit(
      updated,
      updated.status === "passed"
        ? "VALIDATION_COMPLETED"
        : "VALIDATION_FAILED",
      updated.status === "passed"
        ? "VALIDATION_COMPLETED"
        : "VALIDATION_FAILED",
      "A manual validation attestation was recorded.",
    );
    return this.result(updated);
  }

  private async executeSingle(
    input: F14ValidationRequest,
  ): Promise<F14ValidationExecutionResult> {
    const runId =
      input.runId ??
      safeDerivedId(
        "f14-run",
        `${input.operationId}:${input.correlationId}:${input.requestedPhase}`,
      );
    const idempotencyKey =
      input.idempotencyKey ?? safeDerivedId("f14-key", runId);
    const existing =
      this.options.repositories.getRun(runId) ??
      this.options.repositories.getRunByIdempotencyKey(idempotencyKey);
    if (existing !== undefined) return this.result(existing);
    const startedAt = this.clock.now();

    if (input.resolution.status !== "ready") {
      const reason = reasonForResolution(input.resolution);
      const evidence = noRunEvidence({
        runId,
        startedAt,
        requestedPhase: input.requestedPhase,
        reason,
        warning: input.resolution.warning,
      });
      const saved = this.options.repositories.saveRunIntent({
        runId,
        operationId: input.operationId,
        idempotencyKey,
        correlationId: input.correlationId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        consumer: input.consumer,
        requestedPhase: input.requestedPhase,
        resolutionStatus: input.resolution.status,
        evidence,
        nextAction: safeNextAction(evidence.status, evidence.reason),
      });
      this.emit(
        saved.record,
        "VALIDATION_COMPLETED",
        "VALIDATION_COMPLETED",
        "Validation was not run because no safe authorized profile was available.",
      );
      return this.result(saved.record);
    }

    const inspection = await this.options.worktrees.inspectOperation(
      input.operationId,
      input.ownerId,
      "INSPECTION",
    );
    if (!inspection.ok || inspection.snapshot === undefined) {
      const reason =
        inspection.reason?.code === "WORKTREE_HEAD_MOVED"
          ? "SNAPSHOT_MISMATCH"
          : "WORKTREE_PATH_INVALID";
      const evidence = noRunEvidence({
        runId,
        startedAt,
        requestedPhase: input.requestedPhase,
        reason,
        warning: validationWarning("VALIDATION_REVIEW_REQUIRED", {
          status: "not_run",
          reason,
        }),
      });
      const saved = this.options.repositories.saveRunIntent({
        runId,
        operationId: input.operationId,
        idempotencyKey,
        correlationId: input.correlationId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        consumer: input.consumer,
        requestedPhase: input.requestedPhase,
        resolutionStatus: input.resolution.status,
        evidence,
        nextAction: "RECONCILE_WORKTREE",
      });
      this.emit(
        saved.record,
        "VALIDATION_FAILED",
        "VALIDATION_FAILED",
        "Validation was not run because the operation worktree could not be revalidated.",
      );
      return this.result(saved.record);
    }

    const worktree = worktreeIdentity(inspection);
    const snapshot =
      input.snapshot === undefined
        ? createValidationSnapshot({
            resolved: input.resolution,
            snapshotId: safeDerivedId(
              "f14-snapshot",
              `${runId}:${input.requestedPhase}`,
            ),
            createdAt: startedAt,
            worktree,
          })
        : input.snapshot;
    const validSnapshot = validateValidationSnapshot(snapshot);
    if (
      !validSnapshot.ok ||
      !snapshotMatchesResolution(snapshot, input.resolution) ||
      !sameWorktree(snapshot, worktree)
    ) {
      const evidence = noRunEvidence({
        runId,
        startedAt,
        requestedPhase: input.requestedPhase,
        reason: "SNAPSHOT_MISMATCH",
        warning: validationWarning("VALIDATION_REVIEW_REQUIRED", {
          status: "not_run",
          reason: "SNAPSHOT_MISMATCH",
        }),
      });
      const saved = this.options.repositories.saveRunIntent({
        runId,
        operationId: input.operationId,
        idempotencyKey,
        correlationId: input.correlationId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        consumer: input.consumer,
        requestedPhase: input.requestedPhase,
        resolutionStatus: input.resolution.status,
        evidence,
        nextAction: "RECONCILE_VALIDATION_SNAPSHOT",
      });
      this.emit(
        saved.record,
        "VALIDATION_FAILED",
        "VALIDATION_FAILED",
        "Validation was not run because its immutable snapshot did not match current worktree evidence.",
      );
      return this.result(saved.record);
    }

    const initial = createInitialValidationRun({
      snapshot: validSnapshot.snapshot,
      runId,
      startedAt,
    });
    const preparedInitial: ValidationRunEvidence = {
      ...initial,
      phase: input.requestedPhase,
      steps: initial.steps.map((step, index) => {
        const profileStep = validSnapshot.snapshot.profile.steps[index];
        const selected =
          profileStep !== undefined &&
          isValidationStepEligible(
            profileStep,
            input.requestedPhase as "baseline" | "post_change",
          );
        if (!selected)
          return {
            ...step,
            status: "not_run" as const,
            reason: "PHASE_NOT_SELECTED" as const,
          };
        return {
          ...step,
          executedPhase: input.requestedPhase as "baseline" | "post_change",
        };
      }),
    };
    const intent = this.options.repositories.saveRunIntent({
      runId,
      operationId: input.operationId,
      idempotencyKey,
      correlationId: input.correlationId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      consumer: input.consumer,
      requestedPhase: input.requestedPhase,
      resolutionStatus: input.resolution.status,
      snapshot: validSnapshot.snapshot,
      evidence: preparedInitial,
      nextAction: "WAIT_FOR_VALIDATION",
    });
    if (!intent.created) return this.result(intent.record);
    this.emit(
      intent.record,
      "VALIDATION_STARTED",
      "VALIDATION_STARTED",
      "Deterministic validation started in the operation-owned worktree.",
    );

    const controller = new AbortController();
    const externalAbort = (): void => controller.abort("USER_CANCELLED");
    if (input.signal?.aborted) controller.abort("USER_CANCELLED");
    else input.signal?.addEventListener("abort", externalAbort, { once: true });
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    this.active.set(runId, { controller, finished, resolveFinished });
    try {
      const final = await this.executeSteps(intent.record, controller.signal);
      this.emit(
        final,
        final.status === "passed"
          ? "VALIDATION_COMPLETED"
          : "VALIDATION_FAILED",
        final.status === "passed"
          ? "VALIDATION_COMPLETED"
          : "VALIDATION_FAILED",
        final.status === "passed"
          ? "Validation passed with observed exit evidence."
          : "Validation completed with a non-passing deterministic result.",
      );
      return this.result(final);
    } finally {
      resolveFinished();
      this.active.delete(runId);
      input.signal?.removeEventListener("abort", externalAbort);
    }
  }

  private async executeSteps(
    initial: F14ValidationRunRecord,
    signal: AbortSignal,
  ): Promise<F14ValidationRunRecord> {
    let record = initial;
    let steps = initial.evidence.steps.map((step) => ({ ...step }));
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (step === undefined || step.reason === "PHASE_NOT_SELECTED") continue;
      if (step.status !== "pending") continue;
      if (signal.aborted) {
        const interruptionReason =
          signal.reason === "APPLICATION_SHUTDOWN"
            ? "APPLICATION_SHUTDOWN"
            : "USER_CANCELLED";
        const updated =
          step.kind === "command"
            ? interruptedStep(step, interruptionReason, this.clock.now())
            : {
                ...step,
                status: "not_run" as const,
                reason: "MANUAL_CHECK_NOT_RUN" as const,
              };
        steps[index] = updated;
        steps = stopAfter(steps, index);
        record = this.persistEvidence(record, steps, this.clock.now());
        return record;
      }
      if (step.kind === "manual") {
        steps[index] = {
          ...step,
          status: "not_run",
          reason: "MANUAL_CHECK_NOT_RUN",
        };
        steps = stopAfter(steps, index);
        record = this.persistEvidence(record, steps, this.clock.now());
        return record;
      }
      const terminal = await this.executeCommand(record, step, signal);
      record = terminal.runningRecord;
      steps[index] = terminal.step;
      record = this.persistEvidence(record, steps, terminal.completedAt);
      if (terminal.step.status !== "passed") {
        steps = stopAfter(steps, index);
        record = this.persistEvidence(record, steps, terminal.completedAt);
        return record;
      }
    }
    return this.persistEvidence(record, steps, this.clock.now());
  }

  private async executeCommand(
    record: F14ValidationRunRecord,
    step: Extract<ValidationStepEvidence, { kind: "command" }>,
    signal: AbortSignal,
  ): Promise<{
    readonly step: CommandStepEvidence;
    readonly completedAt: string;
    readonly runningRecord: F14ValidationRunRecord;
  }> {
    const snapshot = record.snapshot;
    if (snapshot === undefined) throw new Error("F14_COMMAND_NEEDS_SNAPSHOT");
    const profileStep = snapshot.profile.steps.find(
      (candidate) => candidate.id === step.stepId,
    );
    if (profileStep === undefined || profileStep.kind !== "command")
      throw new Error("F14_COMMAND_STEP_NOT_IN_SNAPSHOT");
    const prepared = prepareCommand({
      step: profileStep,
      operationWorktreeRoot: snapshot.worktree.canonicalRoot,
      platform: this.platform,
      environment: this.environment,
      toolchainEnvironment: this.toolchainEnvironment,
      allowedEnvironmentKeys: this.allowedEnvironmentKeys,
    });
    if (!prepared.ok) {
      const completedAt = this.clock.now();
      return {
        completedAt,
        step: failedPreparationEvidence(
          step,
          profileStep,
          prepared.reason,
          completedAt,
          snapshot.worktree.canonicalRoot,
        ),
        runningRecord: record,
      };
    }
    const running = {
      ...step,
      status: "running" as const,
      startedAt: this.clock.now(),
      executable: prepared.command.executable,
      arguments: [...prepared.command.arguments],
      canonicalWorkingDirectory: prepared.command.canonicalWorkingDirectory,
      resolvedExecutable: prepared.command.resolvedExecutable,
      timeoutSeconds: prepared.command.timeoutSeconds,
      outputLimitBytes: prepared.command.outputLimitBytes,
    };
    const runningEvidence = record.evidence.steps.map((candidate) =>
      candidate.stepId === step.stepId ? running : candidate,
    );
    const runningRecord = this.persistEvidence(
      record,
      runningEvidence,
      running.startedAt,
    );
    let handle: ValidationProcessHandle<string>;
    try {
      handle = await this.runner.start({ snapshot, command: prepared.command });
    } catch {
      const completedAt = this.clock.now();
      return {
        completedAt,
        step: {
          ...createCommandStepEvidence({
            prepared: prepared.command,
            startedAt: running.startedAt,
            completedAt,
            observation: { startError: true },
            stdout: emptyOutput(),
            stderr: emptyOutput(),
          }),
          executedPhase: step.executedPhase,
        },
        runningRecord,
      };
    }
    const stdout = this.capture(
      handle.stdout,
      prepared.command.outputLimitBytes,
    );
    const stderr = this.capture(
      handle.stderr,
      prepared.command.outputLimitBytes,
    );
    const observation = await this.waitForProcess(
      handle,
      prepared.command.timeoutSeconds * 1_000,
      signal,
    );
    const [stdoutEvidence, stderrEvidence] = await Promise.all([
      stdout,
      stderr,
    ]);
    const completedAt = this.clock.now();
    let terminal: CommandStepEvidence;
    try {
      terminal = createCommandStepEvidence({
        prepared: prepared.command,
        startedAt: running.startedAt,
        completedAt,
        observation,
        stdout: stdoutEvidence,
        stderr: stderrEvidence,
      });
    } catch {
      terminal = {
        kind: "command",
        stepId: step.stepId,
        phase: step.phase,
        executedPhase: step.executedPhase,
        status: "failed",
        reason: "REDACTION_FAILURE",
        startedAt: running.startedAt,
        completedAt,
        executable: prepared.command.executable,
        arguments: [...prepared.command.arguments],
        canonicalWorkingDirectory: prepared.command.canonicalWorkingDirectory,
        resolvedExecutable: prepared.command.resolvedExecutable,
        timeoutSeconds: prepared.command.timeoutSeconds,
        outputLimitBytes: prepared.command.outputLimitBytes,
        stdout: unsafeOutput(),
        stderr: unsafeOutput(),
      };
    }
    return {
      completedAt,
      step: { ...terminal, executedPhase: step.executedPhase },
      runningRecord,
    };
  }

  private async waitForProcess(
    handle: ValidationProcessHandle<string>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<ExitObservation> {
    let interruption:
      "TIMED_OUT" | "USER_CANCELLED" | "APPLICATION_SHUTDOWN" | undefined;
    let interruptedResolve:
      ((observation: ExitObservation) => void) | undefined;
    const interruptionPromise = new Promise<ExitObservation>((resolve) => {
      interruptedResolve = resolve;
    });
    const timerHandle: unknown = this.timer.setTimeout(() => {
      interruption = "TIMED_OUT";
      interruptedResolve?.({ timedOut: true });
    }, timeoutMs);
    const abort = (): void => {
      const reason =
        signal.reason === "APPLICATION_SHUTDOWN"
          ? "APPLICATION_SHUTDOWN"
          : "USER_CANCELLED";
      interruption = reason;
      interruptedResolve?.({ cancellationReason: reason });
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    const processResult = Promise.resolve()
      .then(() => handle.wait())
      .catch(() => ({ outcomeUncertain: true }) satisfies ExitObservation);
    const result = await Promise.race([processResult, interruptionPromise]);
    this.timer.clearTimeout(timerHandle);
    signal.removeEventListener("abort", abort);
    if (interruption === undefined) return result;
    try {
      await terminateProcessTree({
        reason: interruption,
        processTree: handle.processTree,
        processControl: this.processControl,
        clock: this.clock,
      });
    } catch {
      // The interrupted reason remains authoritative; activity carries only a
      // bounded diagnostic and no process output is promoted to success.
    }
    return result;
  }

  private capture(
    stream: AsyncIterable<Uint8Array>,
    limitBytes: number,
  ): Promise<CommandStepEvidence["stdout"]> {
    return (async () => {
      const accumulator = new StreamAccumulator({
        limitBytes,
        knownSecrets: this.knownSecrets,
      });
      try {
        for await (const chunk of stream) accumulator.append(chunk);
        return accumulator.finish();
      } catch {
        return unsafeOutput();
      }
    })();
  }

  private persistEvidence(
    record: F14ValidationRunRecord,
    steps: readonly ValidationStepEvidence[],
    completedAt: string,
  ): F14ValidationRunRecord {
    const copiedSteps = steps.map((step) => ({ ...step }));
    const activeStep = copiedSteps.some(
      (step) =>
        step.reason !== "PHASE_NOT_SELECTED" &&
        (step.status === "pending" || step.status === "running"),
    );
    const evidence = activeStep
      ? (() => {
          const {
            completedAt: _completedAt,
            reason: _reason,
            ...withoutTerminal
          } = record.evidence;
          return {
            ...withoutTerminal,
            status: "running" as const,
            steps: copiedSteps,
            warnings: [...record.evidence.warnings],
          } satisfies ValidationRunEvidence;
        })()
      : completeEvidence({
          run: { ...record.evidence, steps: copiedSteps },
          requestedPhase: record.requestedPhase,
          completedAt,
          manualAttestations: record.evidence.manualAttestations,
        });
    return this.options.repositories.updateRun({
      runId: record.runId,
      evidence,
      nextAction: safeNextAction(
        evidence.status,
        "reason" in evidence ? evidence.reason : undefined,
      ),
      expectedVersion: record.version,
    });
  }

  private result(record: F14ValidationRunRecord): F14ValidationExecutionResult {
    return {
      ok: record.status === "passed",
      completed: record.status !== "running",
      record,
      run: record.evidence,
    };
  }

  private emit(
    record: F14ValidationRunRecord,
    eventType:
      "VALIDATION_STARTED" | "VALIDATION_COMPLETED" | "VALIDATION_FAILED",
    reasonCode:
      "VALIDATION_STARTED" | "VALIDATION_COMPLETED" | "VALIDATION_FAILED",
    summary: string,
  ): void {
    try {
      this.options.activity?.append({
        eventId: `f14-activity-${randomUUID()}`,
        eventType,
        stage: "VALIDATION",
        correlationId: record.correlationId,
        operationId: record.operationId,
        owner: {
          type: record.ownerType,
          id: record.ownerId,
          version: record.version,
        },
        occurrenceAt: this.clock.now(),
        severity:
          record.status === "passed"
            ? "INFO"
            : eventType === "VALIDATION_STARTED"
              ? "INFO"
              : "WARNING",
        reason: {
          code: reasonCode,
          what: summary,
          why: "Validation evidence is recorded by deterministic main-process execution.",
          nextAction: record.status === "passed" ? "REVIEW" : "OPEN_DETAILS",
        },
        summary,
        details: {
          runId: record.runId,
          phase: record.requestedPhase,
          status: record.status,
          ...(record.evidence.reason === undefined
            ? {}
            : { resultReason: record.evidence.reason }),
        },
      });
    } catch {
      // Activity is diagnostic only. A failed append cannot change validation truth.
    }
  }
}

function worktreeIdentity(inspection: F13InspectionResult): {
  canonicalRoot: string;
  baselineRevision: string;
  currentRevision: string;
} {
  const currentRevision =
    inspection.snapshot?.manifest.headSha ?? inspection.worktree.currentHeadSha;
  if (currentRevision === undefined)
    throw new Error("F14_WORKTREE_CURRENT_REVISION_MISSING");
  return {
    canonicalRoot: inspection.worktree.canonicalPath,
    baselineRevision: inspection.worktree.worktreeBaselineSha,
    currentRevision,
  };
}

function snapshotMatchesResolution(
  snapshot: ValidationSnapshot,
  resolution: Extract<ValidationResolution, { status: "ready" }>,
): boolean {
  return (
    snapshot.repositoryIdentity.id === resolution.repositoryId &&
    snapshot.source === resolution.source &&
    snapshot.contentHash === resolution.contentHash &&
    snapshot.authorization.authorizationType ===
      resolution.authorization.authorizationType &&
    snapshot.authorization.id === resolution.authorization.id
  );
}

function sameWorktree(
  snapshot: ValidationSnapshot,
  actual: {
    canonicalRoot: string;
    baselineRevision: string;
    currentRevision: string;
  },
): boolean {
  const normalize = (value: string): string =>
    /^[A-Za-z]:[\\/]|^\\\\/u.test(value)
      ? value.toLowerCase().replaceAll("/", "\\")
      : value;
  return (
    normalize(snapshot.worktree.canonicalRoot) ===
      normalize(actual.canonicalRoot) &&
    snapshot.worktree.baselineRevision === actual.baselineRevision &&
    snapshot.worktree.currentRevision === actual.currentRevision
  );
}

function failedPreparationEvidence(
  step: Extract<ValidationStepEvidence, { kind: "command" }>,
  profileStep: Extract<
    ValidationSnapshot["profile"]["steps"][number],
    { kind: "command" }
  >,
  reason:
    "INVALID_PROFILE" | "WORKTREE_PATH_INVALID" | "EXECUTABLE_NOT_RESOLVED",
  completedAt: string,
  fallbackDirectory: string,
): CommandStepEvidence {
  return {
    kind: "command",
    stepId: step.stepId,
    phase: step.phase,
    executedPhase: step.executedPhase,
    status: "failed",
    reason,
    startedAt: completedAt,
    completedAt,
    executable: profileStep.executable,
    arguments: [...profileStep.arguments],
    canonicalWorkingDirectory: fallbackDirectory,
    timeoutSeconds: profileStep.timeoutSeconds,
    outputLimitBytes: profileStep.outputLimitBytes,
    stdout: emptyOutput(),
    stderr: emptyOutput(),
  };
}

function stopAfter(
  steps: readonly ValidationStepEvidence[],
  failedIndex: number,
): ValidationStepEvidence[] {
  return steps.map((candidate, index) => {
    if (index <= failedIndex || candidate.reason === "PHASE_NOT_SELECTED")
      return { ...candidate };
    if (candidate.status === "pending" || candidate.status === "running") {
      return { ...candidate, status: "not_run", reason: "PRIOR_STEP_STOPPED" };
    }
    return { ...candidate };
  });
}

function interruptedStep(
  step: Extract<ValidationStepEvidence, { kind: "command" }>,
  reason:
    | "USER_CANCELLED"
    | "APPLICATION_SHUTDOWN"
    | "APPLICATION_RESTARTED"
    | "TIMED_OUT",
  completedAt: string,
): CommandStepEvidence {
  return {
    ...step,
    status: "interrupted",
    reason,
    completedAt,
    canonicalWorkingDirectory:
      step.canonicalWorkingDirectory ?? "unknown-operation-worktree",
    stdout: step.stdout ?? emptyOutput(),
    stderr: step.stderr ?? emptyOutput(),
  };
}

function completeEvidence(input: {
  readonly run: ValidationRunEvidence;
  readonly requestedPhase: ValidationPhase;
  readonly completedAt: string;
  readonly manualAttestations: readonly ManualAttestation[];
}): ValidationRunEvidence {
  const selected = input.run.steps.filter(
    (step) => step.executedPhase === input.requestedPhase,
  );
  const automated = selected.filter(
    (step): step is Extract<ValidationStepEvidence, { kind: "command" }> =>
      step.kind === "command",
  );
  const manualSteps = selected.filter((step) => step.kind === "manual");
  type Aggregate = ReturnType<typeof aggregateValidationEvidence>;
  const contractAggregate: Aggregate = aggregateValidationEvidence({
    automated,
    manual: input.manualAttestations,
  });
  const manualFailed = manualSteps.some(
    (step) => step.kind === "manual" && step.status === "failed",
  );
  const manualUnattested = manualSteps.some(
    (step) =>
      step.kind === "manual" &&
      (step.status === "pending" ||
        step.status === "not_run" ||
        step.attestation === undefined),
  );
  let aggregate: Aggregate = contractAggregate;
  // F00 owns automated precedence. Manual status only fills the gap when all
  // selected automated evidence is otherwise passing or absent.
  if (contractAggregate.status === "passed" && manualFailed) {
    aggregate = {
      ...contractAggregate,
      status: "failed",
      reason: "MANUAL_CHECK_FAILED",
    };
  } else if (manualUnattested && contractAggregate.status === "passed") {
    aggregate = {
      ...contractAggregate,
      status: "not_run",
      reason: "MANUAL_CHECK_NOT_RUN",
    };
  } else if (
    manualUnattested &&
    automated.length === 0 &&
    contractAggregate.reason === "NO_AUTOMATED_COMMANDS"
  ) {
    aggregate = {
      ...contractAggregate,
      status: manualFailed ? "failed" : "not_run",
      reason: manualFailed ? "MANUAL_CHECK_FAILED" : "MANUAL_CHECK_NOT_RUN",
    };
  }
  const warning = publicationWarningForValidation(aggregate);
  const warnings = [
    ...input.run.warnings.filter(
      (existing) => existing.code !== "VALIDATION_REVIEW_REQUIRED",
    ),
    ...(warning === undefined ? [] : [warning]),
  ];
  return {
    ...input.run,
    status: aggregate.status,
    ...(aggregate.reason === undefined ? {} : { reason: aggregate.reason }),
    completedAt: input.completedAt,
    steps: input.run.steps.map((step) => ({ ...step })),
    manualAttestations: [...input.manualAttestations],
    warnings,
  };
}

function restartEvidence(
  run: ValidationRunEvidence,
  completedAt: string,
): ValidationRunEvidence {
  const requestedPhase =
    run.phase === "baseline" || run.phase === "post_change"
      ? run.phase
      : "post_change";
  let steps = run.steps.map((step) =>
    step.executedPhase === undefined && step.reason !== "PHASE_NOT_SELECTED"
      ? { ...step, executedPhase: requestedPhase }
      : { ...step },
  );
  const runningIndex = steps.findIndex((step) => step.status === "running");
  if (runningIndex >= 0) {
    const running = steps[runningIndex];
    if (running?.kind === "command") {
      steps[runningIndex] = interruptedStep(
        running,
        "APPLICATION_RESTARTED",
        completedAt,
      );
    } else if (running !== undefined) {
      steps[runningIndex] = {
        ...running,
        status: "not_run",
        reason: "MANUAL_CHECK_NOT_RUN",
      };
    }
    steps = stopAfter(steps, runningIndex);
  } else {
    const pendingIndex = steps.findIndex(
      (step) =>
        step.status === "pending" && step.reason !== "PHASE_NOT_SELECTED",
    );
    if (pendingIndex >= 0) {
      const pending = steps[pendingIndex];
      if (pending?.kind === "command")
        steps[pendingIndex] = interruptedStep(
          pending,
          "APPLICATION_RESTARTED",
          completedAt,
        );
      else if (pending !== undefined)
        steps[pendingIndex] = {
          ...pending,
          status: "not_run",
          reason: "MANUAL_CHECK_NOT_RUN",
        };
      steps = stopAfter(steps, pendingIndex);
    }
  }
  return completeEvidence({
    run: { ...run, steps },
    requestedPhase,
    completedAt,
    manualAttestations: run.manualAttestations,
  });
}

export function toF14ValidationReadModel(
  record: F14ValidationRunRecord,
): F14ValidationReadModel {
  const snapshot = record.snapshot;
  return {
    schemaVersion: 1,
    runId: record.runId,
    operationId: record.operationId,
    ownerType: record.ownerType,
    ownerId: record.ownerId,
    consumer: record.consumer,
    requestedPhase: record.requestedPhase,
    status: record.evidence.status,
    ...(record.evidence.reason === undefined
      ? {}
      : { reason: record.evidence.reason }),
    startedAt: record.evidence.startedAt,
    ...(record.evidence.completedAt === undefined
      ? {}
      : { completedAt: record.evidence.completedAt }),
    ...(snapshot === undefined
      ? {}
      : {
          snapshot: {
            snapshotId: snapshot.snapshotId,
            source: snapshot.source,
            repositoryId: snapshot.repositoryIdentity.id,
            contentHash: snapshot.contentHash,
            worktreePath: snapshot.worktree.canonicalRoot,
            baselineRevision: snapshot.worktree.baselineRevision,
            ...(snapshot.worktree.currentRevision === undefined
              ? {}
              : { currentRevision: snapshot.worktree.currentRevision }),
          },
        }),
    steps: record.evidence.steps.map((step) => ({
      stepId: step.stepId,
      kind: step.kind,
      ...(step.phase === undefined ? {} : { configuredPhase: step.phase }),
      ...(step.executedPhase === undefined
        ? {}
        : { executedPhase: step.executedPhase }),
      status: step.status,
      ...(step.reason === undefined ? {} : { reason: step.reason }),
      ...(step.kind === "command"
        ? {
            executable: step.executable,
            arguments: step.arguments,
            ...(step.canonicalWorkingDirectory === undefined
              ? {}
              : { canonicalWorkingDirectory: step.canonicalWorkingDirectory }),
            ...(step.resolvedExecutable === undefined
              ? {}
              : { resolvedExecutable: step.resolvedExecutable }),
            ...(step.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: step.timeoutSeconds }),
            ...(step.outputLimitBytes === undefined
              ? {}
              : { outputLimitBytes: step.outputLimitBytes }),
            ...(step.startedAt === undefined
              ? {}
              : { startedAt: step.startedAt }),
            ...(step.completedAt === undefined
              ? {}
              : { completedAt: step.completedAt }),
            ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
            ...(step.signal === undefined ? {} : { signal: step.signal }),
            ...(step.stdout === undefined ? {} : { stdout: step.stdout }),
            ...(step.stderr === undefined ? {} : { stderr: step.stderr }),
          }
        : {
            manualLabel:
              step.attestation === undefined
                ? "Not run"
                : step.attestation.outcome === "verified"
                  ? "Verified manually"
                  : step.attestation.outcome === "failed"
                    ? "Manual check failed"
                    : "Not run",
          }),
    })),
    manualAttestations: record.evidence.manualAttestations,
    warnings: record.warnings,
    nextAction: record.nextAction,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
