import { createHash, randomUUID } from "node:crypto";
import { access, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createF30SupportDiagnostics,
  type F30SupportActivitySummary,
  type F30SupportDiagnostics,
  type F30SupportDiagnosticsInput,
} from "../shared/f30-release";

export interface F30SupportDiagnosticsServiceOptions {
  readonly applicationVersion: string;
  readonly sourceRevision: string;
  readonly readRuntime: () => F30SupportDiagnosticsInput["runtime"];
  readonly readPersistence: () => F30SupportDiagnosticsInput["persistence"];
  readonly readLifecycle: () => F30SupportDiagnosticsInput["lifecycle"];
  readonly readRecovery: () => F30SupportDiagnosticsInput["recovery"];
  readonly readFeatureHealth: () => F30SupportDiagnosticsInput["featureHealth"];
  readonly readActivity: () => readonly F30SupportActivitySummary[];
  readonly now?: () => string;
}

export type F30SupportDiagnosticsExportResult =
  | {
      readonly ok: true;
      readonly correlationId: string;
      readonly fileName: string;
      readonly bytes: number;
      readonly digest: string;
      readonly diagnostics: F30SupportDiagnostics;
    }
  | {
      readonly ok: false;
      readonly correlationId: string;
      readonly code:
        "INVALID_DESTINATION" | "REDACTION_FAILURE" | "WRITE_FAILED";
      readonly message: string;
    };

function safeFileName(destination: string): string {
  return path
    .basename(destination)
    .replace(/[^A-Za-z0-9._-]/gu, "_")
    .slice(0, 160);
}

function safeSupportCorrelationId(value: string): string {
  return `support-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function boundedActivity(
  events: readonly F30SupportActivitySummary[],
): readonly F30SupportActivitySummary[] {
  return events.slice(0, 100).map((event) => ({
    eventId: event.eventId,
    eventType: event.eventType,
    stage: event.stage,
    severity: event.severity,
    reasonCode: event.reasonCode,
    correlationId: event.correlationId,
    ...(event.operationId === undefined
      ? {}
      : { operationId: event.operationId }),
    occurrenceAt: event.occurrenceAt,
    recordedAt: event.recordedAt,
    summary: event.summary,
  }));
}

export class F30SupportDiagnosticsService {
  private readonly now: () => string;

  public constructor(
    private readonly options: F30SupportDiagnosticsServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public create():
    | {
        readonly ok: true;
        readonly correlationId: string;
        readonly value: F30SupportDiagnostics;
      }
    | {
        readonly ok: false;
        readonly correlationId: string;
        readonly code: "REDACTION_FAILURE";
        readonly message: string;
      } {
    const correlationId = safeSupportCorrelationId(
      `${this.options.applicationVersion}:${this.now()}:${randomUUID()}`,
    );
    const result = createF30SupportDiagnostics({
      applicationVersion: this.options.applicationVersion,
      sourceRevision: this.options.sourceRevision,
      runtime: this.options.readRuntime(),
      persistence: this.options.readPersistence(),
      lifecycle: this.options.readLifecycle(),
      recovery: this.options.readRecovery(),
      featureHealth: this.options.readFeatureHealth(),
      activity: boundedActivity(this.options.readActivity()),
      generatedAt: this.now(),
      supportCorrelationId: correlationId,
    });
    if (!result.ok)
      return {
        ok: false,
        correlationId,
        code: "REDACTION_FAILURE",
        message: result.error.message,
      };
    return { ok: true, correlationId, value: result.value };
  }

  public async exportTo(
    destination: string,
  ): Promise<F30SupportDiagnosticsExportResult> {
    const correlationId = safeSupportCorrelationId(
      `${this.options.applicationVersion}:${this.now()}:${randomUUID()}`,
    );
    if (!path.isAbsolute(destination) || safeFileName(destination).length === 0)
      return {
        ok: false,
        correlationId,
        code: "INVALID_DESTINATION",
        message: "Choose an absolute file destination for support diagnostics.",
      };
    const created = this.create();
    if (!created.ok)
      return {
        ok: false,
        correlationId,
        code: created.code,
        message: created.message,
      };
    const serialized = `${JSON.stringify(created.value, null, 2)}\n`;
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > 256 * 1024)
      return {
        ok: false,
        correlationId,
        code: "REDACTION_FAILURE",
        message:
          "The bounded support-diagnostics export exceeded its size limit.",
      };
    const temporary = `${destination}.${correlationId}.partial`;
    try {
      await access(path.dirname(destination));
      await access(destination).then(
        () => {
          throw new Error("F30_DIAGNOSTICS_DESTINATION_EXISTS");
        },
        () => undefined,
      );
      await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
      await rename(temporary, destination);
      return {
        ok: true,
        correlationId: created.correlationId,
        fileName: safeFileName(destination),
        bytes,
        digest: createHash("sha256").update(serialized, "utf8").digest("hex"),
        diagnostics: created.value,
      };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      return {
        ok: false,
        correlationId,
        code: "WRITE_FAILED",
        message:
          error instanceof Error
            ? "Support diagnostics could not be written safely. Choose another destination and retry."
            : "Support diagnostics could not be written safely.",
      };
    }
  }
}
