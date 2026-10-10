import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { IpcRequest, IpcError } from "../shared/ipc";
import {
  createF29ControlledEnvironment,
  evaluateF29Capability,
  evaluateF29EffectAdmission,
  f29HasControlCharacter,
  prepareF29GitInvocation,
  validateF29OwnedPath,
  validateF29PathSyntax,
  type F29CapabilityRequest,
  type F29GitInvocation,
  type F29OwnedPath,
  type F29PathPlatform,
  type F29Result,
  type F29SecurityReason,
} from "../shared/f29-security";

export interface F29FileSystemPort {
  readonly realpath: (value: string) => Promise<string>;
  readonly lstat: (value: string) => Promise<{
    readonly isFile: () => boolean;
    readonly isDirectory: () => boolean;
    readonly isSymbolicLink: () => boolean;
  }>;
}

const nativeFileSystem: F29FileSystemPort = {
  realpath: (value) => realpath(value),
  lstat: async (value) => lstat(value),
};

export interface F29OwnedPathRequest {
  readonly operationId: string;
  readonly ownerOperationId: string;
  readonly operationRoot: string;
  readonly targetPath: string;
  readonly expectedType: "file" | "directory";
  readonly expectedRevision?: string;
  readonly currentRevision?: string;
  readonly developerClonePath?: string;
  readonly forbiddenRoots?: readonly string[];
  readonly platform?: F29PathPlatform;
}

export type F29OwnedPathResult =
  | { readonly ok: true; readonly value: F29OwnedPath }
  | { readonly ok: false; readonly error: F29SecurityReason };

export interface F29IpcSecurityGate {
  authorizeRequest(input: {
    readonly request: IpcRequest;
    readonly senderId: number;
    readonly sessionId: string;
  }): { readonly ok: true } | { readonly ok: false; readonly error: IpcError };
}

const privilegedRequestTypes = new Set<IpcRequest["type"]>([
  "ai.tools.check",
  "ai.program.pick",
  "preferences.ai-connection.save",
  "scheduler.configuration.save",
  "scheduler.check-now",
  "scheduler.pause",
  "scheduler.resume",
  "lifecycle.shutdown",
  "support-diagnostics.export",
  "github.credential.submit",
  "github.operation.retry",
  "github.operation.cleanup",
  "github.profile.remove",
  "managed-pr.add",
  "managed-pr.retry",
  "managed-pr.clone.attach",
  "managed-pr.clone.clear",
  "managed-pr.configuration.save",
  "synchronization.confirm",
  "synchronization.intent.reconcile",
  "synchronization.conflict.retry",
  "synchronization.operation.cancel",
  "synchronization.review.worktree.action",
  "synchronization.review.reevaluate",
  "synchronization.review.discard",
  "synchronization.review.publication.approve",
  "synchronization.review.publication.publish",
  "synchronization.review.publication.reconcile",
  "review-bundle.decision.record",
  "review-bundle.decisions.confirm",
  "review-bundle.discard.confirm",
  "review-bundle.reevaluate.confirm",
  "review-bundle.revision.request",
  "review-bundle.conversation.ask",
  "review-bundle.conversation.continue",
  "review-bundle.publication.approve",
  "review-bundle.publication.publish",
  "review-bundle.publication.reconcile",
  "review-bundle.publication.retry-responses",
  "review-bundle.publication.discard",
]);

function boundedMessage(message: string): string {
  let safeMessage = "";
  for (const character of message) {
    safeMessage += f29HasControlCharacter(character) ? " " : character;
  }
  return safeMessage.slice(0, 512);
}

function securityReason(input: {
  readonly code: F29SecurityReason["code"];
  readonly boundary: F29SecurityReason["boundary"];
  readonly operationId: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F29SecurityReason["nextAction"];
  readonly retryable?: boolean;
  readonly evidenceRefs?: readonly string[];
  readonly safeEvidence?: Readonly<Record<string, string | number | boolean>>;
}): F29SecurityReason {
  return {
    schemaVersion: 1,
    kind: "f29-security-reason",
    code: input.code,
    boundary: input.boundary,
    operationId: input.operationId,
    what: boundedMessage(input.what),
    why: boundedMessage(input.why),
    nextAction: input.nextAction,
    retryable: input.retryable ?? false,
    evidenceRefs: [...(input.evidenceRefs ?? [])].slice(0, 16),
    safeEvidence: { ...(input.safeEvidence ?? {}) },
  };
}

function reasonFromFailure(
  failure: {
    readonly code: F29SecurityReason["code"];
    readonly message: string;
  },
  input: {
    readonly operationId: string;
    readonly boundary: F29SecurityReason["boundary"];
    readonly nextAction?: F29SecurityReason["nextAction"];
  },
): F29SecurityReason {
  return securityReason({
    code: failure.code,
    boundary: input.boundary,
    operationId: input.operationId,
    what: boundedMessage(failure.message),
    why: "The F29 trust boundary could not prove that the requested value remains inside its declared authority.",
    nextAction: input.nextAction ?? "REVIEW",
    retryable: false,
  });
}

function pathFailure(
  result: F29Result<unknown>,
  input: F29OwnedPathRequest,
): F29OwnedPathResult {
  if (result.ok) return { ok: true, value: result.value as F29OwnedPath };
  return {
    ok: false,
    error: reasonFromFailure(result.error, {
      operationId: input.operationId,
      boundary: "filesystem_worktree",
      nextAction:
        result.error.code === "PATH_REVISION_STALE"
          ? "RE_EVALUATE"
          : "RECONCILE",
    }),
  };
}

export class F29SecurityService implements F29IpcSecurityGate {
  public constructor(
    private readonly options: {
      readonly applicationDataRoot?: string;
      readonly fileSystem?: F29FileSystemPort;
      readonly platform?: F29PathPlatform;
    } = {},
  ) {}

  public authorizeRequest(input: {
    readonly request: IpcRequest;
    readonly senderId: number;
    readonly sessionId: string;
  }): { readonly ok: true } | { readonly ok: false; readonly error: IpcError } {
    if (!Number.isSafeInteger(input.senderId) || input.senderId < 0) {
      return {
        ok: false,
        error: {
          code: "SECURITY_BLOCKED",
          message: "The renderer identity is not valid for this request.",
          correlationId: `f29-ipc-${input.request.requestId}`,
        },
      };
    }
    if (input.sessionId.length === 0 || input.sessionId.length > 128) {
      return {
        ok: false,
        error: {
          code: "SECURITY_BLOCKED",
          message: "The renderer session is not a bounded active identity.",
          correlationId: `f29-ipc-${input.request.requestId}`,
        },
      };
    }
    if (privilegedRequestTypes.has(input.request.type)) {
      const payload = input.request.payload as unknown;
      if (payload === null || typeof payload !== "object") {
        return {
          ok: false,
          error: {
            code: "SECURITY_BLOCKED",
            message: "The privileged request payload is not a typed object.",
            correlationId: `f29-ipc-${input.request.requestId}`,
          },
        };
      }
    }
    return { ok: true };
  }

  public async resolveOwnedPath(
    input: F29OwnedPathRequest,
  ): Promise<F29OwnedPathResult> {
    const fileSystem = this.options.fileSystem ?? nativeFileSystem;
    const syntax = validateF29PathSyntax(input.targetPath, {
      platform: input.platform ?? this.options.platform,
      allowRelative: false,
    });
    if (!syntax.ok) return pathFailure(syntax, input);
    try {
      const rootRecord = await fileSystem.lstat(input.operationRoot);
      const targetRecord = await fileSystem.lstat(input.targetPath);
      if (rootRecord.isSymbolicLink() || targetRecord.isSymbolicLink()) {
        return {
          ok: false,
          error: securityReason({
            code: "PATH_UNSAFE_SYMLINK",
            boundary: "filesystem_worktree",
            operationId: input.operationId,
            what: "The operation root or target is a symbolic link or junction.",
            why: "F29 cannot prove operation ownership across a link boundary.",
            nextAction: "RECONCILE",
          }),
        };
      }
      const canonicalRoot = await fileSystem.realpath(input.operationRoot);
      const canonicalTarget = await fileSystem.realpath(input.targetPath);
      const actualType = targetRecord.isFile()
        ? "file"
        : targetRecord.isDirectory()
          ? "directory"
          : "other";
      const validated = validateF29OwnedPath({
        ...input,
        operationRoot: canonicalRoot,
        canonicalPath: canonicalTarget,
        actualType,
        platform: input.platform ?? this.options.platform,
      });
      return pathFailure(validated, input);
    } catch {
      return {
        ok: false,
        error: securityReason({
          code: "PATH_UNSUPPORTED",
          boundary: "filesystem_worktree",
          operationId: input.operationId,
          what: "The operation-owned target could not be canonicalized or inspected.",
          why: "F29 preserves the operation and never substitutes an arbitrary path after filesystem uncertainty.",
          nextAction: "RECONCILE",
        }),
      };
    }
  }

  public validateDatabasePath(input: {
    readonly databasePath: string;
    readonly applicationDataRoot?: string;
  }): F29Result<{ readonly databasePath: string }> {
    const root = input.applicationDataRoot ?? this.options.applicationDataRoot;
    if (root === undefined)
      return {
        ok: false,
        error: {
          code: "DATABASE_PATH_REJECTED",
          message: "The authoritative application-data root is not configured.",
        },
      };
    const platform =
      this.options.platform ??
      (process.platform === "win32" ? "win32" : "posix");
    const rootResult = validateF29PathSyntax(root, { platform });
    const databaseResult = validateF29PathSyntax(input.databasePath, {
      platform,
    });
    if (!rootResult.ok || !databaseResult.ok)
      return {
        ok: false,
        error: {
          code: "DATABASE_PATH_REJECTED",
          message:
            "The authoritative database path is not canonical application data.",
        },
      };
    const rootKey = rootResult.value.replace(/[\\/]+$/u, "").toLowerCase();
    const databaseKey = databaseResult.value.toLowerCase();
    if (
      databaseKey !== `${rootKey}/database/prmonitor.sqlite` &&
      databaseKey !== `${rootKey}\\database\\prmonitor.sqlite`
    )
      return {
        ok: false,
        error: {
          code: "DATABASE_PATH_REJECTED",
          message:
            "The authoritative database must remain under the application-data database directory.",
        },
      };
    return { ok: true, value: { databasePath: input.databasePath } };
  }

  public createControlledEnvironment(input: {
    readonly source: Record<string, string | undefined>;
    readonly allowedKeys?: readonly string[];
    readonly knownSecrets?: readonly string[];
    readonly strict?: boolean;
  }): F29Result<Record<string, string>> {
    return createF29ControlledEnvironment(input);
  }

  public prepareGitInvocation(input: {
    readonly operationId: string;
    readonly repositoryIdentity: string;
    readonly cwd: string;
    readonly args: readonly string[];
    readonly expectedShas?: readonly string[];
    readonly platform?: F29PathPlatform;
  }): F29Result<F29GitInvocation> {
    return prepareF29GitInvocation(input);
  }

  public evaluateCapability(
    input: F29CapabilityRequest,
  ): F29Result<{ readonly admitted: true; readonly operationId: string }> {
    return evaluateF29Capability(input);
  }

  public evaluateEffect(
    input: Parameters<typeof evaluateF29EffectAdmission>[0],
  ): F29Result<{ readonly admitted: true }> {
    return evaluateF29EffectAdmission(input);
  }

  public applicationDataRoot(): string | undefined {
    return this.options.applicationDataRoot;
  }

  public resolveApplicationPath(relativePath: string): string | undefined {
    const root = this.options.applicationDataRoot;
    if (root === undefined) return undefined;
    const candidate = path.resolve(root, relativePath);
    const rootKey = path.resolve(root).toLowerCase();
    const candidateKey = candidate.toLowerCase();
    return candidateKey === rootKey ||
      candidateKey.startsWith(`${rootKey}${path.sep}`)
      ? candidate
      : undefined;
  }
}

export function createF29SecurityService(
  options: ConstructorParameters<typeof F29SecurityService>[0] = {},
): F29SecurityService {
  return new F29SecurityService(options);
}
