import { execFile, spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  lstat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REQUIRED_GIT_VERSION = "2.55.0";
export const FIXTURE_OWNER = "prmonitor-f01-git-fixture";
export const FIXTURE_MARKER = ".prmonitor-f01-fixture-owner.json";

const CHILD_ENVIRONMENT_ALLOWLIST = new Set([
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CI",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
]);

const SECRET_NAME =
  /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION)/iu;

export class FoundationHarnessError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "FoundationHarnessError";
    this.code = code;
  }
}

export class GitUnavailableError extends FoundationHarnessError {
  public constructor(detail: string) {
    super(
      "GIT_UNAVAILABLE",
      `Git ${REQUIRED_GIT_VERSION} is required for F01 fixtures (${detail}). Install Git and ensure it is available on PATH.`,
    );
    this.name = "GitUnavailableError";
  }
}

export function sanitizeChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  explicitNames: readonly string[] = [],
): NodeJS.ProcessEnv {
  const explicit = new Set(explicitNames);
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || SECRET_NAME.test(name)) continue;
    if (CHILD_ENVIRONMENT_ALLOWLIST.has(name) || explicit.has(name)) {
      result[name] = value;
    }
  }
  return result;
}

function gitExecutable(override?: string): string {
  return override ?? (process.platform === "win32" ? "git.exe" : "git");
}

function gitVersion(output: string): string {
  return output.match(/git version\s+(\d+\.\d+\.\d+)/iu)?.[1] ?? "";
}

async function runGit(
  executable: string,
  cwd: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = sanitizeChildEnvironment(),
): Promise<string> {
  try {
    const result = await execFileAsync(executable, [...args], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      env: environment,
    });
    return String(result.stdout).trim();
  } catch (error) {
    throw new FoundationHarnessError(
      "GIT_COMMAND_FAILED",
      `${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function assertGitAvailable(executable?: string): Promise<string> {
  const command = gitExecutable(executable);
  try {
    const output = await runGit(command, process.cwd(), ["--version"]);
    const version = gitVersion(output);
    if (version !== REQUIRED_GIT_VERSION) {
      throw new GitUnavailableError(
        `found ${version || "an unrecognized version"}`,
      );
    }
    return command;
  } catch (error) {
    if (error instanceof GitUnavailableError) throw error;
    throw new GitUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runBoundedProcess(
  executable: string,
  args: readonly string[],
  timeoutMs = 1_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const child = spawn(executable, [...args], {
    env: sanitizeChildEnvironment(),
    stdio: "ignore",
    windowsHide: true,
  });
  let timedOut = false;
  const outcome = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (timedOut) {
    throw new FoundationHarnessError(
      "PROCESS_TIMEOUT",
      `child process exceeded ${timeoutMs}ms`,
    );
  }
  return outcome;
}

function pathKey(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(pathKey(root), pathKey(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function assertSafeOwnedDirectory(directory: string): Promise<void> {
  let directoryInfo;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new FoundationHarnessError(
      "FIXTURE_CLEANUP_FAILED",
      `cannot inspect fixture root ${directory}`,
      { cause: error },
    );
  }

  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new FoundationHarnessError(
      "FIXTURE_CLEANUP_REFUSED",
      `fixture root is not a real directory: ${directory}`,
    );
  }

  const canonicalDirectory = await realpath(directory);
  const canonicalTemp = await realpath(os.tmpdir());
  if (!isWithin(canonicalTemp, canonicalDirectory)) {
    throw new FoundationHarnessError(
      "FIXTURE_CLEANUP_REFUSED",
      `fixture root escaped the temporary directory: ${directory}`,
    );
  }

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const info = await lstat(child);
      if (info.isSymbolicLink()) {
        throw new FoundationHarnessError(
          "FIXTURE_CLEANUP_REFUSED",
          `reparse/symlink path detected: ${child}`,
        );
      }
      const canonicalChild = await realpath(child);
      if (!isWithin(canonicalDirectory, canonicalChild)) {
        throw new FoundationHarnessError(
          "FIXTURE_CLEANUP_REFUSED",
          `child escaped fixture root: ${child}`,
        );
      }
      if (info.isDirectory()) await visit(child);
    }
  }

  await visit(directory);
}

export async function cleanupOwnedDirectory(
  directory: string,
  owner: string = FIXTURE_OWNER,
  markerName: string = FIXTURE_MARKER,
): Promise<void> {
  try {
    const markerPath = path.join(directory, markerName);
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
      owner?: unknown;
      directory?: unknown;
    };
    if (
      marker.owner !== owner ||
      marker.directory !== path.resolve(directory)
    ) {
      throw new FoundationHarnessError(
        "FIXTURE_CLEANUP_REFUSED",
        "ownership marker mismatch",
      );
    }
    await assertSafeOwnedDirectory(directory);
    // Re-read the marker immediately before deletion so a check/delete race
    // fails closed when the owner changes after the first inspection.
    const finalMarker = JSON.parse(await readFile(markerPath, "utf8")) as {
      owner?: unknown;
      directory?: unknown;
    };
    if (
      finalMarker.owner !== owner ||
      finalMarker.directory !== path.resolve(directory)
    ) {
      throw new FoundationHarnessError(
        "FIXTURE_CLEANUP_REFUSED",
        "ownership changed before deletion",
      );
    }
    await rm(directory, { recursive: true, force: false });
  } catch (error) {
    if (error instanceof FoundationHarnessError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new FoundationHarnessError("FIXTURE_CLEANUP_FAILED", String(error), {
      cause: error,
    });
  }
}

export interface GitFixture {
  readonly path: string;
  readonly mainSha: string;
  readonly featureSha: string;
  readonly featureBranch: string;
  readonly featureTag: string;
  cleanup(): Promise<void>;
}

export interface GitFixtureOptions {
  readonly gitExecutable?: string;
}

export async function createGitFixture(
  options: GitFixtureOptions = {},
): Promise<GitFixture> {
  const executable = await assertGitAvailable(options.gitExecutable);
  const fixturePath = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-f01-git-"),
  );
  const marker = {
    owner: FIXTURE_OWNER,
    directory: path.resolve(fixturePath),
    version: 1,
  };
  const initialCommitEnvironment = sanitizeChildEnvironment(process.env, [
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_DATE",
  ]);
  initialCommitEnvironment.GIT_AUTHOR_DATE = "2000-01-01T00:00:00Z";
  initialCommitEnvironment.GIT_COMMITTER_DATE = "2000-01-01T00:00:00Z";
  const featureCommitEnvironment = sanitizeChildEnvironment(process.env, [
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_DATE",
  ]);
  featureCommitEnvironment.GIT_AUTHOR_DATE = "2000-01-01T00:01:00Z";
  featureCommitEnvironment.GIT_COMMITTER_DATE = "2000-01-01T00:01:00Z";

  try {
    await writeFile(
      path.join(fixturePath, FIXTURE_MARKER),
      `${JSON.stringify(marker)}\n`,
      "utf8",
    );
    await runGit(executable, fixturePath, [
      "init",
      "--quiet",
      "--initial-branch=main",
    ]);
    await runGit(executable, fixturePath, [
      "config",
      "user.name",
      "PRMonitor F01 Fixture",
    ]);
    await runGit(executable, fixturePath, [
      "config",
      "user.email",
      "f01.fixture@example.invalid",
    ]);
    await writeFile(
      path.join(fixturePath, "README.md"),
      "PRMonitor F01 fixture\n",
      "utf8",
    );
    await runGit(executable, fixturePath, ["add", "README.md"]);
    await runGit(
      executable,
      fixturePath,
      ["commit", "--quiet", "-m", "fixture: initial"],
      initialCommitEnvironment,
    );
    const mainSha = await runGit(executable, fixturePath, [
      "rev-parse",
      "HEAD",
    ]);
    const featureBranch = "fixture/feature";
    await runGit(executable, fixturePath, [
      "switch",
      "--create",
      featureBranch,
    ]);
    await writeFile(
      path.join(fixturePath, "feature.txt"),
      "deterministic feature\n",
      "utf8",
    );
    await runGit(executable, fixturePath, ["add", "feature.txt"]);
    await runGit(
      executable,
      fixturePath,
      ["commit", "--quiet", "-m", "fixture: feature"],
      featureCommitEnvironment,
    );
    const featureSha = await runGit(executable, fixturePath, [
      "rev-parse",
      "HEAD",
    ]);
    const featureTag = "fixture-v1";
    await runGit(executable, fixturePath, [
      "tag",
      "--annotate",
      featureTag,
      "--message",
      "fixture: v1",
    ]);

    return {
      path: path.resolve(fixturePath),
      mainSha,
      featureSha,
      featureBranch,
      featureTag,
      async cleanup(): Promise<void> {
        await cleanupOwnedDirectory(fixturePath);
      },
    };
  } catch (error) {
    await cleanupOwnedDirectory(fixturePath).catch(() => undefined);
    if (error instanceof FoundationHarnessError) throw error;
    throw new FoundationHarnessError("GIT_FIXTURE_FAILED", String(error), {
      cause: error,
    });
  }
}

export async function createOwnedDirectoryForTest(): Promise<{
  path: string;
  markerPath: string;
  cleanup(): Promise<void>;
}> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-f01-owned-"),
  );
  await mkdir(path.join(directory, "nested"));
  const markerPath = path.join(directory, FIXTURE_MARKER);
  await writeFile(
    markerPath,
    `${JSON.stringify({ owner: FIXTURE_OWNER, directory: path.resolve(directory), version: 1 })}\n`,
    "utf8",
  );
  return {
    path: directory,
    markerPath,
    cleanup: () => cleanupOwnedDirectory(directory),
  };
}

export async function directoryExists(directory: string): Promise<boolean> {
  return stat(directory)
    .then(() => true)
    .catch(() => false);
}
