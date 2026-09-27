import type {
  GithubAnyRepositoryIdentity,
  GithubRemoteServerIdentity,
  GithubRepositoryIdentity,
} from "./github-rest";
import type { PrimaryPrState } from "./domain/primary";

export const F07_SCHEMA_VERSION = 1 as const;
export const MAX_MANAGED_PR_URL_BYTES = 2_048;
export const MAX_PR_INTENT_CONTEXT_BYTES = 32 * 1024;
export const MAX_SYNC_SOURCE_BRANCH_BYTES = 255;
export const MAX_LOCAL_CLONE_PATH_LENGTH = 4_096;
export const MAX_LOCAL_GIT_OUTPUT_BYTES = 64 * 1024;
export const MAX_MANAGED_PR_REASON_BYTES = 8 * 1024;

export type AddPrAttemptStatus =
  "PENDING" | "SUCCEEDED" | "CANCELLED" | "FAILED" | "RECOVERY_REQUIRED";

export type ManagedPrLocalSetupStatus =
  | "LOCAL_CLONE_REQUIRED"
  | "VALID"
  | "DIRTY"
  | "MISSING"
  | "INVALID"
  | "UNKNOWN";

export type ManagedPrLocalCleanState = "CLEAN" | "DIRTY" | "UNKNOWN";

export type ManagedPrReasonCategory =
  | "VALIDATION"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "CANCELLED"
  | "CONFLICT"
  | "LOCAL_PATH"
  | "LOCAL_GIT"
  | "RECOVERY"
  | "UNKNOWN";

export type ManagedPrReasonNextAction =
  | "FIX_INPUT"
  | "REPLACE_ACCESS"
  | "RETRY"
  | "WAIT"
  | "SELECT_CLONE"
  | "ADD_WITHOUT_LOCAL_CLONE"
  | "RELOAD"
  | "NONE";

export interface ManagedPrReason {
  readonly code: string;
  readonly category: ManagedPrReasonCategory;
  readonly what: string;
  readonly why: string;
  readonly nextAction: ManagedPrReasonNextAction;
  readonly correlationId: string;
}

export interface ManagedPrRemoteSnapshot {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly canonicalUrl: string;
  readonly pullRequestKey: string;
  readonly serverId: string;
  readonly server: GithubRemoteServerIdentity;
  readonly owner: string;
  readonly repositoryName: string;
  readonly number: number;
  readonly state: "OPEN" | "CLOSED";
  readonly merged: boolean;
  readonly title?: string;
  readonly baseRepository: GithubRepositoryIdentity;
  readonly headRepository: GithubAnyRepositoryIdentity;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly defaultBranch?: string;
}

export interface ManagedPrConfigurationView {
  readonly revisionId: string;
  readonly revision: number;
  readonly context: string | null;
  readonly syncSourceBranchOverride: string | null;
  readonly contentHash: string;
  readonly source: "ADD_PR" | "USER_EDIT";
  readonly createdAt: string;
}

export interface ManagedPrLocalCloneView {
  readonly associationId: string;
  readonly status: Exclude<ManagedPrLocalSetupStatus, "LOCAL_CLONE_REQUIRED">;
  readonly cleanState: ManagedPrLocalCleanState;
  readonly canonicalRoot: string;
  readonly repository: {
    readonly serverKey: string;
    readonly owner: string;
    readonly name: string;
    readonly key: string;
  };
  readonly validationSnapshot: {
    readonly inspectorVersion: string;
    readonly validatedAt: string;
    readonly remoteCount: number;
    readonly worktreeRoot: string;
  };
  readonly validatedAt: string;
  readonly version: number;
}

export interface ManagedPrReadModel {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly id: string;
  readonly canonicalUrl: string;
  readonly pullRequestKey: string;
  readonly serverId: string;
  readonly owner: string;
  readonly repositoryName: string;
  readonly number: number;
  readonly state: "OPEN" | "CLOSED";
  readonly merged: boolean;
  readonly title?: string;
  readonly baseRepository: GithubRepositoryIdentity;
  readonly headRepository: GithubAnyRepositoryIdentity;
  readonly prBaseBranch: string;
  readonly prHeadBranch: string;
  readonly prBaseSha: string;
  readonly prHeadSha: string;
  readonly defaultBranch?: string;
  readonly primaryState: PrimaryPrState;
  readonly localSetupStatus: ManagedPrLocalSetupStatus;
  readonly localClone?: ManagedPrLocalCloneView;
  readonly configuration: ManagedPrConfigurationView;
  readonly lastOperationReason?: ManagedPrReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddPrAttemptView {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly id: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly canonicalPrKey: string;
  readonly serverId: string;
  readonly normalizedUrl: string;
  readonly status: AddPrAttemptStatus;
  readonly managedPrId?: string;
  readonly reason?: ManagedPrReason;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ManagedPrCandidateView {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly canonicalRoot: string;
  readonly repository: ManagedPrLocalCloneView["repository"];
  readonly status: ManagedPrLocalSetupStatus;
  readonly cleanState: ManagedPrLocalCleanState;
  readonly lastValidatedAt?: string;
}

export interface ManagedPrCandidateListView {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly managedPrId: string;
  readonly candidates: readonly ManagedPrCandidateView[];
}

export interface ManagedPrListView {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly managedPrs: readonly ManagedPrReadModel[];
  readonly attempts: readonly AddPrAttemptView[];
}

export type ManagedPrOperationKind =
  | "ADD_PR"
  | "RETRY_ADD_PR"
  | "ATTACH_CLONE"
  | "CLEAR_CLONE"
  | "SAVE_CONFIGURATION";

export interface ManagedPrOperationView {
  readonly schemaVersion: typeof F07_SCHEMA_VERSION;
  readonly kind: ManagedPrOperationKind;
  readonly status: AddPrAttemptStatus | "COMPLETED";
  readonly attempt?: AddPrAttemptView;
  readonly managedPr?: ManagedPrReadModel;
  readonly reason?: ManagedPrReason;
}

export interface ManagedPrConfigurationInput {
  readonly managedPrId: string;
  readonly expectedVersion: number;
  readonly context: string;
  readonly syncSourceBranchOverride: string;
}

export interface ManagedPrCloneInput {
  readonly managedPrId: string;
  readonly expectedVersion: number;
  readonly path: string;
}

export interface ManagedPrAddInput {
  readonly serverId: string;
  readonly url: string;
  readonly context?: string;
  readonly syncSourceBranchOverride?: string;
  readonly localClonePath?: string;
}

export interface ManagedPrValidationFailure {
  readonly code: string;
  readonly message: string;
  readonly nextAction: ManagedPrReasonNextAction;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasUnsafeControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      (codePoint <= 31 &&
        codePoint !== 9 &&
        codePoint !== 10 &&
        codePoint !== 13) ||
      codePoint === 127
    );
  });
}

function hasAnyControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function validateManagedPrUrl(
  value: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ManagedPrValidationFailure } {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    byteLength(value) > MAX_MANAGED_PR_URL_BYTES ||
    hasAnyControlCharacter(value)
  )
    return {
      ok: false,
      error: {
        code: "INVALID_PR_URL",
        message:
          "Enter a pull-request URL up to 2,048 bytes without control characters.",
        nextAction: "FIX_INPUT",
      },
    };
  return { ok: true, value };
}

export function validatePrIntentContext(
  value: string | undefined,
):
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: ManagedPrValidationFailure } {
  const context = value ?? "";
  if (
    typeof context !== "string" ||
    byteLength(context) > MAX_PR_INTENT_CONTEXT_BYTES ||
    hasUnsafeControlCharacter(context)
  )
    return {
      ok: false,
      error: {
        code: "INVALID_PR_CONTEXT",
        message:
          "PR Intent / Context must be at most 32 KiB and may contain only ordinary text and line breaks.",
        nextAction: "FIX_INPUT",
      },
    };
  return {
    ok: true,
    value: context.trim().length === 0 ? null : context,
  };
}

export function isValidGitBranchName(value: string): boolean {
  if (
    value.length === 0 ||
    byteLength(value) > MAX_SYNC_SOURCE_BRANCH_BYTES ||
    hasAnyControlCharacter(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value === "@" ||
    /[ ~^:?*[\]\\]/u.test(value)
  )
    return false;
  return value
    .split("/")
    .every(
      (component) =>
        component.length > 0 &&
        component !== "." &&
        component !== ".." &&
        !component.startsWith(".") &&
        !component.endsWith("."),
    );
}

export function validateSyncSourceBranchOverride(
  value: string | undefined,
):
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly error: ManagedPrValidationFailure } {
  const override = typeof value === "string" ? value : "";
  if (override.trim().length === 0) return { ok: true, value: null };
  if (
    typeof override !== "string" ||
    (override.length > 0 && !isValidGitBranchName(override))
  )
    return {
      ok: false,
      error: {
        code: "INVALID_SYNC_SOURCE_BRANCH",
        message:
          "The synchronization source must be a valid Git branch name up to 255 bytes.",
        nextAction: "FIX_INPUT",
      },
    };
  return { ok: true, value: override };
}

export function validateManagedPrPath(
  value: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ManagedPrValidationFailure } {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LOCAL_CLONE_PATH_LENGTH ||
    hasAnyControlCharacter(value)
  )
    return {
      ok: false,
      error: {
        code: "INVALID_LOCAL_PATH",
        message:
          "Choose an existing local directory with a canonical path no longer than 4,096 characters.",
        nextAction: "SELECT_CLONE",
      },
    };
  return { ok: true, value };
}

export function isManagedPrReason(value: unknown): value is ManagedPrReason {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    candidate.code.length <= 128 &&
    typeof candidate.category === "string" &&
    [
      "VALIDATION",
      "AUTHENTICATION",
      "AUTHORIZATION",
      "NOT_FOUND",
      "RATE_LIMIT",
      "NETWORK",
      "TIMEOUT",
      "CANCELLED",
      "CONFLICT",
      "LOCAL_PATH",
      "LOCAL_GIT",
      "RECOVERY",
      "UNKNOWN",
    ].includes(candidate.category) &&
    typeof candidate.what === "string" &&
    byteLength(candidate.what) <= MAX_MANAGED_PR_REASON_BYTES &&
    typeof candidate.why === "string" &&
    byteLength(candidate.why) <= MAX_MANAGED_PR_REASON_BYTES &&
    typeof candidate.nextAction === "string" &&
    [
      "FIX_INPUT",
      "REPLACE_ACCESS",
      "RETRY",
      "WAIT",
      "SELECT_CLONE",
      "ADD_WITHOUT_LOCAL_CLONE",
      "RELOAD",
      "NONE",
    ].includes(candidate.nextAction) &&
    typeof candidate.correlationId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.correlationId)
  );
}

export function isManagedPrConfigurationView(
  value: unknown,
): value is ManagedPrConfigurationView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.revisionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.revisionId) &&
    typeof candidate.revision === "number" &&
    Number.isSafeInteger(candidate.revision) &&
    candidate.revision > 0 &&
    (candidate.context === null ||
      (typeof candidate.context === "string" &&
        byteLength(candidate.context) <= MAX_PR_INTENT_CONTEXT_BYTES &&
        !hasUnsafeControlCharacter(candidate.context))) &&
    (candidate.syncSourceBranchOverride === null ||
      (typeof candidate.syncSourceBranchOverride === "string" &&
        isValidGitBranchName(candidate.syncSourceBranchOverride))) &&
    typeof candidate.contentHash === "string" &&
    /^[0-9a-f]{64}$/u.test(candidate.contentHash) &&
    ["ADD_PR", "USER_EDIT"].includes(String(candidate.source)) &&
    typeof candidate.createdAt === "string"
  );
}

function isRepositoryIdentity(
  value: unknown,
): value is GithubAnyRepositoryIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.key === "string" &&
    typeof candidate.server === "object" &&
    candidate.server !== null &&
    (candidate.available === true
      ? typeof candidate.owner === "string" &&
        typeof candidate.name === "string"
      : ["DELETED", "INACCESSIBLE", "MISSING_FROM_PAYLOAD"].includes(
          String(candidate.reason),
        ))
  );
}

export function isManagedPrReadModel(
  value: unknown,
): value is ManagedPrReadModel {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === F07_SCHEMA_VERSION &&
    typeof candidate.id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.id) &&
    typeof candidate.canonicalUrl === "string" &&
    byteLength(candidate.canonicalUrl) <= MAX_MANAGED_PR_URL_BYTES &&
    typeof candidate.pullRequestKey === "string" &&
    typeof candidate.serverId === "string" &&
    typeof candidate.owner === "string" &&
    typeof candidate.repositoryName === "string" &&
    typeof candidate.number === "number" &&
    Number.isSafeInteger(candidate.number) &&
    candidate.number > 0 &&
    ["OPEN", "CLOSED"].includes(String(candidate.state)) &&
    typeof candidate.merged === "boolean" &&
    isRepositoryIdentity(candidate.baseRepository) &&
    isRepositoryIdentity(candidate.headRepository) &&
    typeof candidate.prBaseBranch === "string" &&
    typeof candidate.prHeadBranch === "string" &&
    typeof candidate.prBaseSha === "string" &&
    typeof candidate.prHeadSha === "string" &&
    ["WATCHING", "WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"].includes(
      String(candidate.primaryState),
    ) &&
    [
      "LOCAL_CLONE_REQUIRED",
      "VALID",
      "DIRTY",
      "MISSING",
      "INVALID",
      "UNKNOWN",
    ].includes(String(candidate.localSetupStatus)) &&
    isManagedPrConfigurationView(candidate.configuration) &&
    (candidate.lastOperationReason === undefined ||
      isManagedPrReason(candidate.lastOperationReason)) &&
    typeof candidate.version === "number" &&
    Number.isSafeInteger(candidate.version) &&
    candidate.version > 0 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function isAddPrAttemptView(value: unknown): value is AddPrAttemptView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === F07_SCHEMA_VERSION &&
    typeof candidate.id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.id) &&
    typeof candidate.correlationId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate.correlationId) &&
    typeof candidate.idempotencyKey === "string" &&
    typeof candidate.canonicalPrKey === "string" &&
    typeof candidate.serverId === "string" &&
    typeof candidate.normalizedUrl === "string" &&
    [
      "PENDING",
      "SUCCEEDED",
      "CANCELLED",
      "FAILED",
      "RECOVERY_REQUIRED",
    ].includes(String(candidate.status)) &&
    (candidate.managedPrId === undefined ||
      typeof candidate.managedPrId === "string") &&
    (candidate.reason === undefined || isManagedPrReason(candidate.reason)) &&
    typeof candidate.version === "number" &&
    Number.isSafeInteger(candidate.version) &&
    candidate.version > 0 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function isManagedPrOperationView(
  value: unknown,
): value is ManagedPrOperationView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === F07_SCHEMA_VERSION &&
    [
      "ADD_PR",
      "RETRY_ADD_PR",
      "ATTACH_CLONE",
      "CLEAR_CLONE",
      "SAVE_CONFIGURATION",
    ].includes(String(candidate.kind)) &&
    [
      "PENDING",
      "SUCCEEDED",
      "CANCELLED",
      "FAILED",
      "RECOVERY_REQUIRED",
      "COMPLETED",
    ].includes(String(candidate.status)) &&
    (candidate.attempt === undefined ||
      isAddPrAttemptView(candidate.attempt)) &&
    (candidate.managedPr === undefined ||
      isManagedPrReadModel(candidate.managedPr)) &&
    (candidate.reason === undefined || isManagedPrReason(candidate.reason))
  );
}

export function isManagedPrListView(
  value: unknown,
): value is ManagedPrListView {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === F07_SCHEMA_VERSION &&
    Array.isArray(candidate.managedPrs) &&
    candidate.managedPrs.every(isManagedPrReadModel) &&
    Array.isArray(candidate.attempts) &&
    candidate.attempts.every(isAddPrAttemptView)
  );
}

export function isManagedPrCandidateListView(value: unknown): value is {
  readonly schemaVersion: 1;
  readonly managedPrId: string;
  readonly candidates: readonly ManagedPrCandidateView[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== F07_SCHEMA_VERSION ||
    typeof candidate.managedPrId !== "string" ||
    !Array.isArray(candidate.candidates)
  )
    return false;
  return candidate.candidates.every((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return false;
    const valueItem = item as Record<string, unknown>;
    return (
      valueItem.schemaVersion === F07_SCHEMA_VERSION &&
      typeof valueItem.canonicalRoot === "string" &&
      typeof valueItem.repository === "object" &&
      valueItem.repository !== null &&
      typeof valueItem.status === "string" &&
      typeof valueItem.cleanState === "string"
    );
  });
}
