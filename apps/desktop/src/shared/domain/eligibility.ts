export const F11_ELIGIBILITY_SCHEMA_VERSION = 1 as const;
export const F11_MAX_EVENT_IDENTITY_BYTES = 512;
export const F11_MAX_ACCOUNT_BYTES = 128;
export const F11_MAX_CONFIGURATION_ACCOUNTS = 256;
export const F11_MAX_EVENT_BODY_BYTES = 256 * 1024;
export const F11_MAX_CLAIM_EVENTS = 256;

export const F11_DECISIONS = [
  "ELIGIBLE",
  "DEFERRED_BY_HOLD",
  "INELIGIBLE",
] as const;
export type F11EligibilityDecision = (typeof F11_DECISIONS)[number];

export const F11_ASSOCIATION_STATES = [
  "UNASSIGNED",
  "ASSIGNED_TO_ACTIVE_BUNDLE",
  "RETAINED_DURING_HOLD",
  "HANDLED_BY_BUNDLE",
] as const;
export type F11AssociationState = (typeof F11_ASSOCIATION_STATES)[number];

export const F11_PRIMARY_STATES = [
  "WATCHING",
  "WORKING",
  "READY_FOR_REVIEW",
  "NEEDS_ATTENTION",
] as const;
export type F11PrimaryState = (typeof F11_PRIMARY_STATES)[number];

export const F11_REASON_CODES = [
  "ELIGIBLE",
  "INVALID_SCOPE",
  "UNAVAILABLE_PR_STATE",
  "UNSUPPORTED_PR_STATE",
  "ALREADY_HANDLED",
  "ALREADY_ASSIGNED",
  "PRMONITOR_AUTHORED",
  "EMPTY_EVENT",
  "BODYLESS_APPROVAL",
  "IGNORED_ACCOUNT",
  "PR_MERGED",
  "PR_CLOSED",
  "RETAINED_DURING_HOLD",
  "AUTOMATIC_OPERATION_ACTIVE",
  "NO_ELIGIBLE_EVENTS",
  "CONCURRENT_CLAIM",
  "CLAIM_NOT_FOUND",
  "CLAIM_OWNER_MISMATCH",
  "HOLD_RELEASE_REQUIRES_HUMAN",
  "EXPLICIT_REEVALUATION_REQUIRED",
  "EVENT_VERSION_ALREADY_HANDLED",
  "PERSISTENCE_UNAVAILABLE",
] as const;
export type F11ReasonCode = (typeof F11_REASON_CODES)[number];

export type F11NextAction =
  "NONE" | "RETRY" | "REVIEW" | "RE_EVALUATE" | "FIX_INPUT" | "RECONCILE";

export interface F11AutomationIdentity {
  readonly serverId: string;
  readonly login?: string;
  readonly providerId?: number;
}

export interface F11EligibilityConfiguration {
  readonly automationIdentity?: F11AutomationIdentity;
  readonly ignoredAccounts?: readonly string[];
  readonly revision?: number;
}

export interface F11EventScope {
  readonly managedPrId: string;
  readonly serverId: string;
  readonly repositoryId: string;
  readonly pullRequestNumber: number;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly remoteObjectKey: string;
  readonly eventVersionId: string;
  readonly semanticHash: string;
}

export type F11RemotePrState = "OPEN" | "CLOSED" | "MERGED" | "UNAVAILABLE";

export interface F11EligibilityInput extends F11EventScope {
  readonly authorLogin?: string;
  readonly authorProviderId?: number;
  readonly body?: string;
  readonly reviewState?: string;
  readonly currentPrState: F11RemotePrState;
  readonly primaryState: F11PrimaryState;
  readonly associationState?: F11AssociationState;
  readonly holdActive?: boolean;
  readonly configuration: F11EligibilityConfiguration;
}

export interface F11Reason {
  readonly code: F11ReasonCode;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F11NextAction;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface F11EligibilityResult {
  readonly schemaVersion: typeof F11_ELIGIBILITY_SCHEMA_VERSION;
  readonly managedPrId: string;
  readonly eventVersionId: string;
  readonly decision: F11EligibilityDecision;
  readonly reason: F11Reason;
  readonly correlationId: string;
  readonly inputSnapshot: F11InputSnapshot;
  readonly configurationSnapshot: F11ConfigurationSnapshot;
}

/** Safe, bounded evidence persisted by F11. It intentionally excludes body text and raw remote payload. */
export interface F11InputSnapshot extends F11EventScope {
  readonly authorLogin?: string;
  readonly authorProviderId?: number;
  readonly hasBody: boolean;
  readonly reviewState?: string;
  readonly currentPrState: F11RemotePrState;
  readonly primaryState: F11PrimaryState;
  readonly associationState: F11AssociationState;
  readonly holdActive: boolean;
}

export interface F11ConfigurationSnapshot {
  readonly automationIdentity: {
    readonly serverId: string;
    readonly login?: string;
    readonly providerId?: number;
  };
  readonly ignoredAccounts: readonly string[];
  readonly revision?: number;
}

export interface F11NormalizedEvaluationInput {
  readonly input: F11EligibilityInput;
  readonly correlationId: string;
  readonly now: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,511}$/u;
const SAFE_ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_SHAPE =
  /(?:gh[pousr]_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]+|authorization\s*[:=]|(?:api[_-]?key|access[_-]?token|token|password|secret)\s*[:=])/iu;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizedAccount(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function validIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    byteLength(value) <= F11_MAX_EVENT_IDENTITY_BYTES &&
    SAFE_ID.test(value) &&
    !SECRET_SHAPE.test(value)
  );
}

function reason(
  code: F11ReasonCode,
  what: string,
  why: string,
  nextAction: F11NextAction,
  details: Readonly<Record<string, string | number | boolean>> = {},
): F11Reason {
  return { code, what, why, nextAction, details };
}

function invalidScope(message: string): F11Reason {
  return reason(
    "INVALID_SCOPE",
    "The feedback version cannot be admitted safely.",
    message,
    "REVIEW",
  );
}

function configurationSnapshot(
  configuration: F11EligibilityConfiguration,
): F11ConfigurationSnapshot | undefined {
  const identity = configuration.automationIdentity;
  if (identity === undefined || identity.serverId.length === 0)
    return undefined;
  const login =
    identity.login === undefined
      ? undefined
      : normalizedAccount(identity.login);
  if (
    !validIdentifier(identity.serverId) ||
    (login !== undefined &&
      (!SAFE_ACCOUNT.test(login) ||
        byteLength(login) > F11_MAX_ACCOUNT_BYTES)) ||
    (identity.providerId !== undefined &&
      (!Number.isSafeInteger(identity.providerId) || identity.providerId < 0))
  )
    return undefined;
  const ignoredAccounts = (configuration.ignoredAccounts ?? []).map(
    normalizedAccount,
  );
  if (
    ignoredAccounts.length > F11_MAX_CONFIGURATION_ACCOUNTS ||
    ignoredAccounts.some(
      (account) =>
        !SAFE_ACCOUNT.test(account) ||
        byteLength(account) > F11_MAX_ACCOUNT_BYTES,
    )
  )
    return undefined;
  if (
    configuration.revision !== undefined &&
    (!Number.isSafeInteger(configuration.revision) ||
      configuration.revision < 1)
  )
    return undefined;
  return {
    automationIdentity: {
      serverId: identity.serverId,
      ...(login === undefined ? {} : { login }),
      ...(identity.providerId === undefined
        ? {}
        : { providerId: identity.providerId }),
    },
    ignoredAccounts: [...new Set(ignoredAccounts)].sort(),
    ...(configuration.revision === undefined
      ? {}
      : { revision: configuration.revision }),
  };
}

function snapshot(input: F11EligibilityInput): F11InputSnapshot | undefined {
  const associationState = input.associationState ?? "UNASSIGNED";
  if (
    !F11_ASSOCIATION_STATES.includes(associationState) ||
    !F11_PRIMARY_STATES.includes(input.primaryState) ||
    !["OPEN", "CLOSED", "MERGED", "UNAVAILABLE"].includes(
      input.currentPrState,
    ) ||
    (input.authorLogin !== undefined &&
      (!SAFE_ACCOUNT.test(normalizedAccount(input.authorLogin)) ||
        byteLength(input.authorLogin) > F11_MAX_ACCOUNT_BYTES)) ||
    (input.authorProviderId !== undefined &&
      (!Number.isSafeInteger(input.authorProviderId) ||
        input.authorProviderId < 0)) ||
    (input.reviewState !== undefined &&
      (input.reviewState.length > 128 || SECRET_SHAPE.test(input.reviewState)))
  )
    return undefined;
  return {
    managedPrId: input.managedPrId,
    serverId: input.serverId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    remoteObjectKey: input.remoteObjectKey,
    eventVersionId: input.eventVersionId,
    semanticHash: input.semanticHash,
    ...(input.authorLogin === undefined
      ? {}
      : { authorLogin: normalizedAccount(input.authorLogin) }),
    ...(input.authorProviderId === undefined
      ? {}
      : { authorProviderId: input.authorProviderId }),
    hasBody: input.body !== undefined && input.body.trim().length > 0,
    ...(input.reviewState === undefined
      ? {}
      : { reviewState: input.reviewState }),
    currentPrState: input.currentPrState,
    primaryState: input.primaryState,
    associationState,
    holdActive: input.holdActive === true || input.primaryState !== "WATCHING",
  };
}

function hasBody(input: F11EligibilityInput): boolean {
  return input.body !== undefined && input.body.trim().length > 0;
}

function isBodylessApproval(input: F11EligibilityInput): boolean {
  return (
    input.sourceKind.toUpperCase() === "REVIEW" &&
    input.reviewState?.toUpperCase() === "APPROVED" &&
    !hasBody(input)
  );
}

function correlationFor(input: F11EventScope, provided?: string): string {
  if (provided !== undefined && SAFE_ID.test(provided)) return provided;
  return `f11-${hashText(`${input.managedPrId}:${input.eventVersionId}`)}`;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Applies the F11 rule order. The function is deliberately side-effect free;
 * persistence, claims, and hold transitions belong to the main-process service.
 */
export function evaluateF11Eligibility(
  normalized: F11NormalizedEvaluationInput,
): F11EligibilityResult {
  const input = normalized.input;
  const correlationId = correlationFor(input, normalized.correlationId);
  const safeConfig = configurationSnapshot(input.configuration);
  const safeInput = snapshot(input);
  const base = {
    schemaVersion: F11_ELIGIBILITY_SCHEMA_VERSION,
    managedPrId: input.managedPrId,
    eventVersionId: input.eventVersionId,
    correlationId,
    inputSnapshot:
      safeInput ??
      ({
        managedPrId: input.managedPrId,
        serverId: input.serverId,
        repositoryId: input.repositoryId,
        pullRequestNumber: input.pullRequestNumber,
        sourceKind: "INVALID",
        sourceId: "INVALID",
        remoteObjectKey: "INVALID",
        eventVersionId: input.eventVersionId,
        semanticHash: "INVALID",
        hasBody: false,
        currentPrState: "UNAVAILABLE" as const,
        primaryState: "WATCHING" as const,
        associationState: "UNASSIGNED" as const,
        holdActive: false,
      } satisfies F11InputSnapshot),
    configurationSnapshot: safeConfig ?? {
      automationIdentity: { serverId: "INVALID" },
      ignoredAccounts: [],
    },
  };
  const invalid = (why: string): F11EligibilityResult => ({
    ...base,
    decision: "INELIGIBLE",
    reason: invalidScope(why),
  });

  if (
    !validIdentifier(input.managedPrId) ||
    !validIdentifier(input.serverId) ||
    !validIdentifier(input.repositoryId) ||
    !validIdentifier(input.sourceKind) ||
    !validIdentifier(input.sourceId) ||
    !validIdentifier(input.remoteObjectKey) ||
    !validIdentifier(input.eventVersionId) ||
    !/^[a-f0-9]{16,128}$/u.test(input.semanticHash) ||
    !Number.isSafeInteger(input.pullRequestNumber) ||
    input.pullRequestNumber < 1 ||
    safeConfig === undefined ||
    safeInput === undefined
  )
    return invalid(
      "The server, repository, pull-request, source, and semantic-version scope must be complete and bounded.",
    );
  if (
    input.body !== undefined &&
    (byteLength(input.body) > F11_MAX_EVENT_BODY_BYTES ||
      SECRET_SHAPE.test(input.body))
  )
    return invalid(
      "The candidate contains oversized or secret-shaped content and was rejected before persistence.",
    );
  if (input.currentPrState === "UNAVAILABLE")
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "UNAVAILABLE_PR_STATE",
        "The current pull-request state is unavailable.",
        "Eligibility cannot be granted without authoritative remote state.",
        "RETRY",
      ),
    };
  if (input.associationState === "HANDLED_BY_BUNDLE")
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "ALREADY_HANDLED",
        "This immutable feedback version was already handled.",
        "Handled versions remain in history and cannot re-enter ordinary automatic analysis.",
        "NONE",
      ),
    };
  if (input.associationState === "ASSIGNED_TO_ACTIVE_BUNDLE")
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "ALREADY_ASSIGNED",
        "This immutable feedback version is already assigned.",
        "One version cannot belong to two active Review Bundles.",
        "REVIEW",
      ),
    };
  const automation = safeConfig.automationIdentity;
  if (
    automation.serverId === input.serverId &&
    ((automation.login !== undefined &&
      input.authorLogin !== undefined &&
      normalizedAccount(input.authorLogin) === automation.login) ||
      (automation.providerId !== undefined &&
        input.authorProviderId !== undefined &&
        automation.providerId === input.authorProviderId))
  )
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "PRMONITOR_AUTHORED",
        "This feedback was authored by the configured PRMonitor identity.",
        "Automation-authored feedback must not trigger another automatic review.",
        "NONE",
      ),
    };
  if (isBodylessApproval(input))
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "BODYLESS_APPROVAL",
        "This approval has no semantic body.",
        "A bodyless approval is recorded as history but does not contain review input for automatic analysis.",
        "NONE",
      ),
    };
  if (!hasBody(input))
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "EMPTY_EVENT",
        "This feedback version has no semantic content.",
        "Empty feedback is not sent to automatic analysis.",
        "NONE",
      ),
    };
  if (
    safeConfig.ignoredAccounts.includes(
      normalizedAccount(input.authorLogin ?? ""),
    )
  )
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "IGNORED_ACCOUNT",
        "This feedback author is configured to be ignored.",
        "Ignored-account matching is exact and server-scoped.",
        "NONE",
      ),
    };
  if (input.currentPrState === "MERGED")
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "PR_MERGED",
        "The pull request is merged.",
        "Merged pull requests do not receive automatic review work.",
        "NONE",
      ),
    };
  if (input.currentPrState === "CLOSED")
    return {
      ...base,
      decision: "INELIGIBLE",
      reason: reason(
        "PR_CLOSED",
        "The pull request is closed.",
        "Closed pull requests do not receive automatic review work.",
        "NONE",
      ),
    };
  if (safeInput.holdActive)
    return {
      ...base,
      decision: "DEFERRED_BY_HOLD",
      reason: reason(
        "RETAINED_DURING_HOLD",
        "New feedback was retained while this pull request is on review hold.",
        "Held feedback cannot mutate or replace the active Review Bundle.",
        "REVIEW",
      ),
    };
  return {
    ...base,
    decision: "ELIGIBLE",
    reason: reason(
      "ELIGIBLE",
      "This immutable feedback version is eligible for automatic review.",
      "The explicit identity, content, account, pull-request, and hold checks passed.",
      "NONE",
    ),
  };
}

export function f11ConfigurationFingerprint(
  configuration: F11ConfigurationSnapshot,
): string {
  return hashText(JSON.stringify(configuration));
}
