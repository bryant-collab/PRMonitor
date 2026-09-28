import type {
  GithubAnyRepositoryIdentity,
  GithubBranchRefIdentity,
  GithubPullRequestState,
  GithubRemoteServerIdentity,
  GithubRepositoryIdentity,
} from "./github-rest";
import type { ManagedPrReadModel } from "./managed-pr";
import type { ManagedPrInboxReadModel } from "./inbox";
import type { F13SafeReason } from "./f13-contracts";

export const F24_SCHEMA_VERSION = 1 as const;
export const F24_BOUNDS_REVISION = "f24-bounds-v1" as const;
export const F24_MAX_SELECTED_MANAGED_PRS = 250 as const;
export const F24_MAX_REASON_BYTES = 2_048 as const;
export const F24_MAX_CORRELATION_IDS = 8 as const;
export const F24_MAX_INTENTS = 250 as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA = /^[0-9a-f]{7,128}$/iu;

export type F24SourceProvenance = "OVERRIDE" | "PR_BASE_BRANCH";
export type F24EligibilityStatus = "ELIGIBLE" | "INELIGIBLE";
export type F24SelectionCommand = "TOGGLE" | "CLEAR" | "SELECT_ALL";
export type F24HandoffStatus =
  "PENDING" | "ACKNOWLEDGED" | "FAILED" | "UNCERTAIN";

export type F24ReasonCategory =
  | "ELIGIBLE"
  | "SELECTION_STALE"
  | "UNKNOWN_MANAGED_PR"
  | "LIMIT"
  | "CONFIGURATION_INVALID"
  | "SOURCE_REPOSITORY_UNAVAILABLE"
  | "DESTINATION_REPOSITORY_UNAVAILABLE"
  | "SOURCE_REF_UNAVAILABLE"
  | "DESTINATION_REF_UNAVAILABLE"
  | "REMOTE_READ_FAILED"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "CANCELLED"
  | "IDENTITY_MISMATCH"
  | "SHA_MISMATCH"
  | "PR_CLOSED"
  | "PR_MERGED"
  | "F13_NOT_READY"
  | "ACTIVE_OPERATION"
  | "NO_ELIGIBLE"
  | "STALE_SUMMARY"
  | "PERSISTENCE"
  | "HANDOFF";

export type F24NextAction =
  | "RETRY_RESOLUTION"
  | "OPEN_PR_SETTINGS"
  | "SELECT_CLONE"
  | "WAIT"
  | "CLEAR_SELECTION"
  | "RECONCILE"
  | "NONE";

export interface F24Reason {
  readonly code: string;
  readonly category: F24ReasonCategory;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F24NextAction;
  readonly retryable: boolean;
  readonly correlationId: string;
}

export interface F24SelectionSession {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly kind: "synchronization-selection";
  readonly version: number;
  readonly projectionRevision: number;
  readonly selectedManagedPrIds: readonly string[];
  readonly selectedCount: number;
  readonly actionLabel: "Synchronize PR Branch" | "Synchronize PR Branches";
  readonly canOpen: boolean;
  readonly updatedAt: string;
}

export interface F24SelectionCommandInput {
  readonly command: F24SelectionCommand;
  readonly projectionRevision: number;
  readonly managedPrId?: string;
}

export interface F24F16ConfigurationReference {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly settingsRevision: number;
  readonly boundsRevision: string;
  readonly worktreeRootRevision?: number;
}

export interface F24F13ReadinessEvidence {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly ready: boolean;
  readonly operationId: string;
  readonly rootRevision: number;
  readonly evidenceRevision: string;
  readonly developerCloneRepositoryKey?: string;
  readonly reason?: F24Reason;
}

export interface F24RemoteObservationEvidence {
  readonly correlationId: string;
  readonly status?: number;
  readonly outcome: "UPDATED" | "NOT_MODIFIED" | "FAILED" | "UNCERTAIN";
}

export interface F24ResolutionRow {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly managedPrId: string;
  readonly configurationRevisionId: string;
  readonly configurationRevision: number;
  readonly inboxProjectionRevision: number;
  readonly sourceProvenance: F24SourceProvenance;
  readonly syncSourceBranch: string;
  readonly prHeadBranch: string;
  readonly sourceRepository: GithubAnyRepositoryIdentity;
  readonly destinationRepository: GithubAnyRepositoryIdentity;
  readonly sourceRef?: GithubBranchRefIdentity;
  readonly destinationRef?: GithubBranchRefIdentity;
  readonly currentPrState?: GithubPullRequestState;
  readonly currentPrMerged?: boolean;
  readonly syncSourceSha?: string;
  readonly prHeadSha?: string;
  readonly storedPrBaseSha: string;
  readonly storedPrHeadSha: string;
  readonly observedAt: string;
  readonly observationRevision: string;
  readonly observations: readonly F24RemoteObservationEvidence[];
  readonly f13Readiness?: F24F13ReadinessEvidence;
  readonly eligibility: F24EligibilityStatus;
  readonly reason: F24Reason;
  readonly operationId?: string;
}

export interface F24SynchronizationConfirmation {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly kind: "synchronization-confirmation";
  readonly selectionSessionVersion: number;
  readonly inboxProjectionRevision: number;
  readonly resolutionRevision: string;
  readonly generatedAt: string;
  readonly selectedCount: number;
  readonly eligibleCount: number;
  readonly ineligibleCount: number;
  readonly rows: readonly F24ResolutionRow[];
  readonly confirmEnabled: boolean;
  readonly prepareOnly: true;
  readonly prepareOnlyMessage: string;
  readonly f16Configuration?: F24F16ConfigurationReference;
}

export interface F24PreparationIntentSnapshot {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly scopeKey: string;
  readonly resolutionRevision: string;
  readonly selectionSessionVersion: number;
  readonly inboxProjectionRevision: number;
  readonly selectedManagedPrIds: readonly string[];
  readonly rows: readonly F24ResolutionRow[];
  readonly eligibleRows: readonly F24ResolutionRow[];
  readonly ineligibleRows: readonly F24ResolutionRow[];
  readonly f16Configuration?: F24F16ConfigurationReference;
  readonly actor: "USER";
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface F24PreparationAuthorization {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly kind: "SynchronizationPreparationAuthorization";
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly resolutionRevision: string;
  readonly createdAt: string;
  readonly eligible: readonly F24ResolutionRow[];
  readonly skippedManagedPrIds: readonly string[];
  readonly preparationOnly: true;
  readonly capabilities: {
    readonly prepareWorktree: true;
    readonly commit: false;
    readonly push: false;
    readonly githubWrite: false;
    readonly aiProvider: false;
    readonly publication: false;
    readonly conversationResolution: false;
  };
}

export interface F24HandoffRecord {
  readonly status: F24HandoffStatus;
  readonly authorizationId: string;
  readonly reason?: F24Reason;
  readonly updatedAt: string;
}

export interface F24PreparationIntent {
  readonly schemaVersion: typeof F24_SCHEMA_VERSION;
  readonly kind: "synchronization-preparation-intent";
  readonly snapshot: F24PreparationIntentSnapshot;
  readonly handoff: F24HandoffRecord;
  readonly version: number;
  readonly updatedAt: string;
}

export interface F24PreparationHandoffResult {
  readonly status: "ACKNOWLEDGED" | "FAILED" | "UNCERTAIN";
  readonly authorizationId?: string;
  readonly reason?: F24Reason;
}

export function f24SafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

export function f24SafeSha(value: unknown): value is string {
  return typeof value === "string" && SHA.test(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedText(
  value: string,
  maximum: number = F24_MAX_REASON_BYTES,
): string {
  let result = "";
  for (const character of value) {
    if (byteLength(result + character) > maximum) break;
    result += character;
  }
  return result;
}

function safeReasonText(value: string, label: string): string {
  const result = boundedText(value);
  if (
    result.length === 0 ||
    [...result].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  )
    throw new TypeError(`F24_${label}_INVALID`);
  return result;
}

export function f24Reason(input: {
  readonly code: string;
  readonly category: F24ReasonCategory;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F24NextAction;
  readonly retryable?: boolean;
  readonly correlationId: string;
}): F24Reason {
  if (!f24SafeIdentifier(input.correlationId))
    throw new TypeError("F24_CORRELATION_INVALID");
  return {
    code: safeReasonText(input.code, "REASON_CODE"),
    category: input.category,
    what: safeReasonText(input.what, "REASON_WHAT"),
    why: safeReasonText(input.why, "REASON_WHY"),
    nextAction: input.nextAction,
    retryable: input.retryable ?? false,
    correlationId: input.correlationId,
  };
}

export function f24ActionLabel(
  selectedCount: number,
): F24SelectionSession["actionLabel"] {
  return selectedCount === 1
    ? "Synchronize PR Branch"
    : "Synchronize PR Branches";
}

function projectionIds(projection: ManagedPrInboxReadModel): readonly string[] {
  return projection.cards.map((card) => card.id);
}

function validateProjection(projection: ManagedPrInboxReadModel): void {
  if (
    !Number.isSafeInteger(projection.version) ||
    projection.version < 1 ||
    projection.cards.length > F24_MAX_SELECTED_MANAGED_PRS
  )
    throw new TypeError("F24_PROJECTION_LIMIT_EXCEEDED");
  const ids = new Set<string>();
  for (const id of projectionIds(projection)) {
    if (!f24SafeIdentifier(id) || ids.has(id))
      throw new TypeError("F24_PROJECTION_IDENTITY_INVALID");
    ids.add(id);
  }
}

export function createF24SelectionSession(input: {
  readonly projection: ManagedPrInboxReadModel;
  readonly sessionId?: string;
  readonly now: string;
}): F24SelectionSession {
  validateProjection(input.projection);
  safeReasonText(input.now, "TIMESTAMP");
  return {
    schemaVersion: F24_SCHEMA_VERSION,
    kind: "synchronization-selection",
    version: 1,
    projectionRevision: input.projection.version,
    selectedManagedPrIds: [],
    selectedCount: 0,
    actionLabel: f24ActionLabel(0),
    canOpen: false,
    updatedAt: input.now,
  };
}

export function applyF24SelectionCommand(
  session: F24SelectionSession,
  projection: ManagedPrInboxReadModel,
  input: F24SelectionCommandInput,
  now: string,
): F24SelectionSession {
  validateProjection(projection);
  if (
    input.projectionRevision !== projection.version ||
    input.projectionRevision !== session.projectionRevision
  )
    throw new TypeError("F24_SELECTION_PROJECTION_STALE");
  if (
    input.command === "TOGGLE" &&
    (input.managedPrId === undefined ||
      !projectionIds(projection).includes(input.managedPrId))
  )
    throw new TypeError("F24_SELECTION_IDENTITY_UNKNOWN");
  const selected = new Set(session.selectedManagedPrIds);
  if (input.command === "TOGGLE" && input.managedPrId !== undefined) {
    if (selected.has(input.managedPrId)) selected.delete(input.managedPrId);
    else selected.add(input.managedPrId);
  } else if (input.command === "CLEAR") selected.clear();
  else if (input.command === "SELECT_ALL")
    for (const id of projectionIds(projection)) selected.add(id);
  const selectedManagedPrIds = projectionIds(projection).filter((id) =>
    selected.has(id),
  );
  return {
    ...session,
    version: session.version + 1,
    selectedManagedPrIds,
    selectedCount: selectedManagedPrIds.length,
    actionLabel: f24ActionLabel(selectedManagedPrIds.length),
    canOpen: selectedManagedPrIds.length > 0,
    updatedAt: now,
  };
}

export function resolveF24EffectiveSource(input: {
  readonly syncSourceBranchOverride: string | null;
  readonly prBaseBranch: string;
}):
  | {
      readonly ok: true;
      readonly branch: string;
      readonly provenance: F24SourceProvenance;
    }
  | { readonly ok: false; readonly reasonCode: "CONFIGURATION_INVALID" } {
  const override = input.syncSourceBranchOverride?.trim() ?? "";
  const branch = override.length > 0 ? override : input.prBaseBranch;
  if (branch.length === 0 || byteLength(branch) > 512)
    return { ok: false, reasonCode: "CONFIGURATION_INVALID" };
  if (
    branch.includes("\u0000") ||
    branch.includes("\r") ||
    branch.includes("\n") ||
    branch.includes("..") ||
    branch.includes("\\") ||
    branch.includes("@{") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    /[ ~^:?*[\]]/u.test(branch)
  )
    return { ok: false, reasonCode: "CONFIGURATION_INVALID" };
  return {
    ok: true,
    branch,
    provenance: override.length > 0 ? "OVERRIDE" : "PR_BASE_BRANCH",
  };
}

export function f24BranchRefIdentity(
  repository: GithubRepositoryIdentity,
  name: string,
): GithubBranchRefIdentity {
  return {
    schemaVersion: 1,
    server: repository.server,
    repository,
    name,
    key: `${repository.key}:refs/heads/${name}`,
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}

/** A deterministic bounded fingerprint for revisions and idempotency keys. */
export function f24Fingerprint(value: unknown): string {
  const input = canonicalize(value);
  const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35];
  const digest = seeds
    .map((seed, seedIndex) => {
      let hash = seed >>> 0;
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index) + seedIndex;
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash = (hash ^ (hash >>> 13)) >>> 0;
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
  return `f24-${digest}`;
}

export function f24EligibleReason(correlationId: string): F24Reason {
  return f24Reason({
    code: "ELIGIBLE",
    category: "ELIGIBLE",
    what: "Ready for synchronization preparation.",
    why: "The pull request is open and every explicit repository, ref, SHA, and worktree-readiness check passed.",
    nextAction: "NONE",
    correlationId,
  });
}

export function f24PrepareOnlyMessage(): string {
  return "Confirming authorizes preparation and review only. It does not approve a merge commit, push, GitHub response, AI work, or publication.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeText(
  value: unknown,
  maximum: number = F24_MAX_REASON_BYTES,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= maximum &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

function isReason(value: unknown): value is F24Reason {
  if (!isRecord(value)) return false;
  return (
    f24SafeIdentifier(value.code) &&
    typeof value.category === "string" &&
    isSafeText(value.what) &&
    isSafeText(value.why) &&
    typeof value.nextAction === "string" &&
    typeof value.retryable === "boolean" &&
    f24SafeIdentifier(value.correlationId)
  );
}

function isRemoteServer(value: unknown): value is GithubRemoteServerIdentity {
  if (!isRecord(value)) return false;
  return (
    (value.kind === "GITHUB_COM" || value.kind === "GHES") &&
    isSafeText(value.webOrigin, 2_048) &&
    isSafeText(value.apiBaseUrl, 2_048) &&
    isSafeText(value.host, 256) &&
    f24SafeIdentifier(value.serverKey)
  );
}

function isRepository(value: unknown): value is GithubAnyRepositoryIdentity {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return (
    isRemoteServer(value.server) &&
    isSafeText(value.key, 512) &&
    typeof value.available === "boolean" &&
    (value.available === true
      ? isSafeText(value.owner, 256) && isSafeText(value.name, 256)
      : typeof value.reason === "string")
  );
}

function isBranchRef(value: unknown): value is GithubBranchRefIdentity {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isRemoteServer(value.server) &&
    isRepository(value.repository) &&
    value.repository.available === true &&
    isSafeText(value.name, 512) &&
    isSafeText(value.key, 1_024)
  );
}

function isF16Reference(value: unknown): value is F24F16ConfigurationReference {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    typeof value.settingsRevision === "number" &&
    Number.isSafeInteger(value.settingsRevision) &&
    value.settingsRevision >= 0 &&
    f24SafeIdentifier(value.boundsRevision) &&
    (value.worktreeRootRevision === undefined ||
      (typeof value.worktreeRootRevision === "number" &&
        Number.isSafeInteger(value.worktreeRootRevision) &&
        value.worktreeRootRevision >= 0))
  );
}

function isF13Evidence(value: unknown): value is F24F13ReadinessEvidence {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    typeof value.ready === "boolean" &&
    f24SafeIdentifier(value.operationId) &&
    typeof value.rootRevision === "number" &&
    Number.isSafeInteger(value.rootRevision) &&
    value.rootRevision >= 0 &&
    f24SafeIdentifier(value.evidenceRevision) &&
    (value.developerCloneRepositoryKey === undefined ||
      isSafeText(value.developerCloneRepositoryKey, 512)) &&
    (value.reason === undefined || isReason(value.reason))
  );
}

function isResolutionRow(value: unknown): value is F24ResolutionRow {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    f24SafeIdentifier(value.managedPrId) &&
    f24SafeIdentifier(value.configurationRevisionId) &&
    Number.isSafeInteger(value.configurationRevision) &&
    Number.isSafeInteger(value.inboxProjectionRevision) &&
    (value.sourceProvenance === "OVERRIDE" ||
      value.sourceProvenance === "PR_BASE_BRANCH") &&
    isSafeText(value.syncSourceBranch, 512) &&
    isSafeText(value.prHeadBranch, 512) &&
    isRepository(value.sourceRepository) &&
    isRepository(value.destinationRepository) &&
    f24SafeSha(value.storedPrBaseSha) &&
    f24SafeSha(value.storedPrHeadSha) &&
    isSafeText(value.observedAt, 64) &&
    f24SafeIdentifier(value.observationRevision) &&
    (value.sourceRef === undefined || isBranchRef(value.sourceRef)) &&
    (value.destinationRef === undefined || isBranchRef(value.destinationRef)) &&
    (value.currentPrState === undefined ||
      value.currentPrState === "OPEN" ||
      value.currentPrState === "CLOSED") &&
    (value.currentPrMerged === undefined ||
      typeof value.currentPrMerged === "boolean") &&
    (value.syncSourceSha === undefined || f24SafeSha(value.syncSourceSha)) &&
    (value.prHeadSha === undefined || f24SafeSha(value.prHeadSha)) &&
    (value.f13Readiness === undefined || isF13Evidence(value.f13Readiness)) &&
    (value.operationId === undefined || f24SafeIdentifier(value.operationId)) &&
    Array.isArray(value.observations) &&
    value.observations.length <= F24_MAX_CORRELATION_IDS &&
    value.observations.every(
      (observation) =>
        isRecord(observation) &&
        f24SafeIdentifier(observation.correlationId) &&
        ["UPDATED", "NOT_MODIFIED", "FAILED", "UNCERTAIN"].includes(
          String(observation.outcome),
        ),
    ) &&
    (value.eligibility === "ELIGIBLE" || value.eligibility === "INELIGIBLE") &&
    isReason(value.reason)
  );
}

export function isF24SelectionSession(
  value: unknown,
): value is F24SelectionSession {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    value.kind === "synchronization-selection" &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    value.version >= 1 &&
    typeof value.projectionRevision === "number" &&
    Number.isSafeInteger(value.projectionRevision) &&
    value.projectionRevision >= 0 &&
    Array.isArray(value.selectedManagedPrIds) &&
    value.selectedManagedPrIds.length <= F24_MAX_SELECTED_MANAGED_PRS &&
    value.selectedManagedPrIds.every((id) => f24SafeIdentifier(id)) &&
    value.selectedCount === value.selectedManagedPrIds.length &&
    (value.actionLabel === "Synchronize PR Branch" ||
      value.actionLabel === "Synchronize PR Branches") &&
    typeof value.canOpen === "boolean" &&
    isSafeText(value.updatedAt, 64)
  );
}

export function isF24Confirmation(
  value: unknown,
): value is F24SynchronizationConfirmation {
  if (!isRecord(value)) return false;
  const eligibleCount = value.eligibleCount;
  const ineligibleCount = value.ineligibleCount;
  if (
    typeof eligibleCount !== "number" ||
    typeof ineligibleCount !== "number" ||
    !Number.isSafeInteger(eligibleCount) ||
    !Number.isSafeInteger(ineligibleCount)
  )
    return false;
  const selectedCount = value.selectedCount;
  if (
    typeof selectedCount !== "number" ||
    !Number.isSafeInteger(selectedCount) ||
    selectedCount < 0
  )
    return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    value.kind === "synchronization-confirmation" &&
    f24SafeIdentifier(value.resolutionRevision) &&
    Number.isSafeInteger(value.selectionSessionVersion) &&
    Number.isSafeInteger(value.inboxProjectionRevision) &&
    isSafeText(value.generatedAt, 64) &&
    Array.isArray(value.rows) &&
    value.rows.length === selectedCount &&
    value.rows.every(isResolutionRow) &&
    eligibleCount >= 0 &&
    ineligibleCount >= 0 &&
    eligibleCount + ineligibleCount === selectedCount &&
    typeof value.confirmEnabled === "boolean" &&
    value.prepareOnly === true &&
    isSafeText(value.prepareOnlyMessage, 4_096) &&
    (value.f16Configuration === undefined ||
      isF16Reference(value.f16Configuration))
  );
}

export function isF24PreparationAuthorization(
  value: unknown,
): value is F24PreparationAuthorization {
  if (!isRecord(value) || !isRecord(value.capabilities)) return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    value.kind === "SynchronizationPreparationAuthorization" &&
    f24SafeIdentifier(value.intentId) &&
    f24SafeIdentifier(value.idempotencyKey) &&
    f24SafeIdentifier(value.resolutionRevision) &&
    isSafeText(value.createdAt, 64) &&
    Array.isArray(value.eligible) &&
    value.eligible.every(isResolutionRow) &&
    Array.isArray(value.skippedManagedPrIds) &&
    value.skippedManagedPrIds.every((id) => f24SafeIdentifier(id)) &&
    value.preparationOnly === true &&
    value.capabilities.prepareWorktree === true &&
    value.capabilities.commit === false &&
    value.capabilities.push === false &&
    value.capabilities.githubWrite === false &&
    value.capabilities.aiProvider === false &&
    value.capabilities.publication === false &&
    value.capabilities.conversationResolution === false
  );
}

export function isF24PreparationIntent(
  value: unknown,
): value is F24PreparationIntent {
  if (!isRecord(value) || !isRecord(value.snapshot) || !isRecord(value.handoff))
    return false;
  const selectedManagedPrIds = value.snapshot.selectedManagedPrIds;
  const rows = value.snapshot.rows;
  const eligibleRows = value.snapshot.eligibleRows;
  const ineligibleRows = value.snapshot.ineligibleRows;
  if (
    !Array.isArray(selectedManagedPrIds) ||
    !Array.isArray(rows) ||
    !Array.isArray(eligibleRows) ||
    !Array.isArray(ineligibleRows) ||
    selectedManagedPrIds.length > F24_MAX_SELECTED_MANAGED_PRS ||
    selectedManagedPrIds.length !== rows.length ||
    rows.length !== eligibleRows.length + ineligibleRows.length
  )
    return false;
  return (
    value.schemaVersion === F24_SCHEMA_VERSION &&
    value.kind === "synchronization-preparation-intent" &&
    f24SafeIdentifier(value.snapshot.intentId) &&
    f24SafeIdentifier(value.snapshot.idempotencyKey) &&
    f24SafeIdentifier(value.snapshot.scopeKey) &&
    f24SafeIdentifier(value.snapshot.resolutionRevision) &&
    selectedManagedPrIds.every((id) => f24SafeIdentifier(id)) &&
    rows.every(isResolutionRow) &&
    eligibleRows.every(isResolutionRow) &&
    ineligibleRows.every(isResolutionRow) &&
    (value.snapshot.f16Configuration === undefined ||
      isF16Reference(value.snapshot.f16Configuration)) &&
    f24SafeIdentifier(value.snapshot.correlationId) &&
    isSafeText(value.snapshot.createdAt, 64) &&
    ["PENDING", "ACKNOWLEDGED", "FAILED", "UNCERTAIN"].includes(
      String(value.handoff.status),
    ) &&
    f24SafeIdentifier(value.handoff.authorizationId) &&
    isSafeText(value.handoff.updatedAt, 64) &&
    Number.isSafeInteger(value.version) &&
    isSafeText(value.updatedAt, 64)
  );
}

export function f24RepositoryDisplayKey(
  repository: GithubAnyRepositoryIdentity,
): string {
  return repository.key;
}

export function repositoryForF13(repository: GithubRepositoryIdentity): {
  readonly serverId: string;
  readonly owner: string;
  readonly name: string;
  readonly key: string;
} {
  return {
    serverId: repository.server.serverKey,
    owner: repository.owner,
    name: repository.name,
    key: repository.key,
  };
}

export type F24ManagedPr = ManagedPrReadModel;
export type F24InboxProjection = ManagedPrInboxReadModel;
export type F24F13Reason = F13SafeReason;
export type F24ServerIdentity = GithubRemoteServerIdentity;
