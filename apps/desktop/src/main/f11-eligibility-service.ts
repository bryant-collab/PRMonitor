import { createHash } from "node:crypto";
import type {
  GithubFeedbackRecord,
  GithubRepositoryIdentity,
} from "../shared/github-rest";
import {
  evaluateF11Eligibility,
  type F11EligibilityConfiguration,
  type F11EligibilityInput,
  type F11EligibilityResult,
  type F11PrimaryState,
  type F11Reason,
  type F11RemotePrState,
} from "../shared/domain/eligibility";
import type {
  F11PersistenceRepositories,
  F11AutomaticClaimRecord,
  F11ClaimResult,
  F11CompletionResult,
  F11EligibilityDecisionRecord,
  F11EventAssociationRecord,
  F11HoldRecord,
  F11ReevaluationTransferInput,
  F11ReevaluationTransferResult,
  F11ReevaluationRollbackInput,
  F11ReevaluationRollbackResult,
} from "./persistence/f11-repositories";
import type { PersistenceClock } from "./persistence/types";
import type { ActivityWriter } from "./activity-service";

export interface F11ObservedVersionInput {
  readonly managedPrId: string;
  readonly eventVersionId: string;
  readonly serverId: string;
  readonly currentPrState: F11RemotePrState;
  readonly primaryState: F11PrimaryState;
  readonly configuration: F11EligibilityConfiguration;
  readonly correlationId?: string;
}

export interface F11EvaluateResult {
  readonly evaluation: F11EligibilityResult;
  readonly decision: F11EligibilityDecisionRecord;
  readonly association?: F11EventAssociationRecord;
  readonly retainedDuringHold: boolean;
}

export interface F11ClaimRequest {
  readonly managedPrId: string;
  readonly operationId: string;
  readonly bundleId: string;
  readonly claimId?: string;
  readonly holdId?: string;
  readonly eventVersionIds?: readonly string[];
  readonly configuration: F11EligibilityConfiguration;
  readonly currentPrState: F11RemotePrState;
  readonly primaryState: F11PrimaryState;
  readonly correlationId?: string;
  readonly humanAuthorized?: boolean;
  readonly signal?: AbortSignal;
}

export interface F11ClaimView {
  readonly result: F11ClaimResult;
  readonly claim?: F11AutomaticClaimRecord;
  readonly hold?: F11HoldRecord;
}

export interface F11CompleteRequest {
  readonly managedPrId: string;
  readonly claimId: string;
  readonly operationId: string;
  readonly bundleId: string;
  readonly outcome: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";
  readonly worktreeHandled: boolean;
  readonly signal?: AbortSignal;
}

export interface F11ServiceOptions {
  readonly clock?: PersistenceClock;
  readonly activity?: ActivityWriter;
}

const DEFAULT_CLOCK: PersistenceClock = {
  now: () => new Date().toISOString(),
};

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function safeCorrelation(
  value: string | undefined,
  managedPrId: string,
  eventVersionId: string,
): string {
  if (value !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    return value;
  return `f11-${hash(`${managedPrId}:${eventVersionId}`)}`;
}

function feedbackRecord(value: unknown): GithubFeedbackRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<GithubFeedbackRecord>;
  if (
    typeof candidate.source !== "string" ||
    typeof candidate.identity !== "object" ||
    candidate.identity === null ||
    typeof candidate.pullRequest !== "object" ||
    candidate.pullRequest === null ||
    typeof candidate.repository !== "object" ||
    candidate.repository === null ||
    typeof candidate.author !== "object" ||
    candidate.author === null
  )
    return undefined;
  return candidate as GithubFeedbackRecord;
}

function repositoryId(repository: GithubRepositoryIdentity): string {
  return repository.key;
}

/** Main-process F11 gate. It never imports an AI, Git, worktree, or GitHub mutation service. */
export class F11EligibilityService {
  private readonly clock: PersistenceClock;
  private readonly activity: ActivityWriter | undefined;
  public readonly persistence: F11PersistenceRepositories;

  public constructor(
    persistence: F11PersistenceRepositories,
    options: F11ServiceOptions = {},
  ) {
    this.persistence = persistence;
    this.clock = options?.clock ?? DEFAULT_CLOCK;
    this.activity = options.activity;
  }

  private appendDiagnostic(input: {
    readonly eventId: string;
    readonly managedPrId: string;
    readonly correlationId: string;
    readonly reason: F11Reason;
    readonly summary: string;
    readonly decision?: string;
    readonly operationId?: string;
  }): void {
    if (this.activity === undefined) return;
    this.activity.append({
      eventId: input.eventId,
      eventType: "OPERATION_PROGRESS",
      stage: "REVIEW",
      correlationId: input.correlationId,
      ...(input.operationId === undefined
        ? {}
        : { operationId: input.operationId }),
      managedPrId: input.managedPrId,
      occurrenceAt: this.clock.now(),
      severity: input.reason.code === "ELIGIBLE" ? "INFO" : "WARNING",
      reason: {
        code: "PROGRESS",
        what: input.reason.what,
        why: input.reason.why,
        nextAction: input.reason.nextAction,
      },
      summary: input.summary,
      details: {
        f11ReasonCode: input.reason.code,
        ...(input.decision === undefined ? {} : { decision: input.decision }),
      },
    });
  }

  /** Pure-rule entry point, useful for contract tests and scheduler preflight. */
  public evaluate(
    input: F11EligibilityInput,
    correlationId?: string,
  ): F11EligibilityResult {
    return evaluateF11Eligibility({
      input,
      correlationId: safeCorrelation(
        correlationId,
        input.managedPrId,
        input.eventVersionId,
      ),
      now: this.clock.now(),
    });
  }

  /** Reads one immutable F10 version, evaluates it, and persists only safe F11 evidence. */
  public evaluateObservedVersion(
    input: F11ObservedVersionInput,
  ): F11EvaluateResult {
    const event = this.persistence.getRemoteEventVersion(
      input.managedPrId,
      input.eventVersionId,
    );
    const existingAssociation = this.persistence.getAssociation(
      input.managedPrId,
      input.eventVersionId,
    );
    const hold = this.persistence.getActiveHold(input.managedPrId);
    const feedback = feedbackRecord(event?.payload);
    const baseInput: F11EligibilityInput =
      feedback === undefined || event === undefined
        ? {
            managedPrId: input.managedPrId,
            serverId: input.serverId,
            repositoryId: "INVALID",
            pullRequestNumber: 0,
            sourceKind: "INVALID",
            sourceId: "INVALID",
            remoteObjectKey: "INVALID",
            eventVersionId: input.eventVersionId,
            semanticHash: event?.semanticHash ?? "INVALID",
            currentPrState: "UNAVAILABLE",
            primaryState: input.primaryState,
            ...(existingAssociation === undefined
              ? {}
              : { associationState: existingAssociation.state }),
            holdActive: hold !== undefined,
            configuration: input.configuration,
          }
        : {
            managedPrId: input.managedPrId,
            serverId: input.serverId,
            repositoryId: repositoryId(feedback.repository),
            pullRequestNumber: feedback.pullRequest.number,
            sourceKind: event.sourceKind,
            sourceId: event.sourceId,
            remoteObjectKey: feedback.identity.key,
            eventVersionId: event.eventVersionId,
            semanticHash: event.semanticHash,
            ...(feedback.author.login === undefined
              ? {}
              : { authorLogin: feedback.author.login }),
            ...(feedback.author.id === undefined
              ? {}
              : { authorProviderId: feedback.author.id }),
            ...(feedback.body === undefined ? {} : { body: feedback.body }),
            ...(feedback.state === undefined
              ? {}
              : { reviewState: feedback.state }),
            currentPrState: input.currentPrState,
            primaryState: input.primaryState,
            ...(existingAssociation === undefined
              ? {}
              : { associationState: existingAssociation.state }),
            holdActive: hold !== undefined,
            configuration: input.configuration,
          };
    const evaluation = this.evaluate(
      baseInput,
      safeCorrelation(
        input.correlationId,
        input.managedPrId,
        input.eventVersionId,
      ),
    );
    const decision = this.persistence.recordDecision(
      evaluation,
      this.clock.now(),
    );
    this.appendDiagnostic({
      eventId: `f11-evaluation-${hash(`${input.managedPrId}:${input.eventVersionId}:${evaluation.reason.code}`)}`,
      managedPrId: input.managedPrId,
      correlationId: evaluation.correlationId,
      reason: evaluation.reason,
      decision: evaluation.decision,
      summary: "Feedback eligibility evaluated",
    });
    if (event === undefined || feedback === undefined)
      return { evaluation, decision, retainedDuringHold: false };
    if (evaluation.decision === "ELIGIBLE") {
      const association =
        existingAssociation ??
        this.persistence.ensureUnassignedAssociation(
          input.managedPrId,
          input.eventVersionId,
          this.clock.now(),
        );
      return { evaluation, decision, association, retainedDuringHold: false };
    }
    if (evaluation.decision === "DEFERRED_BY_HOLD" && hold !== undefined) {
      const association = this.persistence.retainDuringHold({
        managedPrId: input.managedPrId,
        eventVersionId: input.eventVersionId,
        bundleId: hold.bundleId,
        operationId: hold.operationId,
        reason: evaluation.reason,
        retainedAt: this.clock.now(),
      });
      return { evaluation, decision, association, retainedDuringHold: true };
    }
    return { evaluation, decision, retainedDuringHold: false };
  }

  public listEligibleVersionIds(managedPrId: string): readonly string[] {
    return this.persistence.listEligibleVersionIds(managedPrId);
  }

  public listRetainedVersionIds(managedPrId: string): readonly string[] {
    return this.persistence.listRetainedVersionIds(managedPrId);
  }

  /** Scheduler read port: F12 never reimplements F11 hold/claim ownership. */
  public getActiveHold(managedPrId: string): F11HoldRecord | undefined {
    return this.persistence.getActiveHold(managedPrId);
  }

  /** Scheduler read port: F12 uses this only to gate a second automatic claim. */
  public getActiveClaim(
    managedPrId: string,
  ): F11AutomaticClaimRecord | undefined {
    return this.persistence.getActiveClaim(managedPrId);
  }

  /** Claims before downstream work. A caller can retry with the same operation/bundle IDs safely. */
  public claimAutomatic(input: F11ClaimRequest): F11ClaimView {
    const activeClaim = this.persistence.getActiveClaim(input.managedPrId);
    const eventVersionIds =
      input.eventVersionIds ??
      (activeClaim !== undefined
        ? activeClaim.eventVersionIds
        : input.humanAuthorized === true
          ? this.persistence.listRetainedVersionIds(input.managedPrId)
          : this.persistence.listEligibleVersionIds(input.managedPrId));
    const correlationId = safeCorrelation(
      input.correlationId,
      input.managedPrId,
      input.operationId,
    );
    const claimId =
      input.claimId ??
      `f11-claim-${hash(`${input.managedPrId}:${input.operationId}:${input.bundleId}`)}`;
    const holdId =
      input.holdId ??
      `f11-hold-${hash(`${input.managedPrId}:${input.operationId}:${input.bundleId}`)}`;
    const configuration = evaluateF11Eligibility({
      input: {
        managedPrId: input.managedPrId,
        serverId: input.configuration.automationIdentity?.serverId ?? "INVALID",
        repositoryId: "claim",
        pullRequestNumber: 1,
        sourceKind: "claim",
        sourceId: "claim",
        remoteObjectKey: "claim",
        eventVersionId: "claim",
        semanticHash: "0123456789abcdef",
        currentPrState: "OPEN",
        primaryState: "WATCHING",
        configuration: input.configuration,
      },
      correlationId,
      now: this.clock.now(),
    }).configurationSnapshot;
    const result = this.persistence.claimAutomatic({
      claimId,
      holdId,
      managedPrId: input.managedPrId,
      operationId: input.operationId,
      bundleId: input.bundleId,
      eventVersionIds,
      configurationSnapshot: configuration,
      correlationId,
      currentPrState: input.currentPrState,
      primaryState: input.primaryState,
      ...(input.humanAuthorized === undefined
        ? {}
        : { humanAuthorized: input.humanAuthorized }),
      claimedAt: this.clock.now(),
      signal: input.signal,
    });
    this.appendDiagnostic({
      eventId: `f11-claim-${hash(`${input.managedPrId}:${input.operationId}:${result.outcome}`)}`,
      managedPrId: input.managedPrId,
      correlationId,
      reason: result.reason,
      operationId: input.operationId,
      summary: "Automatic feedback claim evaluated",
    });
    return {
      result,
      ...(result.claim === undefined ? {} : { claim: result.claim }),
      ...(result.hold === undefined ? {} : { hold: result.hold }),
    };
  }

  public completeAutomaticReview(
    input: F11CompleteRequest,
  ): F11CompletionResult {
    const result = this.persistence.completeClaim({
      ...input,
      actor: "HUMAN",
      completedAt: this.clock.now(),
      signal: input.signal,
    });
    this.appendDiagnostic({
      eventId: `f11-release-${hash(`${input.managedPrId}:${input.claimId}:${result.outcome}`)}`,
      managedPrId: input.managedPrId,
      correlationId: `f11-${hash(`${input.managedPrId}:${input.claimId}`)}`,
      reason: result.reason,
      operationId: input.operationId,
      summary: "Automatic review hold completion evaluated",
    });
    return result;
  }

  /** F22-only ownership transfer; it never marks the selected versions handled. */
  public transferForReevaluation(
    input: F11ReevaluationTransferInput,
  ): F11ReevaluationTransferResult {
    return this.persistence.transferForReevaluation(input);
  }

  public rollbackForReevaluation(
    input: F11ReevaluationRollbackInput,
  ): F11ReevaluationRollbackResult {
    return this.persistence.rollbackForReevaluation(input);
  }

  public completeDiscard(input: {
    readonly managedPrId: string;
    readonly claimId: string;
    readonly operationId: string;
    readonly bundleId: string;
  }): F11CompletionResult {
    return this.completeAutomaticReview({
      ...input,
      outcome: "DISCARDED",
      worktreeHandled: true,
    });
  }

  public reconcileStartup(): readonly F11AutomaticClaimRecord[] {
    return this.persistence.reconcileStartup();
  }

  // Explicit spelling used by the downstream F22 handoff.
  public reevaluateRetained(input: F11ClaimRequest): F11ClaimView {
    if (input.humanAuthorized !== true)
      return {
        result: {
          outcome: "CONFLICT",
          reason: {
            code: "EXPLICIT_REEVALUATION_REQUIRED",
            what: "Retained feedback requires an explicit human authorization.",
            why: "Ordinary polling and batching cannot re-admit a held version.",
            nextAction: "RE_EVALUATE",
            details: {},
          },
        },
      };
    return this.claimAutomatic(input);
  }
}

export { evaluateF11Eligibility };
export type {
  F11EligibilityConfiguration,
  F11EligibilityInput,
  F11EligibilityResult,
};
