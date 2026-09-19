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
  completeValidationRun,
  validateRunAgainstSnapshot,
  recordManualAttestation,
  manualAttestationView,
  createNoRunValidationRecord,
  aggregateValidationEvidence,
  finalizeIncompleteValidationRun,
  validateValidationRunEvidence,
  createValidationConsumer,
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
    expect("aiResult" in completed).toBe(false);
    expect(validateRunAgainstSnapshot(completed, currentSnapshot)).toEqual({ ok: true });
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

  it("gives review and synchronization the same shared policy implementation", () => {
    const review = createValidationConsumer("review");
    const synchronization = createValidationConsumer("synchronization");
    const input = { repositoryId: "github:example/repo" };
    expect(review.resolveProfile(input)).toEqual(synchronization.resolveProfile(input));
  });
});
