import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
const F13_GIT_MAX_PATH_BYTES = 4_096;

export const F13_MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
export const F13_DEFAULT_GIT_TIMEOUT_MS = 60_000;

export interface F13GitRunOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly maxOutputBytes?: number;
}

export interface F13GitCommandResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputLimitExceeded: boolean;
  readonly started: boolean;
}

export interface F13GitCommandRunner {
  run(
    args: readonly string[],
    options: F13GitRunOptions,
  ): Promise<F13GitCommandResult>;
}

const ALLOWED_COMMANDS = new Set([
  "add",
  "cat-file",
  "clean",
  "clone",
  "diff",
  "fetch",
  "ls-files",
  "ls-remote",
  "merge-base",
  "reset",
  "rev-parse",
  "status",
  "worktree",
  "commit",
  "push",
  "show",
]);

const DISALLOWED_ARGUMENTS = [
  /^--(?:upload-pack|receive-pack|exec-path|git-dir|work-tree|config-env)(?:=|$)/u,
  /^-c(?:$|=)/u,
  /^--help$/u,
  /^--version$/u,
];

function safeSha(value: string): boolean {
  return /^[0-9a-f]{7,64}$/iu.test(value);
}

function safeCommitExpression(value: string): boolean {
  return /^[0-9a-f]{7,64}\^\{commit\}$/iu.test(value);
}

function positional(value: string): boolean {
  return value !== "--" && !value.startsWith("-");
}

function safeRelativePath(value: string): boolean {
  return (
    positional(value) &&
    !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function safeRemote(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value);
}

function safeBranch(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !/[ ~^:?*]/u.test(value) &&
    !value.includes("\\") &&
    !value.includes("\u0000") &&
    !value.includes("\r") &&
    !value.includes("\n")
  );
}

function allowedCommandShape(args: readonly string[]): boolean {
  const command = args[0];
  switch (command) {
    case "add":
      return (
        args.length >= 4 &&
        args[1] === "--all" &&
        args[2] === "--" &&
        args.slice(3).every((value) => safeRelativePath(value))
      );
    case "clone":
      return (
        args.length === 6 &&
        args[1] === "--no-hardlinks" &&
        args[2] === "--no-checkout" &&
        args[3] === "--" &&
        positional(args[4] ?? "") &&
        positional(args[5] ?? "")
      );
    case "clean":
      return args.length === 2 && args[1] === "-fd";
    case "diff":
      return (
        (args.length === 8 &&
          args[1] === "--binary" &&
          args[2] === "--no-ext-diff" &&
          args[3] === "--no-color" &&
          args[4] === "--full-index" &&
          args[5] === "--find-renames" &&
          safeSha(args[6] ?? "") &&
          args[7] === "--") ||
        (args.length === 7 &&
          args[1] === "--name-status" &&
          args[2] === "-z" &&
          args[3] === "--find-renames" &&
          args[4] === "--find-copies" &&
          safeSha(args[5] ?? "") &&
          args[6] === "--") ||
        (args.length === 9 &&
          args[1] === "--cached" &&
          args[2] === "--binary" &&
          args[3] === "--no-ext-diff" &&
          args[4] === "--no-color" &&
          args[5] === "--full-index" &&
          args[6] === "--find-renames" &&
          safeSha(args[7] ?? "") &&
          args[8] === "--") ||
        (args.length === 7 &&
          args[1] === "--cached" &&
          args[2] === "--name-only" &&
          args[3] === "-z" &&
          args[4] === "--find-renames" &&
          safeSha(args[5] ?? "") &&
          args[6] === "--") ||
        (args.length === 7 &&
          args[1] === "--name-only" &&
          args[2] === "-z" &&
          args[3] === "--find-renames" &&
          safeSha(args[4] ?? "") &&
          args[5] === "HEAD" &&
          args[6] === "--") ||
        (args.length === 9 &&
          args[1] === "--binary" &&
          args[2] === "--no-ext-diff" &&
          args[3] === "--no-color" &&
          args[4] === "--full-index" &&
          args[5] === "--find-renames" &&
          safeSha(args[6] ?? "") &&
          args[7] === "HEAD" &&
          args[8] === "--")
      );
    case "fetch":
      return (
        args.length === 5 &&
        args[1] === "--no-tags" &&
        args[2] === "--no-prune" &&
        positional(args[3] ?? "") &&
        safeSha(args[4] ?? "")
      );
    case "ls-files":
      return args.length === 3 && args[1] === "-z" && args[2] === "--cached";
    case "merge-base":
      return (
        args.length === 3 && safeSha(args[1] ?? "") && safeSha(args[2] ?? "")
      );
    case "reset":
      return (
        (args.length === 3 && args[1] === "--hard" && args[2] === "HEAD") ||
        (args.length >= 3 &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args.slice(3).every((value) => safeRelativePath(value)))
      );
    case "rev-parse":
      return (
        (args.length === 2 &&
          (args[1] === "--show-toplevel" ||
            args[1] === "--is-bare-repository" ||
            args[1] === "HEAD" ||
            args[1] === "HEAD^")) ||
        (args.length === 4 &&
          args[1] === "--verify" &&
          args[2] === "--quiet" &&
          safeCommitExpression(args[3] ?? ""))
      );
    case "status":
      return (
        args.length === 5 &&
        args[1] === "--porcelain=v1" &&
        args[2] === "-z" &&
        args[3] === "--untracked-files=all" &&
        args[4] === "--ignored=matching"
      );
    case "commit":
      return (
        args.length === 4 &&
        args[1] === "--no-gpg-sign" &&
        args[2] === "-m" &&
        positional(args[3] ?? "")
      );
    case "push":
      return (
        args.length === 4 &&
        args[1] === "--porcelain" &&
        safeRemote(args[2] ?? "") &&
        safeSha((args[3] ?? "").split(":", 1)[0] ?? "") &&
        /^refs\/heads\//u.test((args[3] ?? "").split(":", 2)[1] ?? "") &&
        safeBranch((args[3] ?? "").split("refs/heads/", 2)[1] ?? "")
      );
    case "ls-remote":
      return (
        args.length === 4 &&
        args[1] === "--heads" &&
        safeRemote(args[2] ?? "") &&
        safeBranch(args[3] ?? "")
      );
    case "show":
      return (
        args.length === 4 &&
        args[1] === "-s" &&
        args[2] === "--format=%s" &&
        args[3] === "HEAD"
      );
    case "worktree":
      return (
        (args.length === 3 &&
          args[1] === "list" &&
          args[2] === "--porcelain") ||
        (args.length === 5 &&
          args[1] === "add" &&
          args[2] === "--detach" &&
          positional(args[3] ?? "") &&
          safeSha(args[4] ?? ""))
      );
    case "cat-file":
      return (
        args.length === 3 &&
        (args[1] === "-e" || args[1] === "-t") &&
        safeCommitExpression(args[2] ?? "")
      );
    default:
      return false;
  }
}

function invalidResult(
  reason: "cancelled" | "invalid" = "invalid",
): F13GitCommandResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: reason === "cancelled" ? "cancelled" : "invalid git command",
    timedOut: false,
    cancelled: reason === "cancelled",
    outputLimitExceeded: false,
    started: false,
  };
}

function boundedTimeout(value: number | undefined): number {
  return Math.max(250, Math.min(value ?? F13_DEFAULT_GIT_TIMEOUT_MS, 300_000));
}

function validWorkingDirectory(cwd: string): boolean {
  return (
    typeof cwd === "string" &&
    cwd.length > 0 &&
    Buffer.byteLength(cwd, "utf8") <= F13_GIT_MAX_PATH_BYTES
  );
}

function allowedArguments(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  const command = args[0];
  if (command === undefined || !ALLOWED_COMMANDS.has(command)) return false;
  if (args.length > 64) return false;
  return (
    args.every(
      (argument) =>
        typeof argument === "string" &&
        argument.length > 0 &&
        Buffer.byteLength(argument, "utf8") <= F13_GIT_MAX_PATH_BYTES &&
        !argument.includes("\u0000") &&
        !argument.includes("\r") &&
        !argument.includes("\n") &&
        !DISALLOWED_ARGUMENTS.some((pattern) => pattern.test(argument)),
    ) && allowedCommandShape(args)
  );
}

function controlledEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
    LANG: "C",
  };
}

function terminate(child: ChildProcess): void {
  try {
    child.kill();
  } catch {
    // The process may have exited between the bounded check and kill.
  }
}

/**
 * A deliberately small Git boundary.  Callers supply an argument vector, but
 * the runner rejects commands and flags outside the F13 read/materialize/
 * worktree/inspection/explicit-clear allowlist.  It never exposes inherited
 * credentials or a shell string to Git.
 */
export class DefaultF13GitCommandRunner implements F13GitCommandRunner {
  public async run(
    args: readonly string[],
    options: F13GitRunOptions,
  ): Promise<F13GitCommandResult> {
    if (!validWorkingDirectory(options.cwd) || !allowedArguments(args))
      return invalidResult();
    if (options.signal?.aborted) return invalidResult("cancelled");

    const maxOutputBytes = Math.max(
      4_096,
      Math.min(
        options.maxOutputBytes ?? F13_MAX_GIT_OUTPUT_BYTES,
        F13_MAX_GIT_OUTPUT_BYTES,
      ),
    );
    const timeoutMs = boundedTimeout(options.timeoutMs);

    return new Promise<F13GitCommandResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn("git", [...args], {
          cwd: options.cwd,
          env: controlledEnvironment(),
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        resolve({
          ...invalidResult(),
          stderr: "git process could not be started",
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let cancelled = false;
      let outputLimitExceeded = false;
      let settled = false;
      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve({
          ok: exitCode === 0 && !timedOut && !cancelled && !outputLimitExceeded,
          exitCode,
          stdout,
          stderr,
          timedOut,
          cancelled,
          outputLimitExceeded,
          started: true,
        });
      };

      const append = (target: "stdout" | "stderr", value: Buffer): void => {
        outputBytes += value.byteLength;
        if (outputBytes > maxOutputBytes) {
          outputLimitExceeded = true;
          terminate(child);
          return;
        }
        const decoded = value.toString("utf8");
        if (target === "stdout") stdout += decoded;
        else stderr += decoded;
      };

      const onAbort = (): void => {
        if (settled) return;
        cancelled = true;
        terminate(child);
      };

      child.stdout?.on("data", (value: Buffer) => append("stdout", value));
      child.stderr?.on("data", (value: Buffer) => append("stderr", value));
      child.once("error", () => finish(null));
      child.once("close", (code) =>
        finish(typeof code === "number" ? code : null),
      );
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        terminate(child);
      }, timeoutMs);
    });
  }
}

export function createF13GitCommandRunner(): F13GitCommandRunner {
  return new DefaultF13GitCommandRunner();
}
