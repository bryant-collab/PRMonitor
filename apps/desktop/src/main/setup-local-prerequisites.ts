import { execFile } from "node:child_process";
import {
  createF29ControlledEnvironment,
  f29PathWithin,
  validateF29PathSyntax,
  type F29PathPlatform,
} from "../shared/f29-security";
import type { F13WorktreeService } from "./f13-service-impl";
import type { SetupLocalPrerequisites } from "./setup-readiness-service";

export interface SetupGitVersionInput {
  readonly executable: string;
  readonly args: readonly ["--version"];
  readonly env: Record<string, string>;
  readonly timeoutMs: number;
}
export interface SetupGitVersionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly timedOut?: boolean;
}
export interface SetupLocalPrerequisitesOptions {
  readonly resolveRoot: F13WorktreeService["resolveRoot"];
  readonly readWorktreeRoot: () => {
    readonly worktreeRoot?: string;
    readonly rootRevision: number;
  };
  readonly persistenceHealthy: () => boolean | Promise<boolean>;
  readonly protectedRoots: readonly string[];
  readonly developerClonePaths: () => readonly string[];
  readonly timeoutMs?: number;
  readonly gitExecutable?: string;
  readonly environmentSource?: Record<string, string | undefined>;
  readonly runGitVersion?: (
    input: SetupGitVersionInput,
  ) => Promise<SetupGitVersionResult>;
  readonly platform?: F29PathPlatform;
}

const ENVIRONMENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "ComSpec",
  "GIT_TERMINAL_PROMPT",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_OPTIONAL_LOCKS",
];

function runGitVersion(
  input: SetupGitVersionInput,
): Promise<SetupGitVersionResult> {
  return new Promise((resolve) => {
    execFile(
      input.executable,
      [...input.args],
      {
        env: input.env,
        shell: false,
        windowsHide: true,
        timeout: input.timeoutMs,
        maxBuffer: 8192,
        encoding: "utf8",
      },
      (error, stdout) => {
        resolve({
          exitCode:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : null,
          stdout,
          ...(error?.killed === true ? { timedOut: true } : {}),
        });
      },
    );
  });
}

/** Read-only local preflight; no directories, worktrees, settings, or credentials are created. */
export function createSetupLocalPrerequisitesReader(
  options: SetupLocalPrerequisitesOptions,
): () => Promise<SetupLocalPrerequisites> {
  const timeoutMs = Math.min(30_000, Math.max(1, options.timeoutMs ?? 5_000));
  const platform =
    options.platform ?? (process.platform === "win32" ? "win32" : "posix");
  async function bounded<T>(read: () => T | Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(read),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("LOCAL_PREFLIGHT_TIMEOUT")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  function safeRoot(root: string): boolean {
    if (root.split(/[\\/]+/u).some((segment) => segment === "..")) return false;
    if (
      platform === "win32" &&
      (!/^[A-Za-z]:[\\/]/u.test(root) || root.slice(2).includes(":"))
    )
      return false;
    return (
      validateF29PathSyntax(root, { platform }).ok &&
      options.protectedRoots.every(
        (protectedRoot) =>
          validateF29PathSyntax(protectedRoot, { platform }).ok &&
          !f29PathWithin(protectedRoot, root, platform) &&
          !f29PathWithin(root, protectedRoot, platform),
      )
    );
  }
  async function git(): Promise<SetupLocalPrerequisites["git"]> {
    const source: Record<string, string | undefined> = {};
    const environment = options.environmentSource ?? process.env;
    for (const key of ENVIRONMENT_KEYS) {
      const sourceKey = Object.keys(environment).find(
        (candidate) => candidate.toLowerCase() === key.toLowerCase(),
      );
      source[key] =
        sourceKey === undefined ? undefined : environment[sourceKey];
    }
    source.GIT_TERMINAL_PROMPT = "0";
    source.GIT_CONFIG_NOSYSTEM = "1";
    source.GIT_OPTIONAL_LOCKS = "0";
    const controlled = createF29ControlledEnvironment({
      source,
      allowedKeys: ENVIRONMENT_KEYS,
      strict: true,
    });
    if (!controlled.ok) return "unavailable";
    const result = await bounded(() =>
      (options.runGitVersion ?? runGitVersion)({
        executable: options.gitExecutable ?? "git",
        args: ["--version"],
        env: controlled.value,
        timeoutMs,
      }),
    );
    if (result.timedOut) return "unavailable";
    return result.exitCode === 0 &&
      /^git version \d+\.\d+(?:\.\d+)?(?:[. -][\w.-]+)?\s*$/u.test(
        result.stdout,
      )
      ? "ready"
      : "missing";
  }
  async function root(): Promise<SetupLocalPrerequisites["worktreeRoot"]> {
    const configured = options.readWorktreeRoot();
    if (
      configured.worktreeRoot !== undefined &&
      !safeRoot(configured.worktreeRoot)
    )
      return "invalid";
    const result = await bounded(() =>
      options.resolveRoot({
        ...configured,
        developerClonePaths: options.developerClonePaths(),
      }),
    );
    if (
      !result.ok ||
      result.canonicalPath === undefined ||
      !safeRoot(result.canonicalPath)
    )
      return "invalid";
    return "ready";
  }
  return async () => {
    const [gitResult, storageResult, rootResult] = await Promise.allSettled([
      git(),
      bounded(options.persistenceHealthy),
      root(),
    ]);
    return {
      git: gitResult.status === "fulfilled" ? gitResult.value : "unavailable",
      storage:
        storageResult.status === "fulfilled"
          ? storageResult.value
            ? "ready"
            : "failed"
          : "unavailable",
      worktreeRoot:
        rootResult.status === "fulfilled" ? rootResult.value : "unavailable",
    };
  };
}
