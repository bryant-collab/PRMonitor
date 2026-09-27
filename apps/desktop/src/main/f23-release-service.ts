import { createHash } from "node:crypto";
import type { F13InspectionResult } from "../shared/f13-contracts";
import type { F14ValidationReadModel } from "./f14-validation-runner";
import type { F18AutomaticReviewBoundary } from "./automatic-review-coordinator";
import type { F18ReviewBundleReadModel } from "../shared/f18-automatic-review";
import type { F22Coordinator } from "./f22-coordinator";
import type { F22ActionGate } from "../shared/f22-discard-reevaluation";
import {
  f23ApprovalInputSchema,
  f23CandidateSchema,
  f23PublicationInputSchema,
  f23PublicationReadModelSchema,
  f23PublicationResultSchema,
  f23PublicationSummarySchema,
  f23ResponsePlanEntrySchema,
  f23ResponseProgress,
  f23ResponseTargetSchema,
  f23Reason,
  type F23ApprovalInput,
  type F23CandidateResponse,
  type F23PublicationCandidate,
  type F23PublicationInput,
  type F23PublicationPhase,
  type F23PublicationReadModel,
  type F23PublicationReason,
  type F23PublicationResult,
  type F23ResponsePlanEntry,
  type F23ResponseTarget,
} from "../shared/f23-release";
import { f23PublicationPreflightFromF22 } from "../shared/f23-preflight";
import type {
  PersistenceRepositories,
  PublicationIntentRecord,
} from "./persistence/repositories";

export interface F23ManagedPrIdentity {
  readonly managedPrId: string;
  readonly serverId: string;
  readonly owner: string;
  readonly repositoryName: string;
  readonly number: number;
}

export interface F23WorktreePort {
  readonly inspectOperation: (
    operationId: string,
    ownerId: string,
    phase?: "PREPARE" | "INSPECTION" | "BEFORE_AI" | "AFTER_AI",
  ) => Promise<F13InspectionResult>;
}

export interface F23GitCommitInput {
  readonly candidate: F23PublicationCandidate;
  readonly attemptId: string;
}

export interface F23GitPushInput {
  readonly candidate: F23PublicationCandidate;
  readonly commitSha: string;
  readonly attemptId: string;
}

export interface F23GitPublisher {
  readonly commitCandidate: (input: F23GitCommitInput) => Promise<{
    readonly outcome: "COMMITTED" | "NO_CODE_CHANGE" | "UNCERTAIN" | "FAILED";
    readonly commitSha?: string;
    readonly reason?: string;
  }>;
  readonly pushCommit: (input: F23GitPushInput) => Promise<{
    readonly outcome: "PUSHED" | "UNCERTAIN" | "FAILED";
    readonly reason?: string;
  }>;
  readonly reconcileCommit: (input: F23GitCommitInput) => Promise<{
    readonly outcome: "PRESENT" | "ABSENT" | "UNKNOWN";
    readonly commitSha?: string;
    readonly reason?: string;
  }>;
  readonly reconcilePush: (input: F23GitPushInput) => Promise<{
    readonly outcome: "PRESENT" | "ABSENT" | "UNKNOWN";
    readonly reason?: string;
  }>;
}

export interface F23ResponsePublisher {
  readonly postResponse: (input: {
    readonly response: F23CandidateResponse;
    readonly publicationId: string;
    readonly approvalId: string;
    readonly ownerId: string;
    readonly approvedAt: string;
  }) => Promise<{
    readonly outcome: "CONFIRMED" | "UNCERTAIN" | "FAILED";
    readonly remoteId?: string;
    readonly reason?: string;
  }>;
  readonly reconcileResponse: (input: {
    readonly response: F23CandidateResponse;
    readonly publicationId: string;
    readonly approvalId: string;
    readonly ownerId: string;
    readonly approvedAt: string;
  }) => Promise<{
    readonly outcome: "CONFIRMED" | "ABSENT" | "UNKNOWN";
    readonly remoteId?: string;
    readonly reason?: string;
  }>;
}

export interface F23HoldPort {
  readonly completeAutomaticReview: (input: {
    readonly managedPrId: string;
    readonly claimId: string;
    readonly operationId: string;
    readonly bundleId: string;
    readonly outcome: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED";
    readonly worktreeHandled: boolean;
  }) => { readonly outcome: "RELEASED" | "REPLAYED" | "CONFLICT" };
}

export interface F23PublicationServiceOptions {
  readonly persistence: PersistenceRepositories;
  readonly bundles: F18AutomaticReviewBoundary;
  readonly worktrees: F23WorktreePort;
  readonly f22: F22Coordinator;
  readonly managedPrs: {
    readonly get: (managedPrId: string) => F23ManagedPrIdentity | undefined;
  };
  readonly git?: F23GitPublisher;
  readonly responses?: F23ResponsePublisher;
  readonly hold?: F23HoldPort;
  readonly validation?: {
    readonly readModel: (runId: string) => F14ValidationReadModel | undefined;
  };
  readonly clock?: () => string;
}

interface F23IntentPayload {
  readonly bundleId?: string;
  readonly candidate: F23PublicationCandidate;
  readonly responsePlan: readonly F23ResponsePlanEntry[];
  readonly approvedAt: string;
  readonly completeDiffAcknowledged: true;
  readonly unattributedChangesAcknowledged: boolean;
  readonly codeEffect?: "PENDING" | "NO_CODE_CHANGE" | "COMMITTED";
  readonly codePublished?: boolean;
  readonly commitAttemptStarted?: boolean;
  readonly pushAttemptStarted?: boolean;
  readonly recoveryEffect?: "COMMIT" | "PUSH" | "RESPONSE";
  readonly recoveryResponseKey?: string;
  readonly holdCompletion?: "PENDING" | "DONE" | "NOT_REQUIRED";
  readonly terminalReason?: string;
}

interface CandidateBuild {
  readonly candidate?: F23PublicationCandidate;
  readonly reasons: readonly F23PublicationReason[];
  readonly gate?: F22ActionGate;
}

const DEFAULT_COMMIT_MESSAGE = "Publish approved Review Bundle changes";

function now(clock?: () => string): string {
  return clock?.() ?? new Date().toISOString();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function textHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeId(value: string, prefix: string): string {
  return `${prefix}-${hash(value).slice(0, 40)}`;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadOf(intent: PublicationIntentRecord): F23IntentPayload {
  const payload = asObject(intent.payload);
  const parsedCandidate = f23CandidateSchema.parse(
    payload.candidate ?? intent.proposedResult,
  );
  const responsePlan = Array.isArray(payload.responsePlan)
    ? payload.responsePlan.map((entry) =>
        f23ResponsePlanEntrySchema.parse(entry),
      )
    : [];
  return {
    candidate: parsedCandidate,
    responsePlan,
    approvedAt:
      typeof payload.approvedAt === "string"
        ? payload.approvedAt
        : intent.updatedAt,
    completeDiffAcknowledged: true,
    unattributedChangesAcknowledged:
      payload.unattributedChangesAcknowledged === true,
    ...(payload.codeEffect === "PENDING" ||
    payload.codeEffect === "NO_CODE_CHANGE" ||
    payload.codeEffect === "COMMITTED"
      ? { codeEffect: payload.codeEffect }
      : {}),
    ...(typeof payload.codePublished === "boolean"
      ? { codePublished: payload.codePublished }
      : {}),
    ...(payload.commitAttemptStarted === true
      ? { commitAttemptStarted: true }
      : {}),
    ...(payload.pushAttemptStarted === true
      ? { pushAttemptStarted: true }
      : {}),
    ...(payload.recoveryEffect === "COMMIT" ||
    payload.recoveryEffect === "PUSH" ||
    payload.recoveryEffect === "RESPONSE"
      ? { recoveryEffect: payload.recoveryEffect }
      : {}),
    ...(typeof payload.recoveryResponseKey === "string"
      ? { recoveryResponseKey: payload.recoveryResponseKey }
      : {}),
    ...(payload.holdCompletion === "PENDING" ||
    payload.holdCompletion === "DONE" ||
    payload.holdCompletion === "NOT_REQUIRED"
      ? { holdCompletion: payload.holdCompletion }
      : {}),
    ...(typeof payload.terminalReason === "string"
      ? { terminalReason: payload.terminalReason }
      : {}),
  };
}

function reasonForInspection(
  inspection: F13InspectionResult,
): F23PublicationReason[] {
  return inspection.ok
    ? []
    : [
        f23Reason(
          inspection.reason?.code ?? "F13_EVIDENCE_UNAVAILABLE",
          inspection.reason?.what ??
            "Fresh operation worktree evidence is unavailable.",
          inspection.reason?.why ??
            "F23 cannot publish a diff without current deterministic F13 evidence.",
          inspection.reason?.nextAction ?? "RECONCILE",
        ),
      ];
}

function sourceForFeedback(
  sourceKind: string,
): F23ResponseTarget["source"] | undefined {
  if (sourceKind === "ISSUE_COMMENT") return "ISSUE_COMMENT";
  if (sourceKind === "REVIEW_COMMENT") return "REVIEW_COMMENT_REPLY";
  return undefined;
}

function responseTarget(
  feedback: F18ReviewBundleReadModel["input"]["feedback"][number],
  managed: F23ManagedPrIdentity,
): F23ResponseTarget | undefined {
  const source = sourceForFeedback(feedback.sourceKind);
  if (source === undefined) return undefined;
  return f23ResponseTargetSchema.parse({
    source,
    serverId: managed.serverId,
    owner: managed.owner,
    repositoryName: managed.repositoryName,
    pullRequestNumber: managed.number,
    commentId: feedback.sourceId,
  });
}

function candidateHashInput(
  candidate: Omit<F23PublicationCandidate, "candidateHash">,
): string {
  return hash(candidate);
}

function publicationStatus(
  phase: F23PublicationPhase,
): F23PublicationReadModel["status"] {
  switch (phase) {
    case "PREPARED":
      return "APPROVED";
    case "PREPARING":
      return "PREPARING";
    case "COMMITTING":
      return "COMMITTING";
    case "PUSHING":
      return "PUSHING";
    case "POSTING_RESPONSES":
      return "POSTING_RESPONSES";
    case "RECOVERING":
      return "RECOVERING";
    case "PUBLISHED":
      return "PUBLISHED";
    case "PUBLISHED_WITH_ERRORS":
      return "PUBLISHED_WITH_ERRORS";
    case "DISCARDED":
      return "DISCARDED";
    case "FAILED":
      return "FAILED";
  }
}

export class F23PublicationService {
  private readonly clock: () => string;

  public constructor(private readonly options: F23PublicationServiceOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async read(bundleId: string): Promise<F23PublicationReadModel> {
    const existing = this.findIntentForBundle(bundleId);
    if (existing !== undefined) return this.readIntent(existing);
    const built = await this.buildCandidate(bundleId, false);
    return f23PublicationReadModelSchema.parse({
      schemaVersion: 1,
      kind: "F23_PUBLICATION_READ_MODEL",
      bundleId,
      status: built.reasons.length === 0 ? "READY_FOR_APPROVAL" : "BLOCKED",
      ...(built.candidate === undefined ? {} : { candidate: built.candidate }),
      reasons: built.reasons,
      canApprove: built.candidate !== undefined && built.reasons.length === 0,
      canPublish: false,
      canReconcile: false,
      canRetryResponses: false,
      responseOnlyRetry: false,
      authority: "F23_MAIN_PROCESS",
    });
  }

  public async approve(input: F23ApprovalInput): Promise<F23PublicationResult> {
    const parsed = f23ApprovalInputSchema.parse(input);
    const existing = this.options.persistence.getPublicationIntent(
      "REVIEW_BUNDLE",
      parsed.idempotencyKey,
    );
    if (existing !== undefined) {
      if (existing.ownerId !== parsed.bundleId)
        return this.blockedResult(
          parsed.bundleId,
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key belongs to another Review Bundle.",
        );
      const existingPayload = payloadOf(existing);
      const sameApproval =
        existing.approvalId === parsed.approvalId &&
        existingPayload.candidate.candidateHash === parsed.candidateHash &&
        existingPayload.candidate.bundleVersion ===
          parsed.expectedBundleVersion &&
        existingPayload.candidate.evidenceRevision ===
          parsed.expectedEvidenceRevision &&
        existingPayload.candidate.gateRevision ===
          parsed.expectedGateRevision &&
        existingPayload.candidate.commitMessage === parsed.commitMessage &&
        existingPayload.unattributedChangesAcknowledged ===
          parsed.unattributedChangesAcknowledged &&
        hash(existingPayload.responsePlan) === hash(parsed.responses);
      if (!sameApproval)
        return this.blockedResult(
          parsed.bundleId,
          "IDEMPOTENCY_KEY_REUSE_MISMATCH",
          "The idempotency key was already approved for different publication details.",
        );
      return {
        readModel: await this.readIntent(existing),
        outcome: "APPROVAL_RECORDED",
      };
    }
    const active = this.findIntentForBundle(parsed.bundleId);
    if (active !== undefined)
      return this.blockedResult(
        parsed.bundleId,
        "PUBLICATION_ALREADY_ACTIVE",
        "This Review Bundle already has a durable publication intent.",
      );

    const built = await this.buildCandidate(parsed.bundleId, true);
    const reasons = [...built.reasons];
    const candidate = built.candidate;
    if (candidate === undefined) {
      return this.blockedResult(
        parsed.bundleId,
        reasons[0]?.code ?? "CANDIDATE_UNAVAILABLE",
        reasons[0]?.what ?? "The exact publication candidate is unavailable.",
      );
    }
    if (parsed.candidateHash !== candidate.candidateHash)
      reasons.push(
        f23Reason(
          "CANDIDATE_CHANGED",
          "The approved candidate no longer matches the fresh exact diff.",
          "F23 never commits or posts a candidate whose evidence changed after the review surface displayed it.",
          "RELOAD",
        ),
      );
    if (parsed.expectedBundleVersion !== candidate.bundleVersion)
      reasons.push(
        f23Reason(
          "BUNDLE_VERSION_CHANGED",
          "The Review Bundle changed after the candidate was displayed.",
          "Approval must name the exact durable bundle revision being approved.",
          "RELOAD",
        ),
      );
    if (parsed.expectedEvidenceRevision !== candidate.evidenceRevision)
      reasons.push(
        f23Reason(
          "EVIDENCE_REVISION_CHANGED",
          "The deterministic worktree evidence changed after the candidate was displayed.",
          "The complete proposed diff must be reviewed again before approval.",
          "RELOAD",
        ),
      );
    if (
      built.gate !== undefined &&
      parsed.expectedGateRevision !== built.gate.gateRevision
    )
      reasons.push(
        f23Reason(
          "F22_GATE_REVISION_CHANGED",
          "The remote-head action gate changed after the candidate was displayed.",
          "The exact base, head, repository, and branch evidence must be reviewed again.",
          "RELOAD",
        ),
      );
    if (parsed.commitMessage !== candidate.commitMessage)
      reasons.push(
        f23Reason(
          "COMMIT_MESSAGE_CHANGED",
          "The commit message does not match the reviewed candidate.",
          "The durable approval must cover the exact commit message that will be used.",
          "RELOAD",
        ),
      );
    if (
      candidate.condition === "UNATTRIBUTED_CHANGES" &&
      parsed.unattributedChangesAcknowledged !== true
    )
      reasons.push(
        f23Reason(
          "UNATTRIBUTED_CHANGES_NOT_ACKNOWLEDGED",
          "The worktree contains changes without complete AI attribution.",
          "The human must explicitly acknowledge the complete fresh diff before publication can proceed.",
          "ACKNOWLEDGE",
        ),
      );
    const responsePlan = this.validateResponsePlan(
      candidate,
      parsed.responses,
      reasons,
    );
    if (reasons.length > 0)
      return this.blockedResult(
        parsed.bundleId,
        reasons[0]?.code ?? "PUBLICATION_BLOCKED",
        reasons[0]?.what ?? "Publication approval is blocked.",
        reasons,
      );

    const approvedAt = now(this.clock);
    const approvalPayload = {
      bundleId: parsed.bundleId,
      candidate,
      responsePlan,
      approvedAt,
      completeDiffAcknowledged: true,
      unattributedChangesAcknowledged: parsed.unattributedChangesAcknowledged,
    } satisfies F23IntentPayload;
    this.options.persistence.saveApproval({
      approvalId: parsed.approvalId,
      scope: "REVIEW_BUNDLE_PUBLICATION",
      reviewedSnapshotHash: parsed.candidateHash,
      payload: approvalPayload,
    });
    const intent = this.options.persistence.createPublicationIntent({
      id: safeId(
        `${parsed.bundleId}:${parsed.idempotencyKey}`,
        "f23-publication",
      ),
      kind: "REVIEW_BUNDLE",
      ownerId: parsed.bundleId,
      approvalId: parsed.approvalId,
      idempotencyKey: parsed.idempotencyKey,
      expectedBaselineSha: candidate.baselineSha,
      expectedSourceSha: candidate.currentHeadSha,
      expectedHeadSha: candidate.expectedHeadSha,
      proposedResult: candidate,
      payload: approvalPayload,
    });
    const prepared = this.options.persistence.updatePublicationIntent({
      publicationId: intent.id,
      expectedVersion: intent.version,
      phase: "PREPARING",
      recoveryState: "READY",
      payload: approvalPayload,
    });
    return {
      readModel: await this.readIntent(prepared),
      outcome: "APPROVAL_RECORDED",
    };
  }

  public async publish(
    input: F23PublicationInput,
  ): Promise<F23PublicationResult> {
    const parsed = f23PublicationInputSchema.parse(input);
    let intent = this.options.persistence.getPublicationIntent(
      "REVIEW_BUNDLE",
      parsed.idempotencyKey,
    );
    if (intent === undefined)
      return this.blockedResult(
        parsed.bundleId,
        "PUBLICATION_INTENT_NOT_FOUND",
        "No durable human approval exists for this publication key.",
      );
    if (intent.ownerId !== parsed.bundleId)
      return this.blockedResult(
        parsed.bundleId,
        "PUBLICATION_OWNER_CONFLICT",
        "The publication key does not belong to this Review Bundle.",
      );
    if (intent.phase === "RECOVERING") {
      intent = await this.reconcileIntent(intent);
      if (intent.phase === "RECOVERING")
        return {
          readModel: await this.readIntent(intent),
          outcome: "RECONCILIATION_REQUIRED",
        };
    }
    if (
      intent.phase === "PUBLISHED" ||
      intent.phase === "PUBLISHED_WITH_ERRORS"
    ) {
      if (payloadOf(intent).holdCompletion === "PENDING")
        intent = this.releaseHold(
          intent,
          intent.phase === "PUBLISHED" ? "PUBLISHED" : "PUBLISHED_WITH_ERRORS",
        );
      return {
        readModel: await this.readIntent(intent),
        outcome:
          intent.phase === "PUBLISHED" ? "PUBLISHED" : "PUBLISHED_WITH_ERRORS",
      };
    }
    if (intent.phase === "DISCARDED" || intent.phase === "FAILED")
      return {
        readModel: await this.readIntent(intent),
        outcome: "BLOCKED",
      };
    const payload = payloadOf(intent);
    const codePublished = payload.codePublished === true;
    if (!codePublished) {
      const fresh = await this.buildCandidate(parsed.bundleId, true);
      if (
        fresh.candidate === undefined ||
        fresh.reasons.length > 0 ||
        fresh.candidate.candidateHash !== payload.candidate.candidateHash
      ) {
        intent = this.failIntent(
          intent,
          "CANDIDATE_CHANGED",
          "The fresh exact diff no longer matches the approved publication candidate.",
        );
        return {
          readModel: await this.readIntent(intent),
          outcome: "BLOCKED",
        };
      }
      if (payload.codeEffect === "NO_CODE_CHANGE") {
        // The fresh F22/F13/F14 preflight above still protects response-only
        // retries even though no Git effect is needed.
      } else if (payload.candidate.changedFiles.length === 0) {
        intent = this.updateIntent(
          intent,
          "POSTING_RESPONSES",
          "NOT_REQUIRED",
          {
            ...payload,
            codeEffect: "NO_CODE_CHANGE",
            codePublished: false,
          },
        );
      } else {
        if (this.options.git === undefined) {
          intent = this.failIntent(
            intent,
            "GIT_PUBLICATION_UNAVAILABLE",
            "The deterministic Git publication boundary is unavailable.",
          );
          return {
            readModel: await this.readIntent(intent),
            outcome: "BLOCKED",
          };
        }
        if (intent.phase === "PREPARING" || intent.phase === "PREPARED") {
          intent = this.updateIntent(intent, "COMMITTING", "READY", {
            ...payload,
            codeEffect: "PENDING",
            commitAttemptStarted: false,
          });
        }
        if (intent.phase === "COMMITTING") {
          const attemptId = safeId(
            `${intent.id}:commit:${intent.version}`,
            "f23-commit",
          );
          let result: Awaited<
            ReturnType<NonNullable<F23GitPublisher>["commitCandidate"]>
          >;
          if (payloadOf(intent).commitAttemptStarted === true) {
            const reconciled = await this.options.git!.reconcileCommit({
              candidate: payloadOf(intent).candidate,
              attemptId,
            });
            if (reconciled.outcome === "PRESENT") {
              intent = this.updateIntent(
                intent,
                "PUSHING",
                "RECONCILED",
                {
                  ...payloadOf(intent),
                  codeEffect: "COMMITTED",
                  codePublished: false,
                },
                reconciled.commitSha,
              );
            } else if (reconciled.outcome === "UNKNOWN") {
              intent = this.updateIntent(
                intent,
                "RECOVERING",
                "RECONCILIATION_REQUIRED",
                {
                  ...payloadOf(intent),
                  recoveryEffect: "COMMIT",
                },
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "RECONCILIATION_REQUIRED",
              };
            }
          }
          if (intent.phase === "COMMITTING") {
            const beforeCommit = payloadOf(intent);
            intent = this.updateIntent(intent, "COMMITTING", "READY", {
              ...beforeCommit,
              commitAttemptStarted: true,
            });
            result = await this.options.git!.commitCandidate({
              candidate: beforeCommit.candidate,
              attemptId,
            });
            if (result.outcome === "UNCERTAIN") {
              intent = this.updateIntent(
                intent,
                "RECOVERING",
                "RECONCILIATION_REQUIRED",
                {
                  ...payloadOf(intent),
                  recoveryEffect: "COMMIT",
                },
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "RECONCILIATION_REQUIRED",
              };
            }
            if (result.outcome === "FAILED") {
              intent = this.failIntent(
                intent,
                "COMMIT_FAILED",
                result.reason ??
                  "The approved candidate could not be committed.",
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "BLOCKED",
              };
            }
            if (result.outcome === "NO_CODE_CHANGE") {
              intent = this.updateIntent(
                intent,
                "POSTING_RESPONSES",
                "NOT_REQUIRED",
                {
                  ...payloadOf(intent),
                  codeEffect: "NO_CODE_CHANGE",
                  codePublished: false,
                },
              );
            } else if (result.commitSha !== undefined) {
              this.options.persistence.recordExternalEffect({
                effectId: `${intent.id}:commit`,
                publicationId: intent.id,
                effectKind: "COMMIT",
                idempotencyKey: `${intent.id}:commit`,
                state: "CONFIRMED",
                evidence: { commitSha: result.commitSha },
              });
              intent = this.updateIntent(
                intent,
                "PUSHING",
                "READY",
                {
                  ...payloadOf(intent),
                  codeEffect: "COMMITTED",
                  codePublished: false,
                  commitAttemptStarted: true,
                  pushAttemptStarted: false,
                },
                result.commitSha,
              );
            } else {
              intent = this.failIntent(
                intent,
                "COMMIT_SHA_MISSING",
                "The commit completed without a durable commit SHA.",
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "BLOCKED",
              };
            }
          }
        }
        if (intent.phase === "PUSHING") {
          const current = payloadOf(intent);
          const commitSha = intent.knownCommitSha;
          if (commitSha === undefined) {
            intent = this.updateIntent(
              intent,
              "RECOVERING",
              "RECONCILIATION_REQUIRED",
              {
                ...current,
                recoveryEffect: "COMMIT",
              },
            );
            return {
              readModel: await this.readIntent(intent),
              outcome: "RECONCILIATION_REQUIRED",
            };
          }
          const attemptId = safeId(
            `${intent.id}:push:${intent.version}`,
            "f23-push",
          );
          if (current.pushAttemptStarted === true) {
            const reconciled = await this.options.git!.reconcilePush({
              candidate: current.candidate,
              commitSha,
              attemptId,
            });
            if (reconciled.outcome === "PRESENT") {
              this.options.persistence.recordExternalEffect({
                effectId: `${intent.id}:push`,
                publicationId: intent.id,
                effectKind: "PUSH",
                idempotencyKey: `${intent.id}:push`,
                state: "CONFIRMED",
                evidence: { commitSha },
              });
              intent = this.updateIntent(
                intent,
                "POSTING_RESPONSES",
                "RECONCILED",
                {
                  ...payloadOf(intent),
                  codePublished: true,
                },
                commitSha,
              );
            } else if (reconciled.outcome === "UNKNOWN") {
              intent = this.updateIntent(
                intent,
                "RECOVERING",
                "RECONCILIATION_REQUIRED",
                {
                  ...payloadOf(intent),
                  recoveryEffect: "PUSH",
                },
                commitSha,
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "RECONCILIATION_REQUIRED",
              };
            }
          }
          if (intent.phase === "PUSHING") {
            intent = this.updateIntent(
              intent,
              "PUSHING",
              "READY",
              {
                ...payloadOf(intent),
                pushAttemptStarted: true,
              },
              commitSha,
            );
            const result = await this.options.git!.pushCommit({
              candidate: payloadOf(intent).candidate,
              commitSha,
              attemptId,
            });
            if (result.outcome === "UNCERTAIN") {
              intent = this.updateIntent(
                intent,
                "RECOVERING",
                "RECONCILIATION_REQUIRED",
                {
                  ...payloadOf(intent),
                  recoveryEffect: "PUSH",
                },
                commitSha,
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "RECONCILIATION_REQUIRED",
              };
            }
            if (result.outcome === "FAILED") {
              intent = this.failIntent(
                intent,
                "PUSH_FAILED",
                result.reason ?? "The approved commit could not be pushed.",
                commitSha,
              );
              return {
                readModel: await this.readIntent(intent),
                outcome: "BLOCKED",
              };
            }
            this.options.persistence.recordExternalEffect({
              effectId: `${intent.id}:push`,
              publicationId: intent.id,
              effectKind: "PUSH",
              idempotencyKey: `${intent.id}:push`,
              state: "CONFIRMED",
              evidence: { commitSha },
            });
            intent = this.updateIntent(
              intent,
              "POSTING_RESPONSES",
              "READY",
              {
                ...payloadOf(intent),
                codePublished: true,
              },
              commitSha,
            );
          }
        }
      }
    }

    if (intent.phase !== "POSTING_RESPONSES")
      return { readModel: await this.readIntent(intent), outcome: "BLOCKED" };
    const responseResult = await this.postResponses(intent);
    if (responseResult.phase === "RECOVERING")
      return {
        readModel: await this.readIntent(responseResult),
        outcome: "RECONCILIATION_REQUIRED",
      };
    intent = responseResult;
    const failed = intent.responses.some(
      (response) => response.state === "FAILED",
    );
    const terminal = this.updateIntent(
      intent,
      failed ? "PUBLISHED_WITH_ERRORS" : "PUBLISHED",
      "NOT_REQUIRED",
      {
        ...payloadOf(intent),
        codePublished: payloadOf(intent).codePublished === true,
        holdCompletion:
          payloadOf(intent).holdCompletion === "DONE" ? "DONE" : "PENDING",
        terminalReason: failed
          ? "One or more approved responses failed."
          : undefined,
      },
      intent.knownCommitSha,
    );
    const released = this.releaseHold(
      terminal,
      failed ? "PUBLISHED_WITH_ERRORS" : "PUBLISHED",
    );
    return {
      readModel: await this.readIntent(released),
      outcome: failed ? "PUBLISHED_WITH_ERRORS" : "PUBLISHED",
    };
  }

  public async retryResponses(
    input: F23PublicationInput,
  ): Promise<F23PublicationResult> {
    const parsed = f23PublicationInputSchema.parse(input);
    const intent = this.options.persistence.getPublicationIntent(
      "REVIEW_BUNDLE",
      parsed.idempotencyKey,
    );
    if (intent === undefined || intent.ownerId !== parsed.bundleId)
      return this.blockedResult(
        parsed.bundleId,
        "PUBLICATION_INTENT_NOT_FOUND",
        "No durable publication exists for this response retry.",
      );
    if (intent.phase !== "PUBLISHED_WITH_ERRORS")
      return { readModel: await this.readIntent(intent), outcome: "BLOCKED" };
    this.updateIntent(
      intent,
      "POSTING_RESPONSES",
      "READY",
      {
        ...payloadOf(intent),
        codePublished: payloadOf(intent).codePublished === true,
        holdCompletion:
          payloadOf(intent).holdCompletion === "DONE" ? "DONE" : "PENDING",
      },
      intent.knownCommitSha,
    );
    return this.publish({
      bundleId: parsed.bundleId,
      idempotencyKey: parsed.idempotencyKey,
    });
  }

  public async reconcile(
    input: F23PublicationInput,
  ): Promise<F23PublicationResult> {
    const parsed = f23PublicationInputSchema.parse(input);
    const intent = this.options.persistence.getPublicationIntent(
      "REVIEW_BUNDLE",
      parsed.idempotencyKey,
    );
    if (intent === undefined || intent.ownerId !== parsed.bundleId)
      return this.blockedResult(
        parsed.bundleId,
        "PUBLICATION_INTENT_NOT_FOUND",
        "No durable publication exists to reconcile.",
      );
    const reconciled = await this.reconcileIntent(intent);
    if (reconciled.phase === "RECOVERING")
      return {
        readModel: await this.readIntent(reconciled),
        outcome: "RECONCILIATION_REQUIRED",
      };
    return this.publish(parsed);
  }

  public async discard(
    input: F23PublicationInput,
  ): Promise<F23PublicationResult> {
    const parsed = f23PublicationInputSchema.parse(input);
    const intent = this.options.persistence.getPublicationIntent(
      "REVIEW_BUNDLE",
      parsed.idempotencyKey,
    );
    if (intent === undefined || intent.ownerId !== parsed.bundleId)
      return this.blockedResult(
        parsed.bundleId,
        "PUBLICATION_INTENT_NOT_FOUND",
        "No durable publication exists to discard.",
      );
    if (!["PREPARED", "PREPARING"].includes(intent.phase))
      return { readModel: await this.readIntent(intent), outcome: "BLOCKED" };
    const discarded = this.updateIntent(intent, "DISCARDED", "NOT_REQUIRED", {
      ...payloadOf(intent),
      holdCompletion: "PENDING",
    });
    const released = this.releaseHold(discarded, "DISCARDED");
    return { readModel: await this.readIntent(released), outcome: "DISCARDED" };
  }

  public async reconcileStartup(): Promise<void> {
    for (const intent of this.options.persistence.listPublicationIntents(
      "REVIEW_BUNDLE",
    )) {
      if (intent.phase === "RECOVERING") await this.reconcileIntent(intent);
      else if (
        (intent.phase === "PUBLISHED" ||
          intent.phase === "PUBLISHED_WITH_ERRORS" ||
          intent.phase === "DISCARDED") &&
        payloadOf(intent).holdCompletion === "PENDING"
      )
        this.releaseHold(
          intent,
          intent.phase === "DISCARDED"
            ? "DISCARDED"
            : intent.phase === "PUBLISHED"
              ? "PUBLISHED"
              : "PUBLISHED_WITH_ERRORS",
        );
    }
  }

  private async buildCandidate(
    bundleId: string,
    freshRemote: boolean,
  ): Promise<CandidateBuild> {
    const model = this.options.bundles.getReadModel?.(bundleId);
    if (model === undefined)
      return {
        reasons: [
          f23Reason(
            "BUNDLE_NOT_FOUND",
            "The Review Bundle is unavailable.",
            "Publication requires durable F18 evidence.",
            "RELOAD",
          ),
        ],
      };
    const reasons: F23PublicationReason[] = [];
    if (model.state !== "READY_FOR_REVIEW" || model.stage !== "FINAL_REVIEW")
      reasons.push(
        f23Reason(
          "FINAL_REVIEW_REQUIRED",
          "The Review Bundle is not in final review.",
          "Publication is only available after the complete proposed work has been reviewed.",
          "REVIEW",
        ),
      );
    let gate: F22ActionGate | undefined;
    try {
      gate = freshRemote
        ? await this.options.f22.observeRemoteHead(bundleId)
        : this.options.f22.readGate(bundleId);
    } catch {
      reasons.push(
        f23Reason(
          "F22_GATE_UNAVAILABLE",
          "The exact remote-head action gate is unavailable.",
          "F23 cannot approve or publish without F22 identity and SHA evidence.",
          "RECONCILE",
        ),
      );
    }
    if (gate !== undefined) {
      if (gate.status !== "CURRENT")
        reasons.push(
          f23Reason(
            gate.reason?.code ?? "F22_NOT_CURRENT",
            "The remote-head action gate is not current.",
            gate.reason?.why ??
              "The pull request may have changed since the Review Bundle was prepared.",
            "RECONCILE",
          ),
        );
      if (gate.underlyingState === "WORKING")
        reasons.push(
          f23Reason(
            "BUNDLE_WORKING",
            "The Review Bundle is still being worked.",
            "Publication can only use a committed final review state.",
            "WAIT",
          ),
        );
      if (freshRemote) {
        const preflight = f23PublicationPreflightFromF22(gate, {
          freshRemoteObservation:
            gate.remote.observationToken === undefined ||
            gate.remote.observationRevision === undefined ||
            gate.remote.observedAt === undefined
              ? undefined
              : {
                  token: gate.remote.observationToken,
                  observationRevision: gate.remote.observationRevision,
                  observedAt: gate.remote.observedAt,
                },
          now: this.clock(),
        });
        if (!preflight.f22SafeForPublication)
          reasons.push(
            f23Reason(
              preflight.reasonCode,
              "The fresh F22 publication preflight failed.",
              "Publication requires exact current remote identity, refs, branches, and head SHA.",
              "RECONCILE",
            ),
          );
      }
    }
    if (model.worktree === undefined)
      reasons.push(
        f23Reason(
          "WORKTREE_UNAVAILABLE",
          "The Review Bundle has no operation-owned worktree.",
          "F23 stages only the canonical F13 worktree recorded for this bundle.",
          "RECONCILE",
        ),
      );
    let inspection: F13InspectionResult | undefined;
    if (model.worktree !== undefined) {
      inspection = await this.options.worktrees.inspectOperation(
        model.operationId,
        model.bundleId,
        "INSPECTION",
      );
      reasons.push(...reasonForInspection(inspection));
    }
    const validation = model.postChangeValidation ?? model.baselineValidation;
    if (validation === undefined || validation.status !== "passed")
      reasons.push(
        f23Reason(
          "VALIDATION_REQUIRED",
          "A passed deterministic validation run is required.",
          "F23 does not treat AI claims or an absent validation result as publication evidence.",
          "VALIDATE",
        ),
      );
    if (
      validation?.runId !== undefined &&
      this.options.validation?.readModel(validation.runId)?.status !== "passed"
    )
      reasons.push(
        f23Reason(
          "VALIDATION_NOT_CURRENT",
          "The persisted validation run is not passed at publication time.",
          "The exact candidate must be backed by a durable F14 result.",
          "VALIDATE",
        ),
      );
    const managed = this.options.managedPrs.get(model.managedPrId);
    if (managed === undefined)
      reasons.push(
        f23Reason(
          "MANAGED_PR_UNAVAILABLE",
          "The managed pull-request identity is unavailable.",
          "Response targets and exact remote identity must be derived from F07/F10 records.",
          "RECONCILE",
        ),
      );
    if (inspection === undefined)
      return { reasons, ...(gate === undefined ? {} : { gate }) };
    const baselineSha =
      model.worktree?.baselineSha ?? model.input.pullRequest.headSha;
    if (
      inspection.worktree.operationId !== model.operationId ||
      inspection.worktree.ownerId !== model.bundleId
    )
      reasons.push(
        f23Reason(
          "WORKTREE_IDENTITY_MISMATCH",
          "The fresh worktree evidence belongs to a different operation.",
          "F23 stages only the operation-owned worktree recorded by F18.",
          "RECONCILE",
        ),
      );
    if (inspection.worktree.worktreeBaselineSha !== baselineSha)
      reasons.push(
        f23Reason(
          "WORKTREE_BASELINE_CHANGED",
          "The operation worktree baseline no longer matches the approved bundle.",
          "A commit must be based on the exact baseline reviewed by the human.",
          "RELOAD",
        ),
      );
    if (
      inspection.worktree.currentHeadSha !== undefined &&
      inspection.worktree.currentHeadSha !== baselineSha
    )
      reasons.push(
        f23Reason(
          "WORKTREE_HEAD_CHANGED",
          "The operation worktree head changed after preparation.",
          "F23 cannot safely identify the approved diff on top of another local commit.",
          "RECONCILE",
        ),
      );
    const proposedDiff = inspection.proposedDiff;
    const trackedFiles = (proposedDiff?.files.map((file) => file.path) ?? [])
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    const untrackedFiles = [...(proposedDiff?.untrackedFiles ?? [])]
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    const changedFiles = [...trackedFiles, ...untrackedFiles]
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
    if (proposedDiff?.complete !== true)
      reasons.push(
        f23Reason(
          "PROPOSED_DIFF_INCOMPLETE",
          "The complete proposed worktree diff is unavailable.",
          "A contextual or partial diff can never be staged for publication.",
          "RECONCILE",
        ),
      );
    const condition = inspection.condition;
    if (
      ["MIXED_OR_OVERLAP", "STALE_OR_UNKNOWN"].includes(
        condition.classification,
      )
    )
      reasons.push(
        f23Reason(
          "WORKTREE_CONDITION_BLOCKED",
          "The worktree condition is unsafe for publication.",
          "Mixed, overlapping, stale, or unknown changes require explicit F22 reconciliation before publication.",
          "RECONCILE",
        ),
      );
    if (!condition.attribution.complete)
      reasons.push(
        f23Reason(
          "ATTRIBUTION_INCOMPLETE",
          "The worktree attribution evidence is incomplete.",
          "F23 cannot safely distinguish the approved proposed diff from other changes.",
          "INSPECT_CHANGES",
        ),
      );
    const responses: F23CandidateResponse[] = [];
    if (managed !== undefined) {
      for (const draft of model.draftResponses) {
        const feedback = model.input.feedback.find(
          (candidate) => candidate.eventVersionId === draft.eventVersionId,
        );
        if (feedback === undefined) continue;
        const target = responseTarget(feedback, managed);
        if (target === undefined) continue;
        responses.push({
          responseKey: draft.eventVersionId,
          eventVersionId: draft.eventVersionId,
          target,
          body: draft.text,
          bodyHash: textHash(draft.text),
        });
      }
    }
    const candidateWithoutHash: Omit<F23PublicationCandidate, "candidateHash"> =
      {
        schemaVersion: 1,
        kind: "F23_PUBLICATION_CANDIDATE",
        bundleId: model.bundleId,
        managedPrId: model.managedPrId,
        operationId: model.operationId,
        bundleVersion: model.version,
        evidenceRevision: model.worktree?.rootRevision ?? 0,
        gateRevision: gate?.gateRevision ?? 0,
        baselineSha,
        expectedHeadSha: model.input.pullRequest.headSha,
        ...(inspection.worktree.currentHeadSha === undefined
          ? {}
          : { currentHeadSha: inspection.worktree.currentHeadSha }),
        worktreePath: inspection.worktree.canonicalPath,
        condition: condition.classification,
        conditionFingerprint: condition.currentFingerprint,
        conditionEvidenceComplete: condition.attribution.complete,
        changedFiles,
        trackedFiles,
        untrackedFiles,
        ...(proposedDiff === undefined
          ? {}
          : {
              proposedDiffId: proposedDiff.diffId,
              proposedDiffHash: proposedDiff.diffHash,
              proposedPatchHash: proposedDiff.patchHash,
            }),
        proposedDiffComplete: proposedDiff?.complete === true,
        ...(validation?.runId === undefined
          ? {}
          : {
              validationRunId: validation.runId,
              validationStatus: validation.status,
            }),
        commitMessage: DEFAULT_COMMIT_MESSAGE,
        headBranch: model.input.pullRequest.headBranch,
        responses,
      };
    const candidate = f23CandidateSchema.parse({
      ...candidateWithoutHash,
      candidateHash: candidateHashInput(candidateWithoutHash),
    });
    return { candidate, reasons, ...(gate === undefined ? {} : { gate }) };
  }

  private validateResponsePlan(
    candidate: F23PublicationCandidate,
    requested: readonly F23ResponsePlanEntry[],
    reasons: F23PublicationReason[],
  ): readonly F23ResponsePlanEntry[] {
    const byKey = new Map(
      candidate.responses.map((response) => [response.responseKey, response]),
    );
    const seen = new Set<string>();
    const result: F23ResponsePlanEntry[] = [];
    for (const entry of requested) {
      const parsed = f23ResponsePlanEntrySchema.parse(entry);
      if (seen.has(parsed.responseKey) || !byKey.has(parsed.responseKey)) {
        reasons.push(
          f23Reason(
            "RESPONSE_PLAN_MISMATCH",
            "The response approval list does not match the candidate.",
            "Every included or excluded response must be named exactly once before publication.",
            "RELOAD",
          ),
        );
        continue;
      }
      seen.add(parsed.responseKey);
      if (parsed.bodyHash !== textHash(parsed.body))
        reasons.push(
          f23Reason(
            "RESPONSE_BODY_CHANGED",
            "A response body changed after review.",
            "The durable approval must cover the exact editable response body that will be posted.",
            "RELOAD",
          ),
        );
      result.push(parsed);
    }
    if (seen.size !== candidate.responses.length)
      reasons.push(
        f23Reason(
          "RESPONSE_PLAN_INCOMPLETE",
          "The response approval list is incomplete.",
          "Each proposed response needs an explicit include or exclude decision.",
          "REVIEW",
        ),
      );
    return result;
  }

  private findIntentForBundle(
    bundleId: string,
  ): PublicationIntentRecord | undefined {
    return this.options.persistence
      .listPublicationIntents("REVIEW_BUNDLE")
      .find((intent) => intent.ownerId === bundleId);
  }

  private async readIntent(
    intent: PublicationIntentRecord,
  ): Promise<F23PublicationReadModel> {
    const payload = payloadOf(intent);
    const states = payload.responsePlan
      .filter((entry) => entry.included)
      .map(
        (entry) =>
          intent.responses.find(
            (response) => response.responseKey === entry.responseKey,
          )?.state ?? "PENDING",
      );
    const summary = f23PublicationSummarySchema.parse({
      publicationId: intent.id,
      idempotencyKey: intent.idempotencyKey,
      approvalId: intent.approvalId,
      phase: intent.phase,
      recoveryState: intent.recoveryState,
      codePublished: payload.codePublished === true,
      ...(intent.knownCommitSha === undefined
        ? {}
        : { commitSha: intent.knownCommitSha }),
      responses: f23ResponseProgress(states),
      updatedAt: intent.updatedAt,
      nextAction:
        intent.phase === "RECOVERING"
          ? "RECONCILE"
          : intent.phase === "PUBLISHED_WITH_ERRORS"
            ? "RETRY_RESPONSES"
            : intent.phase === "PUBLISHED" || intent.phase === "DISCARDED"
              ? "NONE"
              : "PUBLISH",
    });
    return f23PublicationReadModelSchema.parse({
      schemaVersion: 1,
      kind: "F23_PUBLICATION_READ_MODEL",
      bundleId: intent.ownerId,
      status: publicationStatus(intent.phase as F23PublicationPhase),
      candidate: payload.candidate,
      publication: summary,
      reasons:
        intent.phase === "RECOVERING"
          ? [
              f23Reason(
                "RECONCILIATION_REQUIRED",
                "The last external outcome is uncertain.",
                "F23 will not repeat a commit, push, or response until the exact remote identity is reconciled.",
                "RECONCILE",
              ),
            ]
          : intent.phase === "PUBLISHED_WITH_ERRORS"
            ? [
                f23Reason(
                  "PUBLISHED_WITH_ERRORS",
                  "Code publication completed but one or more approved responses failed.",
                  "Retrying responses is response-only and will never republish the approved code.",
                  "RETRY_RESPONSES",
                ),
              ]
            : [],
      canApprove: false,
      canPublish: [
        "PREPARED",
        "PREPARING",
        "COMMITTING",
        "PUSHING",
        "POSTING_RESPONSES",
      ].includes(intent.phase),
      canReconcile:
        intent.phase === "RECOVERING" || payload.holdCompletion === "PENDING",
      canRetryResponses: intent.phase === "PUBLISHED_WITH_ERRORS",
      responseOnlyRetry: intent.phase === "PUBLISHED_WITH_ERRORS",
      authority: "F23_MAIN_PROCESS",
    });
  }

  private blockedResult(
    bundleId: string,
    code: string,
    what: string,
    reasons: readonly F23PublicationReason[] = [
      f23Reason(code, what, "No external effect was attempted.", "REVIEW"),
    ],
  ): F23PublicationResult {
    return f23PublicationResultSchema.parse({
      readModel: {
        schemaVersion: 1,
        kind: "F23_PUBLICATION_READ_MODEL",
        bundleId,
        status: "BLOCKED",
        reasons,
        canApprove: false,
        canPublish: false,
        canReconcile: false,
        canRetryResponses: false,
        responseOnlyRetry: false,
        authority: "F23_MAIN_PROCESS",
      },
      outcome: "BLOCKED",
    });
  }

  private updateIntent(
    intent: PublicationIntentRecord,
    phase: string,
    recoveryState: string,
    payload: F23IntentPayload,
    knownCommitSha?: string,
  ): PublicationIntentRecord {
    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    return this.options.persistence.updatePublicationIntent({
      publicationId: intent.id,
      expectedVersion: intent.version,
      phase,
      recoveryState,
      ...(knownCommitSha === undefined ? {} : { knownCommitSha }),
      payload: cleanedPayload,
    });
  }

  private failIntent(
    intent: PublicationIntentRecord,
    code: string,
    message: string,
    knownCommitSha?: string,
  ): PublicationIntentRecord {
    return this.updateIntent(
      intent,
      "FAILED",
      "NOT_REQUIRED",
      {
        ...payloadOf(intent),
        terminalReason: `${code}:${message}`,
      },
      knownCommitSha ?? intent.knownCommitSha,
    );
  }

  private async postResponses(
    intent: PublicationIntentRecord,
  ): Promise<PublicationIntentRecord> {
    let current = intent;
    const payload = payloadOf(current);
    for (const plan of payload.responsePlan.filter((entry) => entry.included)) {
      const response = payload.candidate.responses.find(
        (candidate) => candidate.responseKey === plan.responseKey,
      );
      if (response === undefined) continue;
      const approvedResponse: F23CandidateResponse = {
        ...response,
        body: plan.body,
        bodyHash: plan.bodyHash,
      };
      const existing = current.responses.find(
        (candidate) => candidate.responseKey === response.responseKey,
      );
      if (existing?.state === "POSTED") continue;
      this.options.persistence.putPublicationResponse(current.id, {
        responseKey: response.responseKey,
        state: "PENDING",
        payload: {
          bodyHash: approvedResponse.bodyHash,
          target: approvedResponse.target,
        },
      });
      if (this.options.responses === undefined) {
        this.options.persistence.putPublicationResponse(current.id, {
          responseKey: response.responseKey,
          state: "FAILED",
          errorCode: "RESPONSE_PUBLISHER_UNAVAILABLE",
        });
        continue;
      }
      const result = await this.options.responses.postResponse({
        response: approvedResponse,
        publicationId: current.id,
        approvalId: current.approvalId,
        ownerId: current.ownerId,
        approvedAt: payload.approvedAt,
      });
      if (result.outcome === "UNCERTAIN") {
        this.options.persistence.putPublicationResponse(current.id, {
          responseKey: response.responseKey,
          state: "UNKNOWN",
          errorCode: "REMOTE_RESPONSE_UNKNOWN",
        });
        current = this.updateIntent(
          current,
          "RECOVERING",
          "RECONCILIATION_REQUIRED",
          {
            ...payloadOf(current),
            recoveryEffect: "RESPONSE",
            recoveryResponseKey: response.responseKey,
          },
          current.knownCommitSha,
        );
        return current;
      }
      if (result.outcome === "FAILED") {
        this.options.persistence.putPublicationResponse(current.id, {
          responseKey: response.responseKey,
          state: "FAILED",
          errorCode: "REMOTE_RESPONSE_FAILED",
        });
      } else {
        this.options.persistence.putPublicationResponse(current.id, {
          responseKey: response.responseKey,
          state: "POSTED",
          remoteId: result.remoteId,
        });
        this.options.persistence.recordExternalEffect({
          effectId: `${current.id}:response:${response.responseKey}`,
          publicationId: current.id,
          effectKind: "RESPONSE",
          idempotencyKey: `${current.id}:${response.responseKey}`,
          state: "CONFIRMED",
          ...(result.remoteId === undefined
            ? {}
            : { knownRemoteId: result.remoteId }),
          evidence: { bodyHash: approvedResponse.bodyHash },
        });
      }
      current = this.updateIntent(
        current,
        "POSTING_RESPONSES",
        "READY",
        {
          ...payloadOf(current),
        },
        current.knownCommitSha,
      );
    }
    return current;
  }

  private async reconcileIntent(
    intent: PublicationIntentRecord,
  ): Promise<PublicationIntentRecord> {
    const current = intent;
    const payload = payloadOf(current);
    if (payload.recoveryEffect === "COMMIT" && this.options.git !== undefined) {
      const result = await this.options.git.reconcileCommit({
        candidate: payload.candidate,
        attemptId: safeId(
          `${current.id}:commit-reconcile:${current.version}`,
          "f23-reconcile",
        ),
      });
      if (result.outcome === "PRESENT" && result.commitSha !== undefined)
        return this.updateIntent(
          current,
          "PUSHING",
          "RECONCILED",
          {
            ...payload,
            codeEffect: "COMMITTED",
            recoveryEffect: undefined,
            codePublished: false,
          },
          result.commitSha,
        );
      if (result.outcome === "ABSENT")
        return this.updateIntent(current, "COMMITTING", "RECONCILED", {
          ...payload,
          recoveryEffect: undefined,
          commitAttemptStarted: false,
        });
      return current;
    }
    if (
      payload.recoveryEffect === "PUSH" &&
      this.options.git !== undefined &&
      current.knownCommitSha !== undefined
    ) {
      const result = await this.options.git.reconcilePush({
        candidate: payload.candidate,
        commitSha: current.knownCommitSha,
        attemptId: safeId(
          `${current.id}:push-reconcile:${current.version}`,
          "f23-reconcile",
        ),
      });
      if (result.outcome === "PRESENT")
        return this.updateIntent(
          current,
          "POSTING_RESPONSES",
          "RECONCILED",
          {
            ...payload,
            recoveryEffect: undefined,
            codePublished: true,
          },
          current.knownCommitSha,
        );
      if (result.outcome === "ABSENT")
        return this.updateIntent(
          current,
          "PUSHING",
          "RECONCILED",
          {
            ...payload,
            recoveryEffect: undefined,
            pushAttemptStarted: false,
          },
          current.knownCommitSha,
        );
      return current;
    }
    if (
      payload.recoveryEffect === "RESPONSE" &&
      this.options.responses !== undefined
    ) {
      const response = payload.candidate.responses.find(
        (candidate) => candidate.responseKey === payload.recoveryResponseKey,
      );
      if (response === undefined) return current;
      const approvedPlan = payload.responsePlan.find(
        (entry) => entry.responseKey === response.responseKey,
      );
      if (approvedPlan === undefined) return current;
      const approvedResponse: F23CandidateResponse = {
        ...response,
        body: approvedPlan.body,
        bodyHash: approvedPlan.bodyHash,
      };
      const result = await this.options.responses.reconcileResponse({
        response: approvedResponse,
        publicationId: current.id,
        approvalId: current.approvalId,
        ownerId: current.ownerId,
        approvedAt: payload.approvedAt,
      });
      if (result.outcome === "UNKNOWN") return current;
      this.options.persistence.putPublicationResponse(current.id, {
        responseKey: response.responseKey,
        state: result.outcome === "CONFIRMED" ? "POSTED" : "FAILED",
        ...(result.remoteId === undefined ? {} : { remoteId: result.remoteId }),
        ...(result.outcome === "ABSENT"
          ? { errorCode: "REMOTE_RESPONSE_ABSENT" }
          : {}),
      });
      const next = this.updateIntent(
        current,
        "POSTING_RESPONSES",
        "RECONCILED",
        {
          ...payload,
          recoveryEffect: undefined,
          recoveryResponseKey: undefined,
        },
        current.knownCommitSha,
      );
      return next;
    }
    return current;
  }

  private releaseHold(
    intent: PublicationIntentRecord,
    outcome: "PUBLISHED" | "PUBLISHED_WITH_ERRORS" | "DISCARDED",
  ): PublicationIntentRecord {
    const payload = payloadOf(intent);
    if (
      payload.holdCompletion === "DONE" ||
      payload.holdCompletion === "NOT_REQUIRED"
    )
      return intent;
    const model = this.options.bundles.getReadModel?.(intent.ownerId);
    if (model === undefined || this.options.hold === undefined)
      return this.updateIntent(
        intent,
        intent.phase,
        intent.recoveryState,
        {
          ...payload,
          holdCompletion: "NOT_REQUIRED",
        },
        intent.knownCommitSha,
      );
    const result = this.options.hold.completeAutomaticReview({
      managedPrId: model.managedPrId,
      claimId: model.input.claimId,
      operationId: model.operationId,
      bundleId: model.bundleId,
      outcome,
      worktreeHandled: true,
    });
    if (result.outcome === "CONFLICT") return intent;
    return this.updateIntent(
      intent,
      intent.phase,
      intent.recoveryState,
      {
        ...payload,
        holdCompletion: "DONE",
      },
      intent.knownCommitSha,
    );
  }
}
