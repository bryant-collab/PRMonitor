import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_OUTPUT_LIMIT_BYTES,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  type CommandStep,
} from "./schema.js";
import type { ValidationSnapshot } from "./snapshot.js";

export type ValidationReason =
  | "NO_PROFILE"
  | "CONFIRMATION_REQUIRED"
  | "INVALID_PROFILE"
  | "START_FAILED"
  | "NON_ZERO_EXIT"
  | "TIMED_OUT"
  | "USER_CANCELLED"
  | "APPLICATION_SHUTDOWN"
  | "APPLICATION_RESTARTED"
  | "PRIOR_STEP_STOPPED"
  | "WORKTREE_PATH_INVALID"
  | "REDACTION_FAILURE"
  | "EXECUTABLE_NOT_RESOLVED"
  | "MANUAL_CHECK_FAILED"
  | "MANUAL_CHECK_NOT_RUN"
  | "NO_AUTOMATED_COMMANDS"
  | "SNAPSHOT_MISMATCH"
  | "INVALID_TRANSITION";

export type StepState =
  "pending" | "running" | "passed" | "failed" | "interrupted" | "not_run";
export type RunState =
  "running" | "passed" | "failed" | "interrupted" | "not_run";

export const TERMINATION_GRACE_PERIOD_MS = 5_000 as const;

export interface PathPort {
  canonicalize(input: string): string;
  isDirectory(input: string): boolean;
}

export const nativePathPort: PathPort = {
  canonicalize(input) {
    return realpathSync.native(input);
  },
  isDirectory(input) {
    return statSync(input).isDirectory();
  },
};

export interface PathPolicyOptions {
  platform?: "posix" | "win32";
  pathPort?: PathPort;
}

export interface PathPolicySuccess {
  ok: true;
  canonicalWorktreeRoot: string;
  canonicalWorkingDirectory: string;
  relativeWorkingDirectory: string;
}

export interface PathPolicyFailure {
  ok: false;
  reason: "WORKTREE_PATH_INVALID";
  message: string;
}

export type PathPolicyResult = PathPolicySuccess | PathPolicyFailure;

function pathFlavor(platform?: "posix" | "win32"): "posix" | "win32" {
  return platform ?? (process.platform === "win32" ? "win32" : "posix");
}

function trimTrailingSeparators(
  input: string,
  platform: "posix" | "win32",
): string {
  const root =
    platform === "win32"
      ? path.win32.parse(input).root
      : path.posix.parse(input).root;
  if (input === root) {
    return input;
  }
  return input.replace(/[\\/]+$/u, "");
}

export function canonicalPathKey(
  input: string,
  platform?: "posix" | "win32",
): string {
  const flavor = pathFlavor(platform);
  const normalized =
    flavor === "win32"
      ? path.win32.normalize(input)
      : path.posix.normalize(input);
  const trimmed = trimTrailingSeparators(normalized, flavor);
  return flavor === "win32" ? trimmed.toLowerCase() : trimmed;
}

export function isPathWithin(
  canonicalRoot: string,
  canonicalCandidate: string,
  options: { platform?: "posix" | "win32" } = {},
): boolean {
  const flavor = pathFlavor(options.platform);
  const root = canonicalPathKey(canonicalRoot, flavor);
  const candidate = canonicalPathKey(canonicalCandidate, flavor);
  if (candidate === root) {
    return true;
  }
  const separator = flavor === "win32" ? "\\" : "/";
  return candidate.startsWith(`${root}${separator}`);
}

function hasAbsoluteSyntax(input: string, flavor: "posix" | "win32"): boolean {
  return (
    (flavor === "posix" && path.posix.isAbsolute(input)) ||
    (flavor === "win32" && path.win32.isAbsolute(input)) ||
    path.posix.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    /^[A-Za-z]:/u.test(input)
  );
}

function hasParentTraversal(input: string): boolean {
  return input.split(/[\\/]+/u).some((segment) => segment === "..");
}

export function resolveWorkingDirectory(
  operationWorktreeRoot: string,
  relativeWorkingDirectory: string,
  options: PathPolicyOptions = {},
): PathPolicyResult {
  const flavor = pathFlavor(options.platform);
  const port = options.pathPort ?? nativePathPort;
  if (
    typeof operationWorktreeRoot !== "string" ||
    operationWorktreeRoot.length === 0
  ) {
    return {
      ok: false,
      reason: "WORKTREE_PATH_INVALID",
      message: "operation worktree root is empty",
    };
  }
  if (
    typeof relativeWorkingDirectory !== "string" ||
    relativeWorkingDirectory.length === 0
  ) {
    return {
      ok: false,
      reason: "WORKTREE_PATH_INVALID",
      message: "working directory is empty",
    };
  }
  if (
    hasAbsoluteSyntax(relativeWorkingDirectory, flavor) ||
    hasParentTraversal(relativeWorkingDirectory)
  ) {
    return {
      ok: false,
      reason: "WORKTREE_PATH_INVALID",
      message:
        "working directory must be relative and cannot contain parent traversal",
    };
  }

  const join = flavor === "win32" ? path.win32.join : path.posix.join;
  const joined = join(operationWorktreeRoot, relativeWorkingDirectory);
  try {
    const canonicalWorktreeRoot = port.canonicalize(operationWorktreeRoot);
    if (!port.isDirectory(canonicalWorktreeRoot)) {
      return {
        ok: false,
        reason: "WORKTREE_PATH_INVALID",
        message: "operation worktree root does not exist or is not a directory",
      };
    }
    const canonicalWorkingDirectory = port.canonicalize(joined);
    if (!port.isDirectory(canonicalWorkingDirectory)) {
      return {
        ok: false,
        reason: "WORKTREE_PATH_INVALID",
        message: "working directory does not exist or is not a directory",
      };
    }
    if (
      !isPathWithin(canonicalWorktreeRoot, canonicalWorkingDirectory, {
        platform: flavor,
      })
    ) {
      return {
        ok: false,
        reason: "WORKTREE_PATH_INVALID",
        message: "working directory resolves outside the operation worktree",
      };
    }
    return {
      ok: true,
      canonicalWorktreeRoot,
      canonicalWorkingDirectory,
      relativeWorkingDirectory,
    };
  } catch {
    return {
      ok: false,
      reason: "WORKTREE_PATH_INVALID",
      message: "working directory could not be canonicalized or inspected",
    };
  }
}

export interface BoundedNumberResult {
  ok: true;
  value: number;
}

export interface BoundedNumberFailure {
  ok: false;
  message: string;
}

export type BoundedNumber = BoundedNumberResult | BoundedNumberFailure;

export function effectiveTimeoutSeconds(
  value: number | undefined | null,
): BoundedNumber {
  if (value === undefined || value === null) {
    return { ok: true, value: DEFAULT_TIMEOUT_SECONDS };
  }
  if (
    !Number.isInteger(value) ||
    value < MIN_TIMEOUT_SECONDS ||
    value > MAX_TIMEOUT_SECONDS
  ) {
    return {
      ok: false,
      message: `timeoutSeconds must be an integer from ${MIN_TIMEOUT_SECONDS} through ${MAX_TIMEOUT_SECONDS}`,
    };
  }
  return { ok: true, value };
}

export function effectiveOutputLimitBytes(
  value: number | undefined | null,
): BoundedNumber {
  if (value === undefined || value === null) {
    return { ok: true, value: DEFAULT_OUTPUT_LIMIT_BYTES };
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_OUTPUT_LIMIT_BYTES) {
    return {
      ok: false,
      message: `outputLimitBytes must be an integer from 1 through ${MAX_OUTPUT_LIMIT_BYTES}`,
    };
  }
  return { ok: true, value };
}

export const SENSITIVE_ENVIRONMENT_KEY =
  /(?:^|[_-])(GITHUB|GH|OPENAI|CODEX|TOKEN|PASSWORD|PASSWD|SECRET|AUTH|AUTHORIZATION|API[_-]?KEY|CREDENTIAL|PRIVATE[_-]?KEY)(?:$|[_-])/iu;

export const DEFAULT_TOOLCHAIN_ENVIRONMENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CI",
  "NODE_ENV",
] as const;

export interface ControlledEnvironmentInput {
  toolchainEnvironment?: Record<string, string | undefined>;
  pathValue?: string;
  pathExtValue?: string;
  allowedKeys?: readonly string[];
}

export function sanitizeEnvironment(
  environment: Record<string, string | undefined>,
  allowedKeys: readonly string[] = DEFAULT_TOOLCHAIN_ENVIRONMENT_KEYS,
): Record<string, string> {
  const allowed = new Map(
    allowedKeys.map((key) => [key.toLowerCase(), key] as const),
  );
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    const normalizedKey = allowed.get(key.toLowerCase());
    if (
      value === undefined ||
      normalizedKey === undefined ||
      SENSITIVE_ENVIRONMENT_KEY.test(key)
    ) {
      continue;
    }
    // Environment names are case-insensitive on Windows. Emit one stable
    // spelling so PATH/PATHEXT lookup and the child environment cannot be
    // influenced by duplicate differently-cased keys.
    result[normalizedKey] = value;
  }
  return result;
}

export function createControlledEnvironment(
  input: ControlledEnvironmentInput = {},
): Record<string, string> {
  const result = sanitizeEnvironment(
    input.toolchainEnvironment ?? {},
    input.allowedKeys,
  );
  if (
    input.pathValue !== undefined &&
    !SENSITIVE_ENVIRONMENT_KEY.test("PATH")
  ) {
    result.PATH = input.pathValue;
  }
  if (input.pathExtValue !== undefined) {
    result.PATHEXT = input.pathExtValue;
  }
  return result;
}

export interface ExecutableResolverOptions {
  platform?: "posix" | "win32";
  environment?: Record<string, string | undefined>;
  /** Base directory for a path-like executable that is relative to the operation worktree. */
  baseDirectory?: string;
  fileExists?: (candidate: string) => boolean;
  executable?: (candidate: string) => boolean;
}

function defaultFileExists(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function defaultExecutable(
  candidate: string,
  flavor: "posix" | "win32",
): boolean {
  if (flavor === "win32") {
    return defaultFileExists(candidate);
  }
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasFileExtension(input: string, flavor: "posix" | "win32"): boolean {
  return flavor === "win32"
    ? path.win32.extname(input).length > 0
    : path.posix.extname(input).length > 0;
}

export function resolveExecutable(
  executable: string,
  options: ExecutableResolverOptions = {},
): string | undefined {
  const flavor = pathFlavor(options.platform);
  const environment = options.environment ?? {};
  const exists = options.fileExists ?? defaultFileExists;
  const isExecutable =
    options.executable ??
    ((candidate: string) => defaultExecutable(candidate, flavor));
  const pathValue = environment.PATH ?? environment.Path ?? "";
  const pathExtValue =
    environment.PATHEXT ?? environment.Pathext ?? ".COM;.EXE;.BAT;.CMD";
  const extensions =
    flavor === "win32" ? pathExtValue.split(";").filter(Boolean) : [""];
  const isPathLike =
    /[\\/]/u.test(executable) ||
    (flavor === "win32" && path.win32.isAbsolute(executable));

  const candidates: string[] = [];
  if (isPathLike) {
    const isAbsolute =
      (flavor === "win32" && path.win32.isAbsolute(executable)) ||
      (flavor === "posix" && path.posix.isAbsolute(executable)) ||
      /^[A-Za-z]:[\\/]/u.test(executable) ||
      executable.startsWith("\\");
    const pathExecutable =
      !isAbsolute && options.baseDirectory !== undefined
        ? flavor === "win32"
          ? path.win32.join(options.baseDirectory, executable)
          : path.posix.join(options.baseDirectory, executable)
        : executable;
    candidates.push(pathExecutable);
    if (flavor === "win32" && !hasFileExtension(pathExecutable, flavor)) {
      candidates.push(
        ...extensions.map((extension) => `${pathExecutable}${extension}`),
      );
    }
  } else {
    const separator = flavor === "win32" ? ";" : ":";
    const directories = pathValue.split(separator).filter(Boolean);
    for (const directory of directories) {
      const joined =
        flavor === "win32"
          ? path.win32.join(directory, executable)
          : path.posix.join(directory, executable);
      candidates.push(joined);
      if (flavor === "win32" && !hasFileExtension(executable, flavor)) {
        candidates.push(
          ...extensions.map((extension) => `${joined}${extension}`),
        );
      }
    }
  }

  for (const candidate of candidates) {
    if (exists(candidate) && isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export interface PreparedCommand {
  kind: "command";
  stepId: string;
  executable: string;
  arguments: string[];
  phase?: "baseline" | "post_change" | "both";
  shell: false;
  canonicalWorktreeRoot: string;
  canonicalWorkingDirectory: string;
  resolvedExecutable: string;
  timeoutSeconds: number;
  outputLimitBytes: number;
  environment: Record<string, string>;
}

/**
 * The F00-to-F14 handoff. F00 defines the shape a real runner may consume;
 * it deliberately does not implement process creation or process-tree
 * handling. The immutable snapshot travels with every start request so a
 * future runner cannot silently execute against mutable settings.
 */
export interface ValidationRunnerRequest {
  snapshot: Readonly<ValidationSnapshot>;
  command: PreparedCommand;
}

export interface ValidationProcessHandle<ProcessId = string> {
  readonly processTree: ProcessId;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  wait(): Promise<ExitObservation>;
}

export interface ValidationRunnerPort<ProcessId = string> {
  start(
    request: ValidationRunnerRequest,
  ): Promise<ValidationProcessHandle<ProcessId>>;
}

export type PrepareCommandResult =
  | { ok: true; command: PreparedCommand }
  | {
      ok: false;
      reason:
        "INVALID_PROFILE" | "WORKTREE_PATH_INVALID" | "EXECUTABLE_NOT_RESOLVED";
      message: string;
    };

export interface PrepareCommandInput {
  step: CommandStep;
  operationWorktreeRoot: string;
  platform?: "posix" | "win32";
  pathPort?: PathPort;
  environment?: Record<string, string | undefined>;
  toolchainEnvironment?: Record<string, string | undefined>;
  allowedEnvironmentKeys?: readonly string[];
  fileExists?: (candidate: string) => boolean;
  executable?: (candidate: string) => boolean;
}

export function prepareCommand(
  input: PrepareCommandInput,
): PrepareCommandResult {
  const timeout = effectiveTimeoutSeconds(input.step.timeoutSeconds);
  if (!timeout.ok) {
    return { ok: false, reason: "INVALID_PROFILE", message: timeout.message };
  }
  const outputLimit = effectiveOutputLimitBytes(input.step.outputLimitBytes);
  if (!outputLimit.ok) {
    return {
      ok: false,
      reason: "INVALID_PROFILE",
      message: outputLimit.message,
    };
  }
  const workingDirectory = resolveWorkingDirectory(
    input.operationWorktreeRoot,
    input.step.workingDirectory,
    { platform: input.platform, pathPort: input.pathPort },
  );
  if (!workingDirectory.ok) {
    return workingDirectory;
  }

  const environment = createControlledEnvironment({
    toolchainEnvironment: input.toolchainEnvironment,
    pathValue: input.environment?.PATH ?? input.environment?.Path,
    pathExtValue: input.environment?.PATHEXT ?? input.environment?.Pathext,
    allowedKeys: input.allowedEnvironmentKeys,
  });
  const resolvedExecutable = resolveExecutable(input.step.executable, {
    platform: input.platform,
    environment,
    baseDirectory: workingDirectory.canonicalWorkingDirectory,
    fileExists: input.fileExists,
    executable: input.executable,
  });
  if (resolvedExecutable === undefined) {
    return {
      ok: false,
      reason: "EXECUTABLE_NOT_RESOLVED",
      message: `executable could not be resolved without a shell: ${input.step.executable}`,
    };
  }
  return {
    ok: true,
    command: {
      kind: "command",
      stepId: input.step.id,
      executable: input.step.executable,
      arguments: [...input.step.arguments],
      phase: input.step.phase ?? "post_change",
      shell: false,
      canonicalWorktreeRoot: workingDirectory.canonicalWorktreeRoot,
      canonicalWorkingDirectory: workingDirectory.canonicalWorkingDirectory,
      resolvedExecutable,
      timeoutSeconds: timeout.value,
      outputLimitBytes: outputLimit.value,
      environment,
    },
  };
}

export interface TransitionResult<T> {
  ok: true;
  state: T;
}

export interface TransitionFailure {
  ok: false;
  reason: "INVALID_TRANSITION";
  message: string;
}

export function transitionStepState(
  current: StepState,
  next: StepState,
): TransitionResult<StepState> | TransitionFailure {
  const allowed: Record<StepState, readonly StepState[]> = {
    pending: ["running", "not_run", "failed", "interrupted"],
    running: ["passed", "failed", "interrupted"],
    passed: [],
    failed: [],
    interrupted: [],
    not_run: [],
  };
  if (!allowed[current].includes(next)) {
    return {
      ok: false,
      reason: "INVALID_TRANSITION",
      message: `cannot transition step ${current} to ${next}`,
    };
  }
  return { ok: true, state: next };
}

export function transitionRunState(
  current: RunState,
  next: RunState,
): TransitionResult<RunState> | TransitionFailure {
  const allowed: Record<RunState, readonly RunState[]> = {
    running: ["passed", "failed", "interrupted", "not_run"],
    passed: [],
    failed: [],
    interrupted: [],
    not_run: [],
  };
  if (!allowed[current].includes(next)) {
    return {
      ok: false,
      reason: "INVALID_TRANSITION",
      message: `cannot transition run ${current} to ${next}`,
    };
  }
  return { ok: true, state: next };
}

export function handleRendererClosed<T>(state: T): T {
  // Window lifetime is not validation-run lifetime. This intentionally is a no-op.
  return state;
}

export interface ExitObservation {
  exitCode?: number | null;
  signal?: string | null;
  startError?: boolean;
  timedOut?: boolean;
  cancellationReason?: "USER_CANCELLED" | "APPLICATION_SHUTDOWN";
}

export interface ExitStatus {
  status: StepState;
  reason?: ValidationReason;
}

export function statusFromExit(observation: ExitObservation): ExitStatus {
  if (observation.startError) {
    return { status: "failed", reason: "START_FAILED" };
  }
  if (observation.timedOut) {
    return { status: "interrupted", reason: "TIMED_OUT" };
  }
  if (observation.cancellationReason !== undefined) {
    return { status: "interrupted", reason: observation.cancellationReason };
  }
  if (observation.exitCode === 0) {
    return { status: "passed" };
  }
  return { status: "failed", reason: "NON_ZERO_EXIT" };
}

export interface ProcessControlPort<ProcessId = string> {
  requestGracefulTermination(processTree: ProcessId): Promise<void> | void;
  listSurvivingProcesses(
    processTree: ProcessId,
  ): Promise<readonly ProcessId[]> | readonly ProcessId[];
  forceTerminate(processes: readonly ProcessId[]): Promise<void> | void;
}

export interface ClockPort {
  wait(milliseconds: number): Promise<void>;
}

export interface TerminationResult<ProcessId = string> {
  reason: "TIMED_OUT" | "USER_CANCELLED" | "APPLICATION_SHUTDOWN";
  gracefulRequested: true;
  waitedMilliseconds: 5_000;
  survivors: readonly ProcessId[];
  forceTerminated: readonly ProcessId[];
}

export async function terminateProcessTree<ProcessId>(input: {
  reason: TerminationResult["reason"];
  processTree: ProcessId;
  processControl: ProcessControlPort<ProcessId>;
  clock: ClockPort;
}): Promise<TerminationResult<ProcessId>> {
  await input.processControl.requestGracefulTermination(input.processTree);
  await input.clock.wait(TERMINATION_GRACE_PERIOD_MS);
  const survivors = [
    ...(await input.processControl.listSurvivingProcesses(input.processTree)),
  ];
  if (survivors.length > 0) {
    await input.processControl.forceTerminate(survivors);
  }
  return {
    reason: input.reason,
    gracefulRequested: true,
    waitedMilliseconds: TERMINATION_GRACE_PERIOD_MS,
    survivors,
    forceTerminated: survivors,
  };
}

export function finalizeRestartedRun<
  T extends { status: RunState; reason?: ValidationReason },
>(run: T): T {
  if (run.status !== "running") {
    return run;
  }
  return { ...run, status: "interrupted", reason: "APPLICATION_RESTARTED" };
}
