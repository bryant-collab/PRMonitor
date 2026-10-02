import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  F23DeterministicGitPublisher,
  type F23GitPublisherOptions,
} from "../src/main/f23-release-git";
import type { F23PublicationCandidate } from "../src/shared/f23-release";
import type {
  F13GitCommandResult,
  F13GitCommandRunner,
} from "../src/main/f13-git";

const BASE_SHA = "a".repeat(40);
const COMMIT_SHA = "c".repeat(40);

function result(stdout = "", ok = true): F13GitCommandResult {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    stdout,
    stderr: ok ? "" : "git failed",
    timedOut: false,
    cancelled: false,
    outputLimitExceeded: false,
    started: true,
  };
}

class QueueRunner implements F13GitCommandRunner {
  public readonly calls: string[][] = [];

  public constructor(private readonly results: F13GitCommandResult[]) {}

  public run(args: readonly string[]): Promise<F13GitCommandResult> {
    this.calls.push([...args]);
    return Promise.resolve(this.results.shift() ?? result("", false));
  }
}

function candidate(): F23PublicationCandidate {
  return {
    schemaVersion: 1,
    kind: "F23_PUBLICATION_CANDIDATE",
    bundleId: "bundle-f23-git",
    managedPrId: "managed-pr-f23-git",
    operationId: "operation-f23-git",
    bundleVersion: 1,
    evidenceRevision: 1,
    gateRevision: 1,
    baselineSha: BASE_SHA,
    expectedHeadSha: "b".repeat(40),
    currentHeadSha: BASE_SHA,
    headBranch: "feature",
    worktreePath: path.join(os.tmpdir(), "prmonitor-review-f23-git"),
    condition: "AI_ATTRIBUTED_ONLY",
    conditionFingerprint: "fingerprint-f23-git",
    conditionEvidenceComplete: true,
    changedFiles: ["src/app.ts"],
    trackedFiles: ["src/app.ts"],
    untrackedFiles: [],
    proposedDiffComplete: true,
    commitMessage: "Publish approved Review Bundle changes",
    responses: [],
    candidateHash: "d".repeat(64),
  };
}

function publisher(runner: F13GitCommandRunner) {
  const options: F23GitPublisherOptions = { runner };
  return new F23DeterministicGitPublisher(options);
}

describe("F23 deterministic Git boundary", () => {
  it("stages only the candidate paths and verifies the exact commit identity", async () => {
    const runner = new QueueRunner([
      result(BASE_SHA),
      result(),
      result(),
      result("binary patch"),
      result("src/app.ts\u0000"),
      result(),
      result(COMMIT_SHA),
      result(BASE_SHA),
      result("Publish approved Review Bundle changes\n"),
      result("src/app.ts\u0000"),
    ]);
    const outcome = await publisher(runner).commitCandidate({
      candidate: candidate(),
      attemptId: "attempt-f23-git",
    });

    expect(outcome).toEqual({ outcome: "COMMITTED", commitSha: COMMIT_SHA });
    expect(runner.calls).toEqual([
      ["rev-parse", "HEAD"],
      ["reset", "HEAD", "--"],
      ["add", "--all", "--", "src/app.ts"],
      [
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--no-color",
        "--full-index",
        "--find-renames",
        BASE_SHA,
        "--",
      ],
      [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--find-renames",
        BASE_SHA,
        "--",
      ],
      [
        "commit",
        "--no-gpg-sign",
        "-m",
        "Publish approved Review Bundle changes",
      ],
      ["rev-parse", "HEAD"],
      ["rev-parse", "HEAD^"],
      ["show", "-s", "--format=%s", "HEAD"],
      ["diff", "--name-only", "-z", "--find-renames", BASE_SHA, "HEAD", "--"],
    ]);
    expect(runner.calls.flat()).not.toContain("--force");
    expect(runner.calls.flat()).not.toContain("--force-with-lease");
  });

  it("does not treat an unrelated local commit as the uncertain publication", async () => {
    const unrelatedParent = "e".repeat(40);
    const runner = new QueueRunner([
      result(COMMIT_SHA),
      result(unrelatedParent),
    ]);
    const outcome = await publisher(runner).reconcileCommit({
      candidate: candidate(),
      attemptId: "attempt-f23-reconcile",
    });

    expect(outcome).toEqual({
      outcome: "UNKNOWN",
      reason: "COMMIT_IDENTITY_MISMATCH",
    });
    expect(runner.calls).toEqual([
      ["rev-parse", "HEAD"],
      ["rev-parse", "HEAD^"],
    ]);
  });

  it("confirms only the exact remote branch SHA", async () => {
    const runner = new QueueRunner([
      result(`${COMMIT_SHA}\trefs/heads/feature\n`),
    ]);
    const outcome = await publisher(runner).reconcilePush({
      candidate: candidate(),
      commitSha: COMMIT_SHA,
      attemptId: "attempt-f23-push-reconcile",
    });

    expect(outcome).toEqual({ outcome: "PRESENT" });
    expect(runner.calls).toEqual([
      ["ls-remote", "--heads", "origin", "feature"],
    ]);
  });
});
