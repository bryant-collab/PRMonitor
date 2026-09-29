import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { F30SupportDiagnosticsService } from "../src/main/f30-support-diagnostics";
import {
  F30_APPLICATION_CRITERIA,
  F30_APPLICATION_ID,
  F30_PRODUCT_NAME,
  F30_RELEASE_TIER,
  F30_SCHEMA_VERSION,
  F30_UPDATE_CHANNEL,
  createF30SupportDiagnostics,
  evaluateF30ReleaseGate,
  f30Sha256,
  isF30SupportDiagnostics,
  type F30CriterionEvidence,
  type F30ReleaseManifest,
} from "../src/shared/f30-release";

const FIXED_TIME = "2026-09-29T12:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

function manifest(dirty = false): F30ReleaseManifest {
  return {
    schemaVersion: F30_SCHEMA_VERSION,
    kind: "f30-release-manifest",
    releaseId: "f30-release-test",
    generatedAt: FIXED_TIME,
    product: {
      name: F30_PRODUCT_NAME,
      applicationId: F30_APPLICATION_ID,
      version: "0.1.0",
      executableName: "PRMonitor.exe",
    },
    source: { revision: "0123456789abcdef0123456789abcdef01234567", dirty },
    runtime: {
      node: "24.19.0",
      npm: "11.17.0",
      electron: "44.4.3",
      electronBuilder: "26.15.3",
      lockfileVersion: 3,
    },
    target: { os: "windows-11", architecture: "x64" },
    packaging: {
      configurationSha256: "a".repeat(64),
      target: "nsis",
      signed: false,
      releaseTier: F30_RELEASE_TIER,
      updateChannel: F30_UPDATE_CHANNEL,
      smartScreenNote: "Unsigned internal preview.",
    },
    artifacts: [
      {
        name: "PRMonitor-0.1.0-x64.exe",
        kind: "installer",
        architecture: "x64",
        sha256: "b".repeat(64),
        bytes: 128,
      },
    ],
    payloadScan: { fileCount: 4, scannedBytes: 512 },
    evidenceBundleId: "f30-evidence-test",
  };
}

function evidence(
  criterionId: string,
  status: F30CriterionEvidence["status"] = "passed",
): F30CriterionEvidence {
  return {
    schemaVersion: F30_SCHEMA_VERSION,
    kind: "f30-criterion-evidence",
    criterionId,
    ownerFeature: "F30",
    evidenceTier: "credential-free-automated",
    status,
    buildIdentity: "f30-release-test",
    environmentIdentity: "fixture-windows-11-x64",
    recordedAt: FIXED_TIME,
    evidenceRefs: ["CT-F30-11"],
    observation: "The deterministic fixture passed.",
    ...(status === "approved-exception"
      ? {
          approval: {
            approvedBy: "release-owner",
            approvedAt: FIXED_TIME,
            reason: "The criterion is outside this credential-free fixture.",
          },
        }
      : {}),
  };
}

describe("F30 release contracts", () => {
  it("produces a real SHA-256 digest without importing Node APIs into shared code", () => {
    expect(f30Sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("requires one individually green row for all 77 application criteria", () => {
    const rows = F30_APPLICATION_CRITERIA.map((criterionId) =>
      evidence(criterionId),
    );
    const result = evaluateF30ReleaseGate({
      manifest: manifest(),
      criteria: rows,
      checks: [
        {
          id: "CT-F30-11",
          status: "passed",
          evidenceRef: "CT-F30-11",
          summary: "The trace is complete.",
        },
      ],
      generatedAt: FIXED_TIME,
    });
    expect(result.decision).toBe("eligible");
    expect(result.criterionCount).toBe(77);
    expect(result.passedCriterionCount).toBe(77);

    const blocked = evaluateF30ReleaseGate({
      manifest: manifest(true),
      criteria: rows.slice(1),
      generatedAt: FIXED_TIME,
    });
    expect(blocked.decision).toBe("blocked");
    expect(blocked.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CRITERION_MISSING" }),
        expect.objectContaining({ code: "SOURCE_DIRTY" }),
      ]),
    );
  });

  it("creates a bounded support report without paths or secret-bearing activity", () => {
    const result = createF30SupportDiagnostics({
      applicationVersion: "0.1.0",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      runtime: {
        node: "24.19.0",
        electron: "44.4.3",
        platform: "win32",
        architecture: "x64",
      },
      persistence: { status: "healthy", schemaVersion: 28 },
      lifecycle: { phase: "RUNNING", incompleteHandoff: false },
      recovery: {
        status: "COMPLETED",
        scopes: 1,
        completed: 1,
        attention: 0,
        retrying: 0,
      },
      featureHealth: [{ featureId: "F29", status: "healthy" }],
      activity: [
        {
          eventId: "event-1",
          eventType: "OPERATION_FAILED",
          stage: "SYSTEM",
          severity: "WARNING",
          reasonCode: "FAILED",
          correlationId: "correlation-1",
          occurrenceAt: FIXED_TIME,
          recordedAt: FIXED_TIME,
          summary: "A bounded failure occurred at C:\\Users\\test\\repo.",
        },
      ],
      generatedAt: FIXED_TIME,
      supportCorrelationId: "support-test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isF30SupportDiagnostics(result.value)).toBe(true);
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("C:\\Users\\test");
    expect(serialized).not.toContain("repo");
    expect(serialized).not.toContain("token=");
    expect(result.value.redaction.credentialsAndPrompts).toBe("omitted");
  });

  it("exports diagnostics atomically and does not overwrite an existing report", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f30-"));
    roots.push(root);
    const service = new F30SupportDiagnosticsService({
      applicationVersion: "0.1.0",
      sourceRevision: "runtime-build",
      readRuntime: () => ({
        node: "24.19.0",
        electron: "44.4.3",
        platform: "win32",
        architecture: "x64",
      }),
      readPersistence: () => ({ status: "healthy", schemaVersion: 28 }),
      readLifecycle: () => ({ phase: "RUNNING", incompleteHandoff: false }),
      readRecovery: () => ({
        status: "COMPLETED",
        scopes: 0,
        completed: 0,
        attention: 0,
        retrying: 0,
      }),
      readFeatureHealth: () => [{ featureId: "F30", status: "healthy" }],
      readActivity: () => [],
      now: () => FIXED_TIME,
    });
    const destination = path.join(root, "support.json");
    const exported = await service.exportTo(destination);
    expect(exported.ok).toBe(true);
    expect(JSON.parse(await readFile(destination, "utf8"))).toMatchObject({
      kind: "prmonitor-support-diagnostics",
    });
    const second = await service.exportTo(destination);
    expect(second).toMatchObject({ ok: false, code: "WRITE_FAILED" });
  });
});
