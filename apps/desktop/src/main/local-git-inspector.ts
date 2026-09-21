import { execFile as execFileCallback } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  MAX_LOCAL_CLONE_PATH_LENGTH,
  MAX_LOCAL_GIT_OUTPUT_BYTES,
  type ManagedPrLocalCleanState,
  type ManagedPrLocalSetupStatus,
  type ManagedPrReason,
} from "../shared/managed-pr";
import {
  validateGithubOwner,
  validateGithubRepositoryName,
  type GithubRemoteServerIdentity,
  type GithubRepositoryIdentity,
} from "../shared/github-rest";

const execFile = promisify(execFileCallback);
const INSPECTOR_VERSION = "f07-git-inspector-v1";

export interface ReadOnlyGitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface ReadOnlyGitCommandRunner {
  run(
    args: readonly string[],
    options: { readonly cwd: string; readonly timeoutMs: number },
  ): Promise<ReadOnlyGitCommandResult>;
}

export interface LocalGitInspectorOptions {
  readonly runner?: ReadOnlyGitCommandRunner;
  readonly timeoutMs?: number;
  readonly now?: () => string;
}

export interface LocalCloneInspectionSuccess {
  readonly ok: true;
  readonly canonicalRoot: string;
  readonly repository: {
    readonly serverKey: string;
    readonly owner: string;
    readonly name: string;
    readonly key: string;
  };
  readonly status: Exclude<ManagedPrLocalSetupStatus, "LOCAL_CLONE_REQUIRED">;
  readonly cleanState: ManagedPrLocalCleanState;
  readonly validationSnapshot: {
    readonly inspectorVersion: typeof INSPECTOR_VERSION;
    readonly validatedAt: string;
    readonly remoteCount: number;
    readonly worktreeRoot: string;
  };
}

export interface LocalCloneInspectionFailure {
  readonly ok: false;
  readonly status: Exclude<ManagedPrLocalSetupStatus, "LOCAL_CLONE_REQUIRED" | "VALID" | "DIRTY">;
  readonly reason: ManagedPrReason;
}

export type LocalCloneInspection = LocalCloneInspectionSuccess | LocalCloneInspectionFailure;

function defaultClock(): () => string {
  return () => new Date().toISOString();
}

function safeCorrelation(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
    ? value
    : "f07-local-clone";
}

function reason(
  code: string,
  category: ManagedPrReason["category"],
  what: string,
  why: string,
  nextAction: ManagedPrReason["nextAction"],
  correlationId: string,
): ManagedPrReason {
  return {
    code,
    category,
    what,
    why,
    nextAction,
    correlationId: safeCorrelation(correlationId),
  };
}

function boundedOutput(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= MAX_LOCAL_GIT_OUTPUT_BYTES;
}

function trimOutput(value: string): string {
  return value.replace(/[\r\n]+$/u, "");
}

function defaultRunner(): ReadOnlyGitCommandRunner {
  return {
    async run(args, options): Promise<ReadOnlyGitCommandResult> {
      const pathValue = process.env.Path ?? process.env.PATH ?? "";
      const result = await execFile("git", [...args], {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: MAX_LOCAL_GIT_OUTPUT_BYTES,
        windowsHide: true,
        env: {
          PATH: pathValue,
          Path: pathValue,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          LC_ALL: "C",
          LANG: "C",
        },
      });
      return {
        stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout),
        stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr),
      };
    },
  };
}

function remoteHost(server: GithubRemoteServerIdentity): string {
  try {
    return new URL(server.webOrigin).hostname.toLowerCase();
  } catch {
    return server.host.toLowerCase();
  }
}

function remoteRepository(
  value: string,
  server: GithubRemoteServerIdentity,
): { readonly owner: string; readonly name: string } | undefined {
  const raw = value.trim();
  let host: string | undefined;
  let repositoryPath: string | undefined;
  if (/^https?:\/\//iu.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "")
      return undefined;
    host = parsed.hostname.toLowerCase();
    if (parsed.origin.toLowerCase() !== server.webOrigin.toLowerCase()) return undefined;
    repositoryPath = parsed.pathname;
  } else if (/^ssh:\/\//iu.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== "ssh:" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return undefined;
    host = parsed.hostname.toLowerCase();
    if (host !== remoteHost(server)) return undefined;
    repositoryPath = parsed.pathname;
  } else {
    const scp = /^(?:[^@/:]+@)?([^:]+):(.+)$/u.exec(raw);
    if (scp === null) return undefined;
    host = scp[1]?.toLowerCase();
    repositoryPath = scp[2];
    if (host === undefined || host !== remoteHost(server)) return undefined;
  }
  if (host === undefined || repositoryPath === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(repositoryPath);
  } catch {
    return undefined;
  }
  const parts = decoded.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "").split("/");
  if (parts.length !== 2) return undefined;
  const owner = parts[0];
  const name = parts[1];
  if (owner === undefined || name === undefined || !validateGithubOwner(owner) || !validateGithubRepositoryName(name)) return undefined;
  return { owner, name };
}

function matchRepository(
  parsed: { readonly owner: string; readonly name: string },
  expected: GithubRepositoryIdentity,
): boolean {
  return parsed.owner.toLowerCase() === expected.owner.toLowerCase() && parsed.name.toLowerCase() === expected.name.toLowerCase();
}

export class LocalGitInspector {
  private readonly runner: ReadOnlyGitCommandRunner;
  private readonly timeoutMs: number;
  private readonly now: () => string;

  public constructor(options: LocalGitInspectorOptions = {}) {
    this.runner = options.runner ?? defaultRunner();
    this.timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 10_000, 10_000));
    this.now = options.now ?? defaultClock();
  }

  public async inspect(input: {
    readonly path: string;
    readonly server: GithubRemoteServerIdentity;
    readonly expectedRepository: GithubRepositoryIdentity;
    readonly correlationId?: string;
  }): Promise<LocalCloneInspection> {
    const correlationId = input.correlationId ?? "f07-local-clone";
    if (typeof input.path !== "string" || !path.isAbsolute(input.path) || input.path.length > MAX_LOCAL_CLONE_PATH_LENGTH)
      return {
        ok: false,
        status: "INVALID",
        reason: reason("INVALID_LOCAL_PATH", "LOCAL_PATH", "The selected path is not a bounded absolute directory path.", "A folder outside the allowed path policy cannot be inspected safely.", "SELECT_CLONE", correlationId),
      };
    let canonicalRoot: string;
    try {
      const file = await lstat(input.path);
      if (!file.isDirectory())
        return {
          ok: false,
          status: "INVALID",
          reason: reason("NOT_DIRECTORY", "LOCAL_PATH", "The selected path is not a directory.", "Select the root of an existing local clone.", "SELECT_CLONE", correlationId),
        };
      canonicalRoot = await realpath(input.path);
    } catch {
      return {
        ok: false,
        status: "MISSING",
        reason: reason("LOCAL_PATH_MISSING", "LOCAL_PATH", "The selected local clone could not be opened.", "The directory is missing or inaccessible; choose another existing clone.", "SELECT_CLONE", correlationId),
      };
    }
    if (canonicalRoot.length > MAX_LOCAL_CLONE_PATH_LENGTH)
      return {
        ok: false,
        status: "INVALID",
        reason: reason("LOCAL_PATH_TOO_LONG", "LOCAL_PATH", "The canonical local clone path is too long.", "Choose a shorter existing clone path.", "SELECT_CLONE", correlationId),
      };

    const rootResult = await this.run(canonicalRoot, ["-C", canonicalRoot, "rev-parse", "--show-toplevel"]);
    if (!rootResult.ok)
      return {
        ok: false,
        status: "INVALID",
        reason: reason("NOT_A_GIT_WORKTREE", "LOCAL_GIT", "The selected directory is not a usable Git worktree.", "Select an existing non-bare Git clone.", "SELECT_CLONE", correlationId),
      };
    const worktreeRoot = trimOutput(rootResult.stdout);
    if (!boundedOutput(worktreeRoot) || worktreeRoot.length === 0)
      return {
        ok: false,
        status: "INVALID",
        reason: reason("GIT_ROOT_UNSAFE", "LOCAL_GIT", "Git returned an unsafe worktree root.", "Select another local clone.", "SELECT_CLONE", correlationId),
      };
    let canonicalWorktreeRoot: string;
    try {
      canonicalWorktreeRoot = await realpath(worktreeRoot);
    } catch {
      return {
        ok: false,
        status: "INVALID",
        reason: reason("GIT_ROOT_MISSING", "LOCAL_GIT", "The Git worktree root is no longer available.", "Select another local clone.", "SELECT_CLONE", correlationId),
      };
    }
    const bareResult = await this.run(canonicalRoot, ["-C", canonicalRoot, "rev-parse", "--is-bare-repository"]);
    if (!bareResult.ok || trimOutput(bareResult.stdout) !== "false")
      return {
        ok: false,
        status: "INVALID",
        reason: reason("BARE_REPOSITORY", "LOCAL_GIT", "The selected directory is a bare repository and cannot be used as a developer clone.", "Select a non-bare Git worktree.", "SELECT_CLONE", correlationId),
      };

    const remotesResult = await this.run(canonicalWorktreeRoot, ["-C", canonicalWorktreeRoot, "remote"]);
    if (!remotesResult.ok || !boundedOutput(remotesResult.stdout))
      return {
        ok: false,
        status: "INVALID",
        reason: reason("REMOTE_INSPECTION_FAILED", "LOCAL_GIT", "The local Git remotes could not be inspected safely.", "Verify the clone is readable and choose it again.", "SELECT_CLONE", correlationId),
      };
    const remoteNames = trimOutput(remotesResult.stdout).split(/\r?\n/u).map((value) => value.trim()).filter((value) => value.length > 0);
    if (remoteNames.length === 0)
      return {
        ok: false,
        status: "INVALID",
        reason: reason("NO_REMOTE_IDENTITY", "LOCAL_GIT", "The local clone has no remote identity that can be matched.", "Add a remote for the PR base repository or choose another clone.", "SELECT_CLONE", correlationId),
      };
    const identities: Array<{ readonly owner: string; readonly name: string }> = [];
    for (const remoteName of remoteNames) {
      const remoteResult = await this.run(canonicalWorktreeRoot, ["-C", canonicalWorktreeRoot, "remote", "get-url", "--all", remoteName]);
      if (!remoteResult.ok || !boundedOutput(remoteResult.stdout))
        return {
          ok: false,
          status: "INVALID",
          reason: reason("REMOTE_IDENTITY_UNSAFE", "LOCAL_GIT", "A local remote could not be parsed into a safe repository identity.", "Remove the ambiguous remote or choose another clone.", "SELECT_CLONE", correlationId),
        };
      for (const remoteUrl of trimOutput(remoteResult.stdout).split(/\r?\n/u).filter((value) => value.length > 0)) {
        if (/^https?:\/\//iu.test(remoteUrl)) {
          try {
            const parsed = new URL(remoteUrl);
            if (parsed.username !== "" || parsed.password !== "")
              return {
                ok: false,
                status: "INVALID",
                reason: reason("REMOTE_CREDENTIALS_REJECTED", "LOCAL_GIT", "A local remote contains embedded credentials and was rejected.", "Remove credentials from the remote URL and choose the clone again.", "SELECT_CLONE", correlationId),
              };
          } catch {
            // The identity parser below returns a bounded mismatch reason.
          }
        }
        const identity = remoteRepository(remoteUrl, input.server);
        if (identity !== undefined) identities.push(identity);
      }
    }
    if (!identities.some((identity) => matchRepository(identity, input.expectedRepository)))
      return {
        ok: false,
        status: "INVALID",
        reason: reason("REMOTE_REPOSITORY_MISMATCH", "LOCAL_GIT", "The local clone remotes do not prove the PR base repository identity.", "Select a clone whose remote points to the PR base repository.", "SELECT_CLONE", correlationId),
      };

    const statusResult = await this.run(canonicalWorktreeRoot, ["-C", canonicalWorktreeRoot, "status", "--porcelain=v1", "--untracked-files=all"]);
    const cleanState: ManagedPrLocalCleanState = !statusResult.ok
      ? "UNKNOWN"
      : trimOutput(statusResult.stdout).length === 0
        ? "CLEAN"
        : "DIRTY";
    const status: Exclude<ManagedPrLocalSetupStatus, "LOCAL_CLONE_REQUIRED"> = cleanState === "CLEAN" ? "VALID" : cleanState === "DIRTY" ? "DIRTY" : "UNKNOWN";
    return {
      ok: true,
      canonicalRoot: canonicalWorktreeRoot,
      repository: {
        serverKey: input.expectedRepository.server.serverKey,
        owner: input.expectedRepository.owner,
        name: input.expectedRepository.name,
        key: input.expectedRepository.key,
      },
      status,
      cleanState,
      validationSnapshot: {
        inspectorVersion: INSPECTOR_VERSION,
        validatedAt: this.now(),
        remoteCount: identities.length,
        worktreeRoot: canonicalWorktreeRoot,
      },
    };
  }

  private async run(
    cwd: string,
    args: readonly string[],
  ): Promise<{ readonly ok: true; readonly stdout: string; readonly stderr: string } | { readonly ok: false }> {
    try {
      const result = await this.runner.run(args, { cwd, timeoutMs: this.timeoutMs });
      if (!boundedOutput(result.stdout) || !boundedOutput(result.stderr)) return { ok: false };
      return { ok: true, stdout: result.stdout, stderr: result.stderr };
    } catch {
      return { ok: false };
    }
  }
}
