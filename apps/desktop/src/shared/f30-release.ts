import { z } from "zod";
import { f29ContainsSecretShape, redactF29Text } from "./f29-security";

export const F30_SCHEMA_VERSION = 1 as const;
export const F30_APPLICATION_ID = "com.prmonitor.desktop" as const;
export const F30_PRODUCT_NAME = "PRMonitor" as const;
export const F30_TARGET_OS = "windows-11" as const;
export const F30_TARGET_ARCHITECTURE = "x64" as const;
export const F30_RELEASE_TIER = "unsigned-internal-preview" as const;
export const F30_UPDATE_CHANNEL = "manual-installer" as const;
export const F30_MAX_EVIDENCE_REFS = 32 as const;
export const F30_MAX_EVIDENCE_TEXT_BYTES = 2_048 as const;
export const F30_MAX_ACTIVITY_EVENTS = 100 as const;
export const F30_MAX_TRACE_ROWS = 77 as const;

export const F30_APPLICATION_CRITERIA = Array.from(
  { length: F30_MAX_TRACE_ROWS },
  (_, index) => `APP-AC-${String(index + 1).padStart(2, "0")}`,
) as readonly string[];

export const f30EvidenceTierSchema = z.enum([
  "credential-free-automated",
  "packaged-local",
  "controlled-github",
  "manual-accessibility",
  "release-operator",
]);
export type F30EvidenceTier = z.infer<typeof f30EvidenceTierSchema>;

export const f30EvidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "unverified",
  "approved-exception",
  "not-applicable",
]);
export type F30EvidenceStatus = z.infer<typeof f30EvidenceStatusSchema>;

const safeIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.string().datetime({ offset: true }).max(64);
const boundedTextSchema = z.string().min(1).max(F30_MAX_EVIDENCE_TEXT_BYTES);

export const f30ReleaseArtifactSchema = z
  .object({
    name: z.string().min(1).max(256),
    kind: z.enum(["installer", "unpacked", "checksum", "evidence"]),
    architecture: z.literal(F30_TARGET_ARCHITECTURE),
    sha256: hashSchema,
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type F30ReleaseArtifact = z.infer<typeof f30ReleaseArtifactSchema>;

export const f30ReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(F30_SCHEMA_VERSION),
    kind: z.literal("f30-release-manifest"),
    releaseId: safeIdentifierSchema,
    generatedAt: timestampSchema,
    product: z
      .object({
        name: z.literal(F30_PRODUCT_NAME),
        applicationId: z.literal(F30_APPLICATION_ID),
        version: safeIdentifierSchema,
        executableName: z.literal("PRMonitor.exe"),
      })
      .strict(),
    source: z
      .object({
        revision: safeIdentifierSchema,
        dirty: z.boolean(),
      })
      .strict(),
    runtime: z
      .object({
        node: safeIdentifierSchema,
        npm: safeIdentifierSchema,
        electron: safeIdentifierSchema,
        electronBuilder: safeIdentifierSchema,
        lockfileVersion: z.number().int().positive(),
      })
      .strict(),
    target: z
      .object({
        os: z.literal(F30_TARGET_OS),
        architecture: z.literal(F30_TARGET_ARCHITECTURE),
      })
      .strict(),
    packaging: z
      .object({
        configurationSha256: hashSchema,
        target: z.literal("nsis"),
        signed: z.literal(false),
        releaseTier: z.literal(F30_RELEASE_TIER),
        updateChannel: z.literal(F30_UPDATE_CHANNEL),
        smartScreenNote: boundedTextSchema,
      })
      .strict(),
    artifacts: z.array(f30ReleaseArtifactSchema).min(1).max(32),
    payloadScan: z
      .object({
        fileCount: z.number().int().nonnegative(),
        scannedBytes: z.number().int().nonnegative(),
      })
      .strict(),
    evidenceBundleId: safeIdentifierSchema,
  })
  .strict();
export type F30ReleaseManifest = z.infer<typeof f30ReleaseManifestSchema>;

export const f30CriterionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(F30_SCHEMA_VERSION),
    kind: z.literal("f30-criterion-evidence"),
    criterionId: z.string().regex(/^APP-AC-(?:0[1-9]|[1-6][0-9]|7[0-7])$/u),
    ownerFeature: z.string().regex(/^F(?:0|[1-2][0-9]|30)$/u),
    evidenceTier: f30EvidenceTierSchema,
    status: f30EvidenceStatusSchema,
    buildIdentity: safeIdentifierSchema,
    environmentIdentity: safeIdentifierSchema,
    recordedAt: timestampSchema,
    evidenceRefs: z.array(safeIdentifierSchema).max(F30_MAX_EVIDENCE_REFS),
    observation: z.string().max(F30_MAX_EVIDENCE_TEXT_BYTES),
    approval: z
      .object({
        approvedBy: safeIdentifierSchema,
        approvedAt: timestampSchema,
        reason: boundedTextSchema,
        expiresAt: timestampSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type F30CriterionEvidence = z.infer<typeof f30CriterionEvidenceSchema>;

export const f30CheckResultSchema = z
  .object({
    id: safeIdentifierSchema,
    status: z.enum(["passed", "failed", "skipped"]),
    evidenceRef: safeIdentifierSchema,
    summary: boundedTextSchema,
  })
  .strict();
export type F30CheckResult = z.infer<typeof f30CheckResultSchema>;

export const f30ReleaseGateResultSchema = z
  .object({
    schemaVersion: z.literal(F30_SCHEMA_VERSION),
    kind: z.literal("f30-release-gate-result"),
    gateId: safeIdentifierSchema,
    generatedAt: timestampSchema,
    decision: z.enum(["eligible", "blocked"]),
    reasons: z
      .array(
        z
          .object({
            code: safeIdentifierSchema,
            message: boundedTextSchema,
            criterionId: z
              .string()
              .regex(/^APP-AC-(?:0[1-9]|[1-6][0-9]|7[0-7])$/u)
              .optional(),
          })
          .strict(),
      )
      .max(128),
    criterionCount: z.number().int().nonnegative().max(F30_MAX_TRACE_ROWS),
    passedCriterionCount: z
      .number()
      .int()
      .nonnegative()
      .max(F30_MAX_TRACE_ROWS),
  })
  .strict();
export type F30ReleaseGateResult = z.infer<typeof f30ReleaseGateResultSchema>;

export interface F30SupportActivitySummary {
  readonly eventId: string;
  readonly eventType: string;
  readonly stage: string;
  readonly severity: string;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly operationId?: string;
  readonly occurrenceAt: string;
  readonly recordedAt: string;
  readonly summary: string;
}

export interface F30SupportDiagnosticsInput {
  readonly applicationVersion: string;
  readonly sourceRevision: string;
  readonly runtime: {
    readonly node: string;
    readonly electron: string;
    readonly platform: string;
    readonly architecture: string;
  };
  readonly persistence: {
    readonly status: string;
    readonly schemaVersion: number;
  };
  readonly lifecycle: {
    readonly phase: string;
    readonly incompleteHandoff: boolean;
    readonly reasonCode?: string;
  };
  readonly recovery: {
    readonly status: string;
    readonly scopes: number;
    readonly completed: number;
    readonly attention: number;
    readonly retrying: number;
  };
  readonly featureHealth: readonly {
    readonly featureId: string;
    readonly status: "healthy" | "degraded" | "attention";
    readonly reasonCode?: string;
  }[];
  readonly activity: readonly F30SupportActivitySummary[];
  readonly generatedAt?: string;
  readonly supportCorrelationId?: string;
}

export const f30SupportDiagnosticsSchema = z
  .object({
    schemaVersion: z.literal(F30_SCHEMA_VERSION),
    kind: z.literal("prmonitor-support-diagnostics"),
    supportCorrelationId: safeIdentifierSchema,
    generatedAt: timestampSchema,
    product: z
      .object({
        name: z.literal(F30_PRODUCT_NAME),
        applicationId: z.literal(F30_APPLICATION_ID),
        version: safeIdentifierSchema,
      })
      .strict(),
    source: z.object({ revision: safeIdentifierSchema }).strict(),
    runtime: z
      .object({
        node: safeIdentifierSchema,
        electron: safeIdentifierSchema,
        platform: safeIdentifierSchema,
        architecture: safeIdentifierSchema,
      })
      .strict(),
    persistence: z
      .object({
        status: z.enum(["healthy", "upgraded", "recovery_required"]),
        schemaVersion: z.number().int().nonnegative(),
      })
      .strict(),
    lifecycle: z
      .object({
        phase: z.enum([
          "STARTING",
          "RUNNING",
          "SHUTDOWN_REQUESTED",
          "HANDING_OFF",
          "STOPPED",
          "RECOVERY_REQUIRED",
        ]),
        incompleteHandoff: z.boolean(),
        reasonCode: safeIdentifierSchema.optional(),
      })
      .strict(),
    recovery: z
      .object({
        status: z.enum(["IDLE", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]),
        scopes: z.number().int().nonnegative().max(250),
        completed: z.number().int().nonnegative().max(250),
        attention: z.number().int().nonnegative().max(250),
        retrying: z.number().int().nonnegative().max(250),
      })
      .strict(),
    featureHealth: z
      .array(
        z
          .object({
            featureId: z.string().regex(/^F(?:0|[1-2][0-9]|30)$/u),
            status: z.enum(["healthy", "degraded", "attention"]),
            reasonCode: safeIdentifierSchema.optional(),
          })
          .strict(),
      )
      .max(32),
    recentActivity: z
      .array(
        z
          .object({
            eventId: safeIdentifierSchema,
            eventType: safeIdentifierSchema,
            stage: safeIdentifierSchema,
            severity: safeIdentifierSchema,
            reasonCode: safeIdentifierSchema,
            correlationId: safeIdentifierSchema,
            operationId: safeIdentifierSchema.optional(),
            occurrenceAt: timestampSchema,
            recordedAt: timestampSchema,
            summary: boundedTextSchema,
          })
          .strict(),
      )
      .max(F30_MAX_ACTIVITY_EVENTS),
    redaction: z
      .object({
        policy: z.literal("allowlisted-safe-projection-v1"),
        sourceAndDiffContent: z.literal("omitted"),
        credentialsAndPrompts: z.literal("omitted"),
        localPathsAndEnvironment: z.literal("omitted"),
      })
      .strict(),
  })
  .strict();
export type F30SupportDiagnostics = z.infer<typeof f30SupportDiagnosticsSchema>;

export type F30ContractFailure = {
  readonly code: string;
  readonly message: string;
};

export type F30ContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: F30ContractFailure };

function failure(code: string, message: string): F30ContractResult<never> {
  return { ok: false, error: { code, message } };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export function f30Sha256(value: string | Uint8Array): string {
  const source =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bitLength = source.length * 8;
  const paddedLength = ((source.length + 9 + 63) >> 6) << 6;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rightRotate(words[index - 15]!, 7) ^
        rightRotate(words[index - 15]!, 18) ^
        (words[index - 15]! >>> 3);
      const s1 =
        rightRotate(words[index - 2]!, 17) ^
        rightRotate(words[index - 2]!, 19) ^
        (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + SHA256_K[index]! + words[index]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

export function f30ReleaseEvidenceBundleId(input: {
  readonly releaseId: string;
  readonly artifactHashes: readonly string[];
}): string {
  return `f30-evidence-${f30Sha256(stableJson(input)).slice(0, 32)}`;
}

export function parseF30ReleaseManifest(
  value: unknown,
): F30ContractResult<F30ReleaseManifest> {
  const parsed = f30ReleaseManifestSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure(
        "MANIFEST_INVALID",
        "The release manifest is not a bounded F30 manifest.",
      );
}

export function isF30ReleaseManifest(
  value: unknown,
): value is F30ReleaseManifest {
  return f30ReleaseManifestSchema.safeParse(value).success;
}

export function parseF30CriterionEvidence(
  value: unknown,
): F30ContractResult<F30CriterionEvidence> {
  const parsed = f30CriterionEvidenceSchema.safeParse(value);
  if (!parsed.success)
    return failure(
      "CRITERION_EVIDENCE_INVALID",
      "The criterion evidence row is not a bounded F30 evidence record.",
    );
  if (
    (parsed.data.status === "approved-exception" ||
      parsed.data.status === "not-applicable") &&
    parsed.data.approval === undefined
  )
    return failure(
      "CRITERION_APPROVAL_MISSING",
      "An exception or not-applicable criterion requires an explicit approval record.",
    );
  return { ok: true, value: parsed.data };
}

export function isF30CriterionEvidence(
  value: unknown,
): value is F30CriterionEvidence {
  return parseF30CriterionEvidence(value).ok;
}

export interface F30ReleaseGateInput {
  readonly manifest: unknown;
  readonly criteria: readonly unknown[];
  readonly checks?: readonly unknown[];
  readonly gateId?: string;
  readonly generatedAt?: string;
}

export function evaluateF30ReleaseGate(
  input: F30ReleaseGateInput,
): F30ReleaseGateResult {
  const reasons: Array<{
    readonly code: string;
    readonly message: string;
    readonly criterionId?: string;
  }> = [];
  const manifest = parseF30ReleaseManifest(input.manifest);
  if (!manifest.ok) reasons.push(manifest.error);

  const rows = new Map<string, F30CriterionEvidence>();
  for (const candidate of input.criteria) {
    const parsed = parseF30CriterionEvidence(candidate);
    if (!parsed.ok) {
      reasons.push(parsed.error);
      continue;
    }
    if (rows.has(parsed.value.criterionId)) {
      reasons.push({
        code: "CRITERION_DUPLICATE",
        message: `The release trace contains ${parsed.value.criterionId} more than once.`,
        criterionId: parsed.value.criterionId,
      });
      continue;
    }
    rows.set(parsed.value.criterionId, parsed.value);
  }

  for (const criterionId of F30_APPLICATION_CRITERIA) {
    const row = rows.get(criterionId);
    if (row === undefined) {
      reasons.push({
        code: "CRITERION_MISSING",
        message: `${criterionId} has no individual release evidence row.`,
        criterionId,
      });
    } else if (
      row.status !== "passed" &&
      row.status !== "approved-exception" &&
      row.status !== "not-applicable"
    ) {
      reasons.push({
        code: "CRITERION_NOT_GREEN",
        message: `${criterionId} is ${row.status} and cannot release.`,
        criterionId,
      });
    }
  }
  for (const criterionId of rows.keys()) {
    if (!F30_APPLICATION_CRITERIA.includes(criterionId))
      reasons.push({
        code: "CRITERION_UNKNOWN",
        message: `${criterionId} is not part of the 77-criterion application trace.`,
        criterionId,
      });
  }

  for (const candidate of input.checks ?? []) {
    const parsed = f30CheckResultSchema.safeParse(candidate);
    if (!parsed.success) {
      reasons.push({
        code: "CHECK_INVALID",
        message: "A release check result is not a bounded F30 check record.",
      });
    } else if (parsed.data.status !== "passed") {
      reasons.push({
        code: "CHECK_FAILED",
        message: `${parsed.data.id} is ${parsed.data.status}.`,
      });
    }
  }

  if (manifest.ok) {
    if (manifest.value.source.dirty)
      reasons.push({
        code: "SOURCE_DIRTY",
        message:
          "The release candidate source revision has uncommitted changes.",
      });
    if (
      manifest.value.packaging.signed ||
      manifest.value.packaging.releaseTier !== F30_RELEASE_TIER ||
      manifest.value.packaging.updateChannel !== F30_UPDATE_CHANNEL
    )
      reasons.push({
        code: "DISTRIBUTION_POLICY_MISMATCH",
        message:
          "The manifest does not identify the approved unsigned internal-preview/manual-installer tier.",
      });
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const passedCriterionCount = [...rows.values()].filter(
    (row) => row.status === "passed",
  ).length;
  const result: F30ReleaseGateResult = {
    schemaVersion: F30_SCHEMA_VERSION,
    kind: "f30-release-gate-result",
    gateId: input.gateId ?? `f30-gate-${f30Sha256(generatedAt).slice(0, 24)}`,
    generatedAt,
    decision: reasons.length === 0 ? "eligible" : "blocked",
    reasons,
    criterionCount: rows.size,
    passedCriterionCount,
  };
  return f30ReleaseGateResultSchema.parse(result);
}

function scrubDiagnosticText(value: string): F30ContractResult<string> {
  const redacted = redactF29Text(value, {
    maximumBytes: F30_MAX_EVIDENCE_TEXT_BYTES,
  });
  if (!redacted.ok)
    return failure(
      "REDACTION_FAILURE",
      "Support diagnostics contain unsafe text.",
    );
  const scrubbed = redacted.text
    .replace(
      /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"']*|(?<![A-Za-z0-9.])\\\\[A-Za-z0-9._-]+[\\/][^\s"']*|\/(?:Users|home|private|tmp|var)\/[^\s"']*)/giu,
      "[PATH]",
    )
    .slice(0, F30_MAX_EVIDENCE_TEXT_BYTES);
  if (f29ContainsSecretShape(scrubbed))
    return failure(
      "REDACTION_FAILURE",
      "Support diagnostics still contain secret-shaped text after redaction.",
    );
  return { ok: true, value: scrubbed };
}

function scrubIdentifier(value: string, fallback: string): string {
  return safeIdentifierSchema.safeParse(value).success ? value : fallback;
}

export function createF30SupportDiagnostics(
  input: F30SupportDiagnosticsInput,
): F30ContractResult<F30SupportDiagnostics> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const supportCorrelationId = scrubIdentifier(
    input.supportCorrelationId ??
      `support-${f30Sha256(generatedAt).slice(0, 24)}`,
    "support-unknown",
  );
  const activity: F30SupportDiagnostics["recentActivity"] = [];
  for (const item of input.activity.slice(0, F30_MAX_ACTIVITY_EVENTS)) {
    const summary = scrubDiagnosticText(item.summary);
    if (!summary.ok) return summary;
    activity.push({
      eventId: scrubIdentifier(item.eventId, "event-unknown"),
      eventType: scrubIdentifier(item.eventType, "UNKNOWN_EVENT"),
      stage: scrubIdentifier(item.stage, "SYSTEM"),
      severity: scrubIdentifier(item.severity, "INFO"),
      reasonCode: scrubIdentifier(item.reasonCode, "UNKNOWN_REASON"),
      correlationId: scrubIdentifier(item.correlationId, "correlation-unknown"),
      ...(item.operationId === undefined
        ? {}
        : {
            operationId: scrubIdentifier(item.operationId, "operation-unknown"),
          }),
      occurrenceAt: item.occurrenceAt,
      recordedAt: item.recordedAt,
      summary: summary.value,
    });
  }
  const featureHealth = input.featureHealth.slice(0, 32).map((item) => ({
    featureId: /^F(?:0|[1-2][0-9]|30)$/u.test(item.featureId)
      ? item.featureId
      : "F30",
    status: item.status,
    ...(item.reasonCode === undefined
      ? {}
      : { reasonCode: scrubIdentifier(item.reasonCode, "UNKNOWN_REASON") }),
  }));
  const report: F30SupportDiagnostics = {
    schemaVersion: F30_SCHEMA_VERSION,
    kind: "prmonitor-support-diagnostics",
    supportCorrelationId,
    generatedAt,
    product: {
      name: F30_PRODUCT_NAME,
      applicationId: F30_APPLICATION_ID,
      version: scrubIdentifier(input.applicationVersion, "unknown-version"),
    },
    source: {
      revision: scrubIdentifier(input.sourceRevision, "unknown-revision"),
    },
    runtime: {
      node: scrubIdentifier(input.runtime.node, "unknown-node"),
      electron: scrubIdentifier(input.runtime.electron, "unknown-electron"),
      platform: scrubIdentifier(input.runtime.platform, "unknown-platform"),
      architecture: scrubIdentifier(input.runtime.architecture, "unknown-arch"),
    },
    persistence: {
      status: ["healthy", "upgraded", "recovery_required"].includes(
        input.persistence.status,
      )
        ? (input.persistence.status as
            "healthy" | "upgraded" | "recovery_required")
        : "recovery_required",
      schemaVersion: Math.max(0, Math.floor(input.persistence.schemaVersion)),
    },
    lifecycle: {
      phase: [
        "STARTING",
        "RUNNING",
        "SHUTDOWN_REQUESTED",
        "HANDING_OFF",
        "STOPPED",
        "RECOVERY_REQUIRED",
      ].includes(input.lifecycle.phase)
        ? (input.lifecycle.phase as F30SupportDiagnostics["lifecycle"]["phase"])
        : "RECOVERY_REQUIRED",
      incompleteHandoff: input.lifecycle.incompleteHandoff,
      ...(input.lifecycle.reasonCode === undefined
        ? {}
        : {
            reasonCode: scrubIdentifier(
              input.lifecycle.reasonCode,
              "UNKNOWN_REASON",
            ),
          }),
    },
    recovery: {
      status: ["IDLE", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"].includes(
        input.recovery.status,
      )
        ? (input.recovery.status as
            "IDLE" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED")
        : "PARTIAL",
      scopes: Math.max(0, Math.min(250, Math.floor(input.recovery.scopes))),
      completed: Math.max(
        0,
        Math.min(250, Math.floor(input.recovery.completed)),
      ),
      attention: Math.max(
        0,
        Math.min(250, Math.floor(input.recovery.attention)),
      ),
      retrying: Math.max(0, Math.min(250, Math.floor(input.recovery.retrying))),
    },
    featureHealth,
    recentActivity: activity,
    redaction: {
      policy: "allowlisted-safe-projection-v1",
      sourceAndDiffContent: "omitted",
      credentialsAndPrompts: "omitted",
      localPathsAndEnvironment: "omitted",
    },
  };
  const parsed = f30SupportDiagnosticsSchema.safeParse(report);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure(
        "DIAGNOSTICS_INVALID",
        "The support-diagnostics projection did not satisfy the F30 safe schema.",
      );
}

export function isF30SupportDiagnostics(
  value: unknown,
): value is F30SupportDiagnostics {
  return f30SupportDiagnosticsSchema.safeParse(value).success;
}
