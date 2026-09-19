import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createApprovalRecord,
  resolveValidationProfile,
  createValidationSnapshot,
  validateValidationSnapshot,
  serializeValidationSnapshot,
  parseValidationSnapshot,
  createInitialValidationRun,
  createCommandStepEvidence,
  stopRemainingSteps,
  completeValidationRun,
  validateRunAgainstSnapshot,
  recordManualAttestation,
  manualAttestationView,
  createNoRunValidationRecord,
  aggregateValidationEvidence,
  finalizeIncompleteValidationRun,
  validateValidationRunEvidence,
  createValidationConsumer,
  publicationWarningForValidation,
  type ValidationProfile,
  type ValidationSnapshot,
} from "../src/index.js";

const profile: ValidationProfile = {
  schemaVersion: 1,
  steps: [
    {
      kind: "command",
      id: "tests",
      label: "Tests",
      executable: "npm",
      arguments: ["test"],
      workingDirectory: ".",
      timeoutSeconds: 60,
      outputLimitBytes: 100,
    },
    {
      kind: "manual",
      id: "visual",
      label: "Visual check",
      instructions: "Inspect the affected screen.",
    },
  ],
};

function readyResolution() {
  const repositoryId = "github:example/repo";
  const approval = createApprovalRecord({
    repositoryId,
    source: "checked-in",
    profile,
    approvedAt: "2026-09-19T12:00:00.000Z",
  });
  const resolved = resolveValidationProfile({
    repositoryId,
    checkedIn: { profile, approval },
  });
  if (resolved.status !== "ready") {
    throw new Error(`fixture did not resolve: ${resolved.status}`);
  }
  return resolved;
}

function snapshot(): Readonly<ValidationSnapshot> {
  return createValidationSnapshot({
    resolved: readyResolution(),
    snapshotId: "snapshot-1",
    createdAt: "2026-09-19T12:01:00.000Z",
    worktree: {
      canonicalRoot: "C:\\worktrees\\operation-1",
      baselineRevision: "base-sha",
      currentRevision: "head-sha",
    },
  });
}

describe("immutable snapshots and consumer handoff", () => {
  it("creates a complete immutable snapshot before a run and rejects tampering", () => {
    const resolved = readyResolution();
    const created = createValidationSnapshot({
      resolved,
      snapshotId: "snapshot-mutable-input",
      createdAt: "2026-09-19T12:01:00.000Z",
      worktree: {
        canonicalRoot: "C:\\worktrees\\operation-1",
        baselineRevision: "base-sha",
        currentRevision: "head-sha",
      },
    });
    resolved.profile.steps[0] = {
      ...resolved.profile.steps[0],
      kind: "command",
      arguments: ["mutated-after-snapshot"],
    };
    expect(created.profile.steps[0]).toMatchObject({ arguments: ["test"] });

    const result = validateValidationSnapshot(snapshot());
    expect(result).toMatchObject({ ok: true });
    const serialized = serializeValidationSnapshot(snapshot());
    expect(parseValidationSnapshot(JSON.parse(serialized))).toMatchObject({ ok: true });
    const tampered = JSON.parse(serialized) as Record<string, unknown>;
    tampered.contentHash = "0".repeat(64);
    expect(validateValidationSnapshot(tampered)).toMatchObject({ ok: false, code: "SNAPSHOT_MISMATCH" });
    const frozen = snapshot();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      (frozen as { contentHash: string }).contentHash = "changed";
    }).toThrow();
  });

  it("accepts the current snapshot fixture and rejects the tampered fixture", async () => {
    const fixtureRoot = new URL("../fixtures/", import.meta.url);
    const valid = JSON.parse(await readFile(new URL("valid-snapshot.json", fixtureRoot), "utf8")) as unknown;
    const invalid = JSON.parse(await readFile(new URL("invalid-snapshot.json", fixtureRoot), "utf8")) as unknown;
    expect(parseValidationSnapshot(valid)).toMatchObject({ ok: true });
    expect(parseValidationSnapshot(invalid)).toMatchObject({ ok: false, code: "SNAPSHOT_MISMATCH" });
  });

  it("records observed exit evidence, manual attestation, and aggregate status without AI fields", () => {
    const currentSnapshot = snapshot();
    const initial = createInitialValidationRun({
      snapshot: currentSnapshot,
      runId: "run-1",
      startedAt: "2026-09-19T12:02:00.000Z",
    });
    const command = createCommandStepEvidence({
      prepared: {
        kind: "command",
        stepId: "tests",
        executable: "npm",
        arguments: ["test"],
        shell: false,
        canonicalWorktreeRoot: currentSnapshot.worktree.canonicalRoot,
        canonicalWorkingDirectory: currentSnapshot.worktree.canonicalRoot,
        resolvedExecutable: "C:\\Program Files\\nodejs\\npm.cmd",
        timeoutSeconds: 60,
        outputLimitBytes: 100,
        environment: { PATH: "C:\\tools" },
      },
      startedAt: "2026-09-19T12:02:01.000Z",
      completedAt: "2026-09-19T12:02:02.000Z",
      observation: { exitCode: 0 },
      stdout: {
        text: "ok",
        originalByteCount: 2,
        processedByteCount: 2,
        retainedByteCount: 2,
        omittedByteCount: 0,
        truncated: false,
        redacted: false,
        safe: true,
      },
      stderr: {
        text: "",
        originalByteCount: 0,
        processedByteCount: 0,
        retainedByteCount: 0,
        omittedByteCount: 0,
        truncated: false,
        redacted: false,
        safe: true,
      },
    });
    const manual = recordManualAttestation({
      checkId: "visual",
      outcome: "verified",
      timestamp: "2026-09-19T12:02:03.000Z",
      worktreePath: currentSnapshot.worktree.canonicalRoot,
      worktreeBaselineRevision: "base-sha",
      worktreeCurrentRevision: "head-sha",
      attestedBy: "developer@example.test",
      notes: "Looks correct.",
    });
    const manualStep = { kind: "manual" as const, stepId: "visual", status: "passed" as const, attestation: manual };
    const completed = completeValidationRun({
      run: initial,
      steps: [command, manualStep],
      completedAt: "2026-09-19T12:02:04.000Z",
      manualAttestations: [manual],
    });
    expect(completed.status).toBe("passed");
    expect(completed.steps[0]).toEqual(
      expect.objectContaining({
        kind: "command",
        startedAt: "2026-09-19T12:02:01.000Z",
        completedAt: "2026-09-19T12:02:02.000Z",
        executable: "npm",
        arguments: ["test"],
        canonicalWorkingDirectory: currentSnapshot.worktree.canonicalRoot,
        resolvedExecutable: "C:\\Program Files\\nodejs\\npm.cmd",
        exitCode: 0,
        stdout: expect.objectContaining({ retainedByteCount: 2, safe: true }),
        stderr: expect.objectContaining({ retainedByteCount: 0, safe: true }),
      }),
    );
    expect("aiResult" in completed).toBe(false);
    expect(validateRunAgainstSnapshot(completed, currentSnapshot)).toEqual({ ok: true });
    expect(validateRunAgainstSnapshot({ ...completed, snapshotId: "different-snapshot" }, currentSnapshot)).toMatchObject({
      ok: false,
      reason: "SNAPSHOT_MISMATCH",
    });
  });

  it("keeps unavailable validation distinct and visible to publication consumers", () => {
    const noProfile = createNoRunValidationRecord({
      runId: "run-no-profile",
      startedAt: "2026-09-19T12:00:00.000Z",
      reason: "NO_PROFILE",
    });
    expect(noProfile).toMatchObject({ status: "not_run", reason: "NO_PROFILE" });
    expect(validateValidationRunEvidence(noProfile)).toMatchObject({ ok: true });
    expect(validateValidationRunEvidence({ ...noProfile, reason: "MODEL_SAYS_PASS" })).toMatchObject({ ok: false });
    expect(noProfile.warnings[0]?.remediation).toContain("Configure a saved profile");
    expect(aggregateValidationEvidence({ automated: [], unavailableReason: "CONFIRMATION_REQUIRED" })).toMatchObject({
      status: "not_run",
      reason: "CONFIRMATION_REQUIRED",
    });
    expect(aggregateValidationEvidence({ automated: [], manual: [{ ...noProfile.manualAttestations[0] } as never] })).toMatchObject({
      status: "not_run",
      reason: "NO_AUTOMATED_COMMANDS",
    });
  });

  it("binds manual evidence to worktree revisions and labels it separately from test passes", () => {
    const attestation = recordManualAttestation({
      checkId: "visual",
      outcome: "verified",
      timestamp: "2026-09-19T12:00:00.000Z",
      worktreePath: "C:\\worktrees\\operation-1",
      worktreeBaselineRevision: "base",
      worktreeCurrentRevision: "head",
    });
    expect(manualAttestationView(attestation, {
      worktreePath: "C:\\worktrees\\operation-1",
      baselineRevision: "base",
      currentRevision: "head",
    })).toMatchObject({ label: "Verified manually", historical: false });
    expect(manualAttestationView(attestation, {
      worktreePath: "C:\\worktrees\\operation-1",
      baselineRevision: "base",
      currentRevision: "changed-head",
    })).toMatchObject({ label: "Verified manually", historical: true });
    expect(manualAttestationView({ ...attestation, outcome: "failed" }, {
      worktreePath: "C:\\worktrees\\operation-1",
      baselineRevision: "base",
      currentRevision: "head",
    })).toMatchObject({ label: "Manual check failed" });
    expect(manualAttestationView({ ...attestation, outcome: "not_run" }, {
      worktreePath: "C:\\worktrees\\operation-1",
      baselineRevision: "base",
      currentRevision: "head",
    })).toMatchObject({ label: "Not run" });
  });

  it("keeps invalid-profile no-run records visibly non-passing", () => {
    const record = createNoRunValidationRecord({ runId: "run-invalid-profile", startedAt: "now", reason: "INVALID_PROFILE" });
    expect(record).toMatchObject({ status: "not_run", reason: "INVALID_PROFILE", completedAt: "now" });
    expect(record.warnings[0]).toMatchObject({ code: "INVALID_PROFILE" });
    expect(JSON.stringify(record)).not.toContain("Test passed");
  });

  it("finalizes incomplete runs as interrupted after restart and records later steps as stopped", () => {
    const currentSnapshot = snapshot();
    const initial = createInitialValidationRun({ snapshot: currentSnapshot, runId: "run-restart", startedAt: "now" });
    const running = {
      ...initial,
      steps: initial.steps.map((step, index) => (index === 0 ? { ...step, status: "running" as const } : step)),
    };
    const finalized = finalizeIncompleteValidationRun(running, "later");
    expect(finalized).toMatchObject({ status: "interrupted", reason: "APPLICATION_RESTARTED", completedAt: "later" });
    expect(finalized.steps[0]).toMatchObject({ status: "interrupted", reason: "APPLICATION_RESTARTED" });
    expect(finalized.steps[1]).toMatchObject({ status: "not_run", reason: "PRIOR_STEP_STOPPED" });
  });

  it("records every later sequential step as not_run after the first non-passing command", () => {
    const currentSnapshot = snapshot();
    const initial = createInitialValidationRun({ snapshot: currentSnapshot, runId: "run-stop", startedAt: "now" });
    const failed = {
      ...initial.steps[0],
      status: "failed" as const,
      reason: "NON_ZERO_EXIT" as const,
    };
    const stopped = stopRemainingSteps([failed, initial.steps[1]], 0);
    expect(stopped[1]).toMatchObject({ status: "not_run", reason: "PRIOR_STEP_STOPPED" });
  });

  it("gives review and synchronization the same shared policy implementation", () => {
    const review = createValidationConsumer("review");
    const synchronization = createValidationConsumer("synchronization");
    const input = { repositoryId: "github:example/repo" };
    expect(review.resolveProfile(input)).toEqual(synchronization.resolveProfile(input));

    const ready = readyResolution();
    const snapshotInput = {
      resolved: ready,
      snapshotId: "consumer-snapshot",
      createdAt: "now",
      worktree: { canonicalRoot: "C:\\worktrees\\operation-1", baselineRevision: "base-sha", currentRevision: "head-sha" },
    };
    const reviewSnapshot = review.createSnapshot(snapshotInput);
    const synchronizationSnapshot = synchronization.createSnapshot(snapshotInput);
    expect(reviewSnapshot).toEqual(synchronizationSnapshot);
    expect(
      review.aggregateEvidence({ automated: [], unavailableReason: "CONFIRMATION_REQUIRED" }),
    ).toEqual(synchronization.aggregateEvidence({ automated: [], unavailableReason: "CONFIRMATION_REQUIRED" }));
    expect(
      review.captureStreams({ limitBytes: 128, stdout: ["token=secret"], stderr: ["diagnostic"] }),
    ).toEqual(synchronization.captureStreams({ limitBytes: 128, stdout: ["token=secret"], stderr: ["diagnostic"] }));
    const reviewRun = createInitialValidationRun({ snapshot: reviewSnapshot, runId: "consumer-run", startedAt: "now" });
    expect(review.validateRunAgainstSnapshot(reviewRun, reviewSnapshot)).toEqual(
      synchronization.validateRunAgainstSnapshot(reviewRun, synchronizationSnapshot),
    );
  });

  it("rejects impossible completed evidence and preserves manual attribution", () => {
    const invalid = validateValidationRunEvidence({
      recordType: "validation-run",
      schemaVersion: 1,
      runId: "run-invalid",
      status: "passed",
      startedAt: "now",
      completedAt: "later",
      steps: [
        {
          kind: "manual",
          stepId: "visual",
          status: "passed",
        },
      ],
      manualAttestations: [],
      warnings: [],
    });
    expect(invalid.ok).toBe(false);
    const invalidSequence = validateValidationRunEvidence({
      recordType: "validation-run",
      schemaVersion: 1,
      runId: "run-invalid-sequence",
      status: "failed",
      reason: "NON_ZERO_EXIT",
      startedAt: "now",
      completedAt: "later",
      steps: [
        { kind: "command", stepId: "tests", status: "failed", reason: "NON_ZERO_EXIT", executable: "npm", arguments: [], completedAt: "later", stdout: { text: "", originalByteCount: 0, processedByteCount: 0, retainedByteCount: 0, omittedByteCount: 0, truncated: false, redacted: false, safe: true }, stderr: { text: "", originalByteCount: 0, processedByteCount: 0, retainedByteCount: 0, omittedByteCount: 0, truncated: false, redacted: false, safe: true } },
        { kind: "manual", stepId: "visual", status: "passed", attestation: { kind: "manual", checkId: "visual", outcome: "verified", timestamp: "now", worktreePath: "C:\\work", worktreeBaselineRevision: "base", worktreeCurrentRevision: "head" } },
      ],
      manualAttestations: [{ kind: "manual", checkId: "visual", outcome: "verified", timestamp: "now", worktreePath: "C:\\work", worktreeBaselineRevision: "base", worktreeCurrentRevision: "head" }],
      warnings: [],
    });
    expect(invalidSequence.ok).toBe(false);

    const currentSnapshot = snapshot();
    const initial = createInitialValidationRun({ snapshot: currentSnapshot, runId: "run-manual", startedAt: "now" });
    const completed = completeValidationRun({
      run: initial,
      steps: initial.steps.map((step) =>
        step.kind === "command"
          ? {
              ...step,
              status: "passed" as const,
              startedAt: "now",
              completedAt: "later",
              exitCode: 0,
              canonicalWorkingDirectory: currentSnapshot.worktree.canonicalRoot,
              resolvedExecutable: "npm",
              stdout: { text: "", originalByteCount: 0, processedByteCount: 0, retainedByteCount: 0, omittedByteCount: 0, truncated: false, redacted: false, safe: true },
              stderr: { text: "", originalByteCount: 0, processedByteCount: 0, retainedByteCount: 0, omittedByteCount: 0, truncated: false, redacted: false, safe: true },
            }
          : step,
      ),
      completedAt: "done",
      manualAttestations: [
        recordManualAttestation({
          checkId: "visual",
          outcome: "verified",
          timestamp: "now",
          worktreePath: currentSnapshot.worktree.canonicalRoot,
          worktreeBaselineRevision: "base-sha",
          worktreeCurrentRevision: "head-sha",
        }),
      ],
    });
    expect(completed.status).toBe("passed");
    expect(completed.steps[1]).toMatchObject({ kind: "manual", status: "passed", attestation: { outcome: "verified" } });
  });

  it("rejects evidence whose command inputs or manual IDs no longer match the snapshot", () => {
    const currentSnapshot = snapshot();
    const initial = createInitialValidationRun({ snapshot: currentSnapshot, runId: "run-mismatch", startedAt: "now" });
    const tampered = {
      ...initial,
      status: "not_run" as const,
      reason: "PRIOR_STEP_STOPPED" as const,
      completedAt: "later",
      steps: initial.steps.map((step) =>
        step.kind === "command" ? { ...step, status: "not_run" as const, reason: "PRIOR_STEP_STOPPED" as const, arguments: ["changed"] } : { ...step, status: "not_run" as const, reason: "PRIOR_STEP_STOPPED" as const },
      ),
    };
    expect(validateRunAgainstSnapshot(tampered, currentSnapshot)).toMatchObject({ ok: false, reason: "SNAPSHOT_MISMATCH" });
  });

  it("uses a distinct publication-review warning for failed validation", () => {
    const warning = publicationWarningForValidation({
      status: "failed",
      reason: "NON_ZERO_EXIT",
      automated: [],
      manual: [],
      warnings: [],
    });
    expect(warning).toMatchObject({ code: "VALIDATION_REVIEW_REQUIRED" });
  });
});
