/**
 * Provider-neutral contracts for F13.  These types deliberately contain no
 * Git, Electron, provider SDK, or filesystem implementation details so that
 * downstream workflows can consume worktree evidence without taking local
 * execution authority.
 */

export const F13_CONTRACT_SCHEMA_VERSION = 1 as const;
export const F13_MAX_IDENTIFIER_BYTES = 128;
export const F13_MAX_PATH_BYTES = 4_096;
export const F13_MAX_BRANCH_BYTES = 512;
export const F13_MAX_SHA_BYTES = 128;
export const F13_MAX_FILE_COUNT = 2_000;
export const F13_MAX_SNAPSHOT_FILE_BYTES = 256 * 1024;
export const F13_MAX_PATCH_BYTES = 512 * 1024;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const F13_OPERATION_KINDS = [
  "REVIEW",
  "CONVERSATION",
  "SYNCHRONIZATION",
] as const;
export type F13OperationKind = (typeof F13_OPERATION_KINDS)[number];

export const F13_LIFECYCLE_STATES = [
  "PENDING",
  "PREPARING",
  "ACTIVE",
  "DIRTY",
  "INTERRUPTED",
  "UNKNOWN",
  "RETAINED",
  "CLEARED",
  "RELEASED",
  "CONFLICT",
  "FAILED",
] as const;
export type F13LifecycleState = (typeof F13_LIFECYCLE_STATES)[number];

export type F13SnapshotPhase =
  | "PREPARE"
  | "INSPECTION"
  | "BEFORE_AI"
  | "AFTER_AI"
  | "CLEAR_BEFORE"
  | "CLEAR_AFTER";

export type F13DiffKind = "PROPOSED" | "CONTEXT";
export type F13ClearChoice = "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL";

export interface F13RepositoryIdentity {
  readonly serverId: string;
  readonly owner: string;
  readonly name: string;
  readonly key?: string;
}

export interface F13ReviewRefSnapshot {
  readonly baseRepository: F13RepositoryIdentity;
  readonly headRepository: F13RepositoryIdentity;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly prBaseSha: string;
  readonly prHeadSha: string;
}

export interface F13SynchronizationRefSnapshot {
  readonly sourceRepository: F13RepositoryIdentity;
  readonly destinationRepository: F13RepositoryIdentity;
  readonly sourceBranch: string;
  readonly destinationBranch: string;
  readonly syncSourceSha: string;
  readonly prHeadSha: string;
  readonly syncMergeBaseSha?: string;
}

export interface F13OperationRequestBase {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly managedPrId?: string;
  readonly operationKind: F13OperationKind;
  /** The validated F07 base clone. It is read-only input, never a mutation target. */
  readonly developerClonePath: string;
  /** Optional F07 identity proof for the local clone supplied by the owner. */
  readonly developerCloneRepository?: F13RepositoryIdentity;
  /** The configured root for this request; omitted only when the service has a default. */
  readonly worktreeRoot?: string;
  /** Monotonic setting revision captured by the owning workflow. */
  readonly rootRevision?: number;
}

export interface F13ReviewOperationRequest extends F13OperationRequestBase {
  readonly operationKind: "REVIEW" | "CONVERSATION";
  readonly refs: F13ReviewRefSnapshot;
}

export interface F13SynchronizationOperationRequest extends F13OperationRequestBase {
  readonly operationKind: "SYNCHRONIZATION";
  readonly refs: F13SynchronizationRefSnapshot;
}

export type F13OperationRequest =
  F13ReviewOperationRequest | F13SynchronizationOperationRequest;

export interface F13RootResolution {
  readonly ok: boolean;
  readonly configuredPath?: string;
  readonly canonicalPath?: string;
  readonly rootRevision: number;
  readonly reason?: F13SafeReason;
}

export type F13ReasonCategory =
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "GIT"
  | "FILESYSTEM"
  | "STALE"
  | "RECOVERY"
  | "CANCELLED"
  | "LIMIT";

export type F13NextAction =
  | "FIX_INPUT"
  | "RETRY"
  | "RECONCILE"
  | "SELECT_WORKTREE_ACTION"
  | "MANUAL_RESOLUTION"
  | "OPEN_SETTINGS"
  | "NONE";

export interface F13SafeReason {
  readonly code: string;
  readonly category: F13ReasonCategory;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F13NextAction;
  readonly correlationId: string;
}

export interface F13FileEvidence {
  readonly path: string;
  readonly kind:
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "ignored"
    | "type_changed"
    | "unknown";
  readonly staged: boolean;
  readonly worktreeChanged: boolean;
  readonly oldPath?: string;
  readonly contentHash?: string;
  readonly sizeBytes?: number;
  readonly binary?: boolean;
  /** Bounded content evidence used only for deterministic three-way removal. */
  readonly contentBase64?: string;
  readonly contentComplete?: boolean;
}

export interface F13SnapshotManifest {
  readonly schemaVersion: number;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly phase: F13SnapshotPhase;
  readonly turnId?: string;
  readonly headSha?: string;
  readonly expectedHeadSha: string;
  readonly prBaseSha: string;
  readonly worktreeBaselineSha: string;
  readonly files: readonly F13FileEvidence[];
  readonly ignoredFiles: readonly string[];
  readonly statusTextHash: string;
  readonly stateFingerprint: string;
  readonly complete: boolean;
  readonly gitErrors: readonly string[];
  readonly capturedAt: string;
}

export interface F13SnapshotRecord {
  readonly snapshotId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly phase: F13SnapshotPhase;
  readonly turnId?: string;
  readonly stateFingerprint: string;
  readonly manifest: F13SnapshotManifest;
  readonly changeSummary?: F13ChangeSummary;
  readonly createdAt: string;
}

export interface F13ChangeSummary {
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly deleted: readonly string[];
  readonly renamed: readonly string[];
  readonly binary: readonly string[];
  readonly untracked: readonly string[];
  readonly manualOrUnknown: readonly string[];
  readonly hash: string;
}

export interface F13DiffEvidence {
  readonly diffId: string;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly kind: F13DiffKind;
  readonly baselineSha: string;
  readonly currentSha?: string;
  readonly diffHash: string;
  readonly patchHash: string;
  readonly patch?: string;
  readonly files: readonly F13FileEvidence[];
  readonly untrackedFiles: readonly string[];
  readonly untrackedEvidence?: readonly F13FileEvidence[];
  readonly complete: boolean;
  readonly regenerationContract: string;
  readonly createdAt: string;
}

export interface F13WorktreeRecord {
  readonly worktreeId: string;
  readonly operationId: string;
  readonly managedPrId?: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly operationKind: F13OperationKind;
  readonly canonicalPath: string;
  readonly configuredRoot: string;
  readonly rootRevision: number;
  readonly lifecycle: F13LifecycleState;
  readonly refs: F13ReviewRefSnapshot | F13SynchronizationRefSnapshot;
  readonly sourceRepository: F13RepositoryIdentity;
  readonly destinationRepository?: F13RepositoryIdentity;
  readonly currentHeadSha?: string;
  readonly worktreeBaselineSha: string;
  readonly available: boolean;
  readonly reason?: F13SafeReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface F13PreparationResult {
  readonly ok: boolean;
  readonly worktree?: F13WorktreeRecord;
  readonly inspection?: F13InspectionResult;
  readonly reason?: F13SafeReason;
}

export interface F13InspectionResult {
  readonly ok: boolean;
  readonly worktree: F13WorktreeRecord;
  readonly snapshot?: F13SnapshotRecord;
  readonly proposedDiff?: F13DiffEvidence;
  readonly contextDiff?: F13DiffEvidence;
  readonly reason?: F13SafeReason;
}

export type F13ProviderAccess = "READ_ONLY" | "WORKTREE_WRITE";

export interface F13ProviderActualStateEvidence {
  readonly snapshotId: string;
  readonly stateFingerprint: string;
  readonly baselineRevision: string;
  readonly expectedHeadRevision: string;
  readonly currentHeadRevision?: string;
  readonly files: readonly {
    readonly path: string;
    readonly kind: F13FileEvidence["kind"];
    readonly staged: boolean;
    readonly worktreeChanged: boolean;
    readonly oldPath?: string;
    readonly contentHash?: string;
    readonly sizeBytes?: number;
    readonly binary?: boolean;
  }[];
  readonly ignoredFiles: readonly string[];
  readonly complete: boolean;
}

/**
 * F13's immutable input to a provider adapter.  The adapter receives the
 * canonical operation-owned path and actual-state evidence, but it cannot
 * submit a path, Git claim, or publication action back through this record.
 */
export interface F13ProviderWorktreeHandoff {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly worktreeId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly operationKind: F13OperationKind;
  readonly canonicalPath: string;
  readonly access: F13ProviderAccess;
  readonly ownership: {
    readonly kind: "OPERATION_OWNED";
    readonly ownerType: string;
    readonly ownerId: string;
  };
  readonly actualState: F13ProviderActualStateEvidence;
  readonly permittedCapabilities: {
    readonly readFiles: true;
    readonly writeFiles: boolean;
    readonly executeCommands: false;
    readonly network: false;
    readonly publication: false;
  };
}

export interface F13ProviderWorktreeHandoffResult {
  readonly ok: boolean;
  readonly handoff?: F13ProviderWorktreeHandoff;
  readonly reason?: F13SafeReason;
}

export interface F13AiTurnBeforeResult {
  readonly ok: boolean;
  readonly snapshot?: F13SnapshotRecord;
  readonly mutationRoot?: string;
  readonly worktree?: F13ProviderWorktreeHandoff;
  readonly reason?: F13SafeReason;
}

export interface F13AiTurnAfterResult {
  readonly ok: boolean;
  readonly beforeSnapshotId: string;
  readonly snapshot?: F13SnapshotRecord;
  readonly changeSummary?: F13ChangeSummary;
  readonly worktree?: F13ProviderWorktreeHandoff;
  readonly reason?: F13SafeReason;
}

export interface F13ClearResult {
  readonly ok: boolean;
  readonly choice: F13ClearChoice;
  readonly worktree: F13WorktreeRecord;
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly remaining: readonly string[];
  readonly reason?: F13SafeReason;
}

export type F13PathAction = "OPEN_WORKTREE" | "OPEN_FILE" | "REVEAL_FILE";

export interface F13PathActionResult {
  readonly ok: boolean;
  readonly action: F13PathAction;
  readonly resolvedPath?: string;
  readonly reason?: F13SafeReason;
}

export function isF13OperationKind(value: unknown): value is F13OperationKind {
  return (
    typeof value === "string" &&
    (F13_OPERATION_KINDS as readonly string[]).includes(value)
  );
}

export function isF13ClearChoice(value: unknown): value is F13ClearChoice {
  return (
    value === "CLEAR_ALL" ||
    value === "CLEAR_AI_ONLY" ||
    value === "KEEP_AND_CANCEL"
  );
}

export function isSafeF13Identifier(value: string): boolean {
  return (
    typeof value === "string" &&
    byteLength(value) <= F13_MAX_IDENTIFIER_BYTES &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  );
}

export function isSafeF13RepositoryKey(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= F13_MAX_IDENTIFIER_BYTES &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127 && character !== "\\";
    })
  );
}

export function isSafeF13Sha(value: string): boolean {
  return (
    typeof value === "string" &&
    byteLength(value) <= F13_MAX_SHA_BYTES &&
    /^[0-9a-f]{7,64}$/iu.test(value)
  );
}

export function isSafeF13Branch(value: string): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  const forbidden = ["~", "^", ":", "?", "*", "[", "\\", "@{"];
  return (
    byteLength(value) <= F13_MAX_BRANCH_BYTES &&
    value.length > 0 &&
    !value.includes("\u0000") &&
    !value.includes("\r") &&
    !value.includes("\n") &&
    !value.includes(" ") &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    }) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("..") &&
    !forbidden.some((character) => value.includes(character)) &&
    parts.every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".." &&
        !part.startsWith(".") &&
        !part.endsWith(".lock"),
    )
  );
}
