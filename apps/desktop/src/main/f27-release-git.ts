import { createHash } from "node:crypto";
import path from "node:path";
import type {
  F27GitPublisher,
  F27MergeCandidate,
} from "../shared/f27-synchronization";
import {
  createF13GitCommandRunner,
  type F13GitCommandResult,
  type F13GitCommandRunner,
} from "./f13-git";

export interface F27GitPublisherOptions {
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

function sha(value: string): boolean {
  return /^[0-9a-f]{7,64}$/iu.test(value);
}

function validCandidate(candidate: F27MergeCandidate): boolean {
  return (
    path.isAbsolute(candidate.worktreePath) &&
    candidate.worktreePath.length <= 4_096 &&
    sha(candidate.expectedHeadSha) &&
    sha(candidate.sourceSha) &&
    sha(candidate.mergeBaseSha) &&
    candidate.expectedParentShas.length === 2 &&
    candidate.expectedParentShas.every(sha) &&
    candidate.changedFiles.every(
      (file) =>
        file.length > 0 &&
        !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(file) &&
        !file.split(/[\\/]/u).includes(".."),
    ) &&
    !candidate.commitMessage.includes("\u0000") &&
    !candidate.commitMessage.includes("\r") &&
    !candidate.commitMessage.includes("\n")
  );
}

function headSha(result: F13GitCommandResult): string | undefined {
  const value = result.stdout.trim();
  return sha(value) ? value : undefined;
}

function nulSeparatedPaths(result: F13GitCommandResult): string[] | undefined {
  if (!result.ok) return undefined;
  return result.stdout.split("\u0000").filter((value) => value.length > 0);
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (values: readonly string[]) =>
    [...values].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function patchHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function remoteSha(
  result: F13GitCommandResult,
  branch: string,
): string | undefined {
  const ref = `refs/heads/${branch}`;
  const line = result.stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.endsWith(`\t${ref}`));
  const value = line?.split(/\s+/u)[0];
  return value !== undefined && sha(value) ? value : undefined;
}

function expectedParents(
  result: F13GitCommandResult,
): readonly string[] | undefined {
  if (!result.ok) return undefined;
  const values = result.stdout.trim().split(/\s+/u).filter(Boolean);
  return values.length > 0 && values.every(sha) ? values : undefined;
}

export class F27DeterministicGitPublisher implements F27GitPublisher {
  private readonly runner: F13GitCommandRunner;
  private readonly remoteName: string;
  private readonly timeoutMs: number;

  public constructor(options: F27GitPublisherOptions = {}) {
    this.runner = options.runner ?? createF13GitCommandRunner();
    this.remoteName = options.remoteName ?? "origin";
    this.timeoutMs = Math.max(
      250,
      Math.min(options.timeoutMs ?? 120_000, 300_000),
    );
  }

  private run(
    args: readonly string[],
    cwd: string,
  ): Promise<F13GitCommandResult> {
    return this.runner.run(args, { cwd, timeoutMs: this.timeoutMs });
  }

  private async verifyCommit(
    candidate: F27MergeCandidate,
    commitSha: string,
  ): Promise<"MATCH" | "MISMATCH" | "UNKNOWN"> {
    const head = await this.run(["rev-parse", "HEAD"], candidate.worktreePath);
    if (!head.ok || headSha(head) !== commitSha)
      return uncertain(head) ? "UNKNOWN" : "MISMATCH";
    const parents = await this.run(
      ["show", "-s", "--format=%P", "HEAD"],
      candidate.worktreePath,
    );
    const actualParents = expectedParents(parents);
    if (actualParents === undefined)
      return uncertain(parents) ? "UNKNOWN" : "MISMATCH";
    if (!samePaths(actualParents, candidate.expectedParentShas))
      return "MISMATCH";
    const tree = await this.run(
      ["rev-parse", "--verify", "--quiet", `${commitSha}^{tree}`],
      candidate.worktreePath,
    );
    if (!tree.ok || !sha(tree.stdout.trim()))
      return uncertain(tree) ? "UNKNOWN" : "MISMATCH";
    return "MATCH";
  }

  public async commitMerge(input: {
    readonly candidate: F27MergeCandidate;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F27GitPublisher["commitMerge"]>>> {
    const candidate = input.candidate;
    if (!validCandidate(candidate))
      return { outcome: "FAILED", reason: "INVALID_CANDIDATE" };
    if (candidate.changedFiles.length === 0)
      return { outcome: "NO_CODE_CHANGE" };
    const current = await this.run(
      ["rev-parse", "HEAD"],
      candidate.worktreePath,
    );
    if (!current.ok || headSha(current) !== candidate.expectedHeadSha)
      return {
        outcome: uncertain(current) ? "UNCERTAIN" : "FAILED",
        reason: "WORKTREE_HEAD_MISMATCH",
      };
    const mergeHead = await this.run(
      ["rev-parse", "MERGE_HEAD"],
      candidate.worktreePath,
    );
    if (!mergeHead.ok || headSha(mergeHead) !== candidate.sourceSha)
      return {
        outcome: uncertain(mergeHead) ? "UNCERTAIN" : "FAILED",
        reason: "MERGE_PARENT_MISMATCH",
      };
    const add = await this.run(
      ["add", "--all", "--", ...candidate.changedFiles],
      candidate.worktreePath,
    );
    if (!add.ok)
      return {
        outcome: uncertain(add) ? "UNCERTAIN" : "FAILED",
        reason: "STAGE_FAILED",
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
        candidate.expectedHeadSha,
        "--",
      ],
      candidate.worktreePath,
    );
    if (!staged.ok)
      return {
        outcome: uncertain(staged) ? "UNCERTAIN" : "FAILED",
        reason: "STAGED_DIFF_UNAVAILABLE",
      };
    if (staged.stdout.length === 0) return { outcome: "NO_CODE_CHANGE" };
    if (
      candidate.proposedPatchHash !== undefined &&
      patchHash(staged.stdout) !== candidate.proposedPatchHash
    )
      return { outcome: "FAILED", reason: "STAGED_PATCH_MISMATCH" };
    const stagedPathsResult = await this.run(
      [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--find-renames",
        candidate.expectedHeadSha,
        "--",
      ],
      candidate.worktreePath,
    );
    const stagedPaths = nulSeparatedPaths(stagedPathsResult);
    if (stagedPaths === undefined)
      return {
        outcome: uncertain(stagedPathsResult) ? "UNCERTAIN" : "FAILED",
        reason: "STAGED_PATHS_UNAVAILABLE",
      };
    if (!samePaths(stagedPaths, candidate.changedFiles))
      return { outcome: "FAILED", reason: "STAGED_PATH_SET_MISMATCH" };
    const commit = await this.run(
      ["commit", "--no-gpg-sign", "-m", candidate.commitMessage],
      candidate.worktreePath,
    );
    if (!commit.ok)
      return {
        outcome: uncertain(commit) ? "UNCERTAIN" : "FAILED",
        reason: "COMMIT_FAILED",
      };
    const head = await this.run(["rev-parse", "HEAD"], candidate.worktreePath);
    const commitSha = headSha(head);
    if (!head.ok || commitSha === undefined)
      return {
        outcome: uncertain(head) ? "UNCERTAIN" : "FAILED",
        reason: "COMMIT_SHA_UNAVAILABLE",
      };
    const identity = await this.verifyCommit(candidate, commitSha);
    if (identity === "UNKNOWN")
      return { outcome: "UNCERTAIN", reason: "COMMIT_IDENTITY_UNKNOWN" };
    if (identity === "MISMATCH")
      return { outcome: "UNCERTAIN", reason: "COMMIT_IDENTITY_MISMATCH" };
    return { outcome: "COMMITTED", commitSha };
  }

  public async pushMerge(input: {
    readonly candidate: F27MergeCandidate;
    readonly commitSha: string;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F27GitPublisher["pushMerge"]>>> {
    if (!validCandidate(input.candidate) || !sha(input.commitSha))
      return { outcome: "FAILED", reason: "INVALID_PUSH_IDENTITY" };
    const remote = await this.run(
      [
        "ls-remote",
        "--heads",
        this.remoteName,
        input.candidate.destinationBranch,
      ],
      input.candidate.worktreePath,
    );
    if (!remote.ok)
      return {
        outcome: uncertain(remote) ? "UNCERTAIN" : "FAILED",
        reason: "REMOTE_HEAD_READ_FAILED",
      };
    if (
      remoteSha(remote, input.candidate.destinationBranch) !==
      input.candidate.expectedHeadSha
    )
      return { outcome: "FAILED", reason: "REMOTE_HEAD_CHANGED" };
    const push = await this.run(
      [
        "push",
        "--porcelain",
        this.remoteName,
        `${input.commitSha}:refs/heads/${input.candidate.destinationBranch}`,
      ],
      input.candidate.worktreePath,
    );
    return push.ok
      ? { outcome: "PUSHED" }
      : {
          outcome: uncertain(push) ? "UNCERTAIN" : "FAILED",
          reason: "PUSH_FAILED",
        };
  }

  public async reconcileCommit(input: {
    readonly candidate: F27MergeCandidate;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F27GitPublisher["reconcileCommit"]>>> {
    if (!validCandidate(input.candidate))
      return { outcome: "UNKNOWN", reason: "INVALID_CANDIDATE" };
    const head = await this.run(
      ["rev-parse", "HEAD"],
      input.candidate.worktreePath,
    );
    const commitSha = headSha(head);
    if (commitSha === undefined)
      return { outcome: "UNKNOWN", reason: "HEAD_UNAVAILABLE" };
    if (commitSha === input.candidate.expectedHeadSha)
      return { outcome: "ABSENT" };
    const identity = await this.verifyCommit(input.candidate, commitSha);
    if (identity === "MATCH") return { outcome: "PRESENT", commitSha };
    return { outcome: "UNKNOWN", reason: "COMMIT_IDENTITY_UNCONFIRMED" };
  }

  public async reconcilePush(input: {
    readonly candidate: F27MergeCandidate;
    readonly commitSha: string;
    readonly attemptId: string;
  }): Promise<Awaited<ReturnType<F27GitPublisher["reconcilePush"]>>> {
    if (!validCandidate(input.candidate) || !sha(input.commitSha))
      return { outcome: "UNKNOWN", reason: "INVALID_CANDIDATE" };
    const remote = await this.run(
      [
        "ls-remote",
        "--heads",
        this.remoteName,
        input.candidate.destinationBranch,
      ],
      input.candidate.worktreePath,
    );
    if (!remote.ok)
      return {
        outcome: "UNKNOWN",
        reason: uncertain(remote)
          ? "REMOTE_READ_UNCERTAIN"
          : "REMOTE_READ_FAILED",
      };
    const current = remoteSha(remote, input.candidate.destinationBranch);
    if (current === input.commitSha) return { outcome: "PRESENT" };
    if (current === input.candidate.expectedHeadSha)
      return { outcome: "ABSENT" };
    return { outcome: "UNKNOWN", reason: "REMOTE_HEAD_CHANGED" };
  }
}
