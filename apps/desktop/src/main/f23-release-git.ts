import { createHash } from "node:crypto";
import path from "node:path";
import type { F23GitPublisher } from "./f23-release-service";
import type { F23PublicationCandidate } from "../shared/f23-release";
import {
  createF13GitCommandRunner,
  type F13GitCommandRunner,
  type F13GitCommandResult,
} from "./f13-git";

export interface F23GitPublisherOptions {
  readonly runner?: F13GitCommandRunner;
  readonly remoteName?: string;
  readonly timeoutMs?: number;
}

function uncertain(result: F13GitCommandResult): boolean {
  return (
    result.timedOut ||
    result.cancelled ||
    result.outputLimitExceeded ||
    result.exitCode === null
  );
}

function validCandidate(candidate: F23PublicationCandidate): boolean {
  return (
    path.isAbsolute(candidate.worktreePath) &&
    candidate.worktreePath.length <= 4_096 &&
    candidate.changedFiles.every(
      (file) =>
        !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(file) &&
        !file.split(/[\\/]/u).includes(".."),
    ) &&
    (candidate.trackedFiles === undefined ||
      candidate.trackedFiles.every(
        (file) =>
          !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(file) &&
          !file.split(/[\\/]/u).includes(".."),
      )) &&
    (candidate.untrackedFiles === undefined ||
      candidate.untrackedFiles.every(
        (file) =>
          !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(file) &&
          !file.split(/[\\/]/u).includes(".."),
      )) &&
    !candidate.commitMessage.includes("\u0000") &&
    !candidate.commitMessage.includes("\r") &&
    !candidate.commitMessage.includes("\n")
  );
}

function patchHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nulSeparatedPaths(result: F13GitCommandResult): string[] | undefined {
  if (!result.ok) return undefined;
  return result.stdout.split("\u0000").filter((value) => value.length > 0);
}

function samePaths(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const normalize = (values: readonly string[]) =>
    [...values].sort((left, right) => left.localeCompare(right));
  return (
    JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
  );
}

function expectedPatchMatches(
  candidate: F23PublicationCandidate,
  patch: string,
): boolean {
  return candidate.untrackedFiles !== undefined &&
    candidate.untrackedFiles.length === 0 &&
    candidate.proposedPatchHash !== undefined &&
    /^[a-f0-9]{64}$/iu.test(candidate.proposedPatchHash)
    ? patchHash(patch) === candidate.proposedPatchHash
    : true;
}

function headSha(result: F13GitCommandResult): string | undefined {
  const value = result.stdout.trim();
  return /^[0-9a-f]{7,64}$/iu.test(value) ? value : undefined;
}

function remoteSha(
  result: F13GitCommandResult,
  branch: string,
): string | undefined {
  const expectedRef = `refs/heads/${branch}`;
  const line = result.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.endsWith(`\t${expectedRef}`));
  const value = line?.split(/\s+/u)[0];
  return value !== undefined && /^[0-9a-f]{7,64}$/iu.test(value)
    ? value
    : undefined;
}

export class F23DeterministicGitPublisher implements F23GitPublisher {
  private readonly runner: F13GitCommandRunner;
  private readonly remoteName: string;
  private readonly timeoutMs: number;

  public constructor(options: F23GitPublisherOptions = {}) {
    this.runner = options.runner ?? createF13GitCommandRunner();
    this.remoteName = options.remoteName ?? "origin";
    this.timeoutMs = Math.max(
      250,
      Math.min(options.timeoutMs ?? 120_000, 300_000),
    );
  }

  public async commitCandidate(input: {
    readonly candidate: F23PublicationCandidate;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F23GitPublisher["commitCandidate"]>>> {
    const candidate = input.candidate;
    if (!validCandidate(candidate))
      return { outcome: "FAILED", reason: "INVALID_CANDIDATE_PATH_OR_MESSAGE" };
    if (candidate.changedFiles.length === 0)
      return { outcome: "NO_CODE_CHANGE" };
    const cwd = candidate.worktreePath;
    const currentHead = await this.run(["rev-parse", "HEAD"], cwd);
    if (!currentHead.ok || headSha(currentHead) !== candidate.baselineSha)
      return {
        outcome: uncertain(currentHead) ? "UNCERTAIN" : "FAILED",
        reason: "WORKTREE_BASELINE_MISMATCH",
      };
    const reset = await this.run(["reset", "HEAD", "--"], cwd);
    if (!reset.ok)
      return {
        outcome: uncertain(reset) ? "UNCERTAIN" : "FAILED",
        reason: "UNSTAGE_APPROVED_PATHS_FAILED",
      };
    const add = await this.run(
      ["add", "--all", "--", ...candidate.changedFiles],
      cwd,
    );
    if (!add.ok)
      return {
        outcome: uncertain(add) ? "UNCERTAIN" : "FAILED",
        reason: "STAGE_APPROVED_PATHS_FAILED",
      };
    const staged = await this.run(
      [
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--no-color",
        "--full-index",
        "--find-renames",
        candidate.baselineSha,
        "--",
      ],
      cwd,
    );
    if (!staged.ok)
      return {
        outcome: uncertain(staged) ? "UNCERTAIN" : "FAILED",
        reason: "VERIFY_STAGED_DIFF_FAILED",
      };
    if (staged.stdout.length === 0) return { outcome: "NO_CODE_CHANGE" };
    const stagedPathsResult = await this.run(
      [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--find-renames",
        candidate.baselineSha,
        "--",
      ],
      cwd,
    );
    const stagedPaths = nulSeparatedPaths(stagedPathsResult);
    if (stagedPaths === undefined)
      return {
        outcome: uncertain(stagedPathsResult) ? "UNCERTAIN" : "FAILED",
        reason: "VERIFY_STAGED_PATHS_FAILED",
      };
    if (!samePaths(stagedPaths, candidate.changedFiles))
      return { outcome: "FAILED", reason: "STAGED_PATH_SET_MISMATCH" };
    if (!expectedPatchMatches(candidate, staged.stdout))
      return { outcome: "FAILED", reason: "STAGED_PATCH_HASH_MISMATCH" };
    const commit = await this.run(
      ["commit", "--no-gpg-sign", "-m", candidate.commitMessage],
      cwd,
    );
    if (!commit.ok)
      return {
        outcome: uncertain(commit) ? "UNCERTAIN" : "FAILED",
        reason: "COMMIT_FAILED",
      };
    const head = await this.run(["rev-parse", "HEAD"], cwd);
    const commitSha = headSha(head);
    if (!head.ok || commitSha === undefined)
      return {
        outcome: uncertain(head) ? "UNCERTAIN" : "FAILED",
        reason: "COMMIT_SHA_UNAVAILABLE",
      };
    const identity = await this.verifyCommitIdentity(candidate, cwd);
    if (identity === "UNKNOWN")
      return { outcome: "UNCERTAIN", reason: "COMMIT_IDENTITY_UNAVAILABLE" };
    if (identity === "MISMATCH")
      return { outcome: "UNCERTAIN", reason: "COMMIT_IDENTITY_MISMATCH" };
    return { outcome: "COMMITTED", commitSha };
  }

  public async pushCommit(input: {
    readonly candidate: F23PublicationCandidate;
    readonly commitSha: string;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F23GitPublisher["pushCommit"]>>> {
    if (
      !validCandidate(input.candidate) ||
      !/^[0-9a-f]{7,64}$/iu.test(input.commitSha)
    )
      return { outcome: "FAILED", reason: "INVALID_PUSH_IDENTITY" };
    const result = await this.run(
      [
        "push",
        "--porcelain",
        this.remoteName,
        `${input.commitSha}:refs/heads/${input.candidate.headBranch}`,
      ],
      input.candidate.worktreePath,
    );
    if (result.ok) return { outcome: "PUSHED" };
    return {
      outcome: uncertain(result) ? "UNCERTAIN" : "FAILED",
      reason: "PUSH_FAILED",
    };
  }

  public async reconcileCommit(input: {
    readonly candidate: F23PublicationCandidate;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F23GitPublisher["reconcileCommit"]>>> {
    if (!validCandidate(input.candidate))
      return { outcome: "UNKNOWN", reason: "INVALID_CANDIDATE" };
    const result = await this.run(
      ["rev-parse", "HEAD"],
      input.candidate.worktreePath,
    );
    if (!result.ok && uncertain(result))
      return { outcome: "UNKNOWN", reason: "HEAD_READ_UNCERTAIN" };
    const sha = headSha(result);
    if (sha === undefined)
      return { outcome: "UNKNOWN", reason: "HEAD_SHA_UNAVAILABLE" };
    if (sha === input.candidate.baselineSha) return { outcome: "ABSENT" };
    const identity = await this.verifyCommitIdentity(
      input.candidate,
      input.candidate.worktreePath,
    );
    if (identity === "UNKNOWN")
      return { outcome: "UNKNOWN", reason: "COMMIT_IDENTITY_UNAVAILABLE" };
    if (identity === "MISMATCH")
      return { outcome: "UNKNOWN", reason: "COMMIT_IDENTITY_MISMATCH" };
    return { outcome: "PRESENT", commitSha: sha };
  }

  public async reconcilePush(input: {
    readonly candidate: F23PublicationCandidate;
    readonly commitSha: string;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F23GitPublisher["reconcilePush"]>>> {
    if (!validCandidate(input.candidate))
      return { outcome: "UNKNOWN", reason: "INVALID_CANDIDATE" };
    const result = await this.run(
      ["ls-remote", "--heads", this.remoteName, input.candidate.headBranch],
      input.candidate.worktreePath,
    );
    if (!result.ok && uncertain(result))
      return { outcome: "UNKNOWN", reason: "REMOTE_REF_READ_UNCERTAIN" };
    if (!result.ok) return { outcome: "ABSENT" };
    const sha = remoteSha(result, input.candidate.headBranch);
    if (sha === input.commitSha) return { outcome: "PRESENT" };
    if (sha === undefined) return { outcome: "ABSENT" };
    return { outcome: "UNKNOWN", reason: "REMOTE_REF_HAS_DIFFERENT_SHA" };
  }

  private run(
    args: readonly string[],
    cwd: string,
  ): Promise<F13GitCommandResult> {
    return this.runner.run(args, { cwd, timeoutMs: this.timeoutMs });
  }

  private async verifyCommitIdentity(
    candidate: F23PublicationCandidate,
    cwd: string,
  ): Promise<"MATCH" | "MISMATCH" | "UNKNOWN"> {
    const parent = await this.run(["rev-parse", "HEAD^"], cwd);
    const parentSha = headSha(parent);
    if (!parent.ok || parentSha === undefined) return "UNKNOWN";
    if (parentSha !== candidate.baselineSha) return "MISMATCH";

    const message = await this.run(["show", "-s", "--format=%s", "HEAD"], cwd);
    if (!message.ok) return "UNKNOWN";
    if (message.stdout.trim() !== candidate.commitMessage) return "MISMATCH";

    const pathsResult = await this.run(
      [
        "diff",
        "--name-only",
        "-z",
        "--find-renames",
        candidate.baselineSha,
        "HEAD",
        "--",
      ],
      cwd,
    );
    const paths = nulSeparatedPaths(pathsResult);
    if (paths === undefined) return "UNKNOWN";
    if (!samePaths(paths, candidate.changedFiles)) return "MISMATCH";

    if (
      candidate.untrackedFiles !== undefined &&
      candidate.untrackedFiles.length === 0 &&
      candidate.proposedPatchHash !== undefined &&
      /^[a-f0-9]{64}$/iu.test(candidate.proposedPatchHash)
    ) {
      const patch = await this.run(
        [
          "diff",
          "--binary",
          "--no-ext-diff",
          "--no-color",
          "--full-index",
          "--find-renames",
          candidate.baselineSha,
          "HEAD",
          "--",
        ],
        cwd,
      );
      if (!patch.ok) return "UNKNOWN";
      if (patchHash(patch.stdout) !== candidate.proposedPatchHash)
        return "MISMATCH";
    }
    return "MATCH";
  }
}
