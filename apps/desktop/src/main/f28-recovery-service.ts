import { randomUUID } from "node:crypto";
import {
  F28_RECOVERY_STAGES,
  F28_SCHEMA_VERSION,
  f28IsAttentionClassification,
  f28IsRetryableClassification,
  f28IsTerminalClassification,
  f28NextRetryAt,
  f28OwnerOutcomeSchema,
  f28RecoverySessionRecordSchema,
  f28RequestKey,
  f28ScopeInputSchema,
  F28_MAX_ATTEMPTS,
  F28_MAX_SCOPES,
  type F28LifecycleSnapshot,
  type F28OwnerOutcome,
  type F28RecoveryAction,
  type F28RecoveryClassification,
  type F28RecoveryProjection,
  type F28RecoveryRequest,
  type F28RecoveryScopeInput,
  type F28RecoveryScopeRecord,
  type F28RecoverySessionRecord,
  type F28RecoveryStage,
  type F28RecoverySessionResult,
} from "../shared/f28-recovery";
import type { F28RecoveryRepositories } from "./persistence";

export interface F28RecoveryClock {
  readonly now: () => string;
  readonly monotonicNowMs?: () => number;
}

export interface F28RecoveryOwnerContext {
  readonly sessionId: string;
  readonly trigger: F28RecoveryRequest["trigger"];
  readonly lifecycle: F28LifecycleSnapshot;
  readonly scope: F28RecoveryScopeInput;
  readonly attemptNumber: number;
  readonly automatic: true;
  readonly allowProviderInvocation: false;
  readonly allowPublication: false;
  readonly allowForcePush: false;
  readonly allowArbitraryCommands: false;
  readonly allowWorktreeReplacement: false;
}

export interface F28RecoveryOwner {
  readonly owner: string;
  readonly stage: Exclude<F28RecoveryStage, "LIFECYCLE" | "FINALIZE">;
  readonly requiresNetwork?: boolean;
  /** Global durable-state scan, once per owner in this recovery session. */
  readonly reconcileSession?: (
    context: Omit<F28RecoveryOwnerContext, "scope" | "attemptNumber">,
  ) => void | Promise<void>;
  readonly listScopes?: () =>
    | readonly F28RecoveryScopeInput[]
    | Promise<readonly F28RecoveryScopeInput[]>;
  readonly recover: (
    context: F28RecoveryOwnerContext,
  ) => F28OwnerOutcome | Promise<F28OwnerOutcome>;
}

export interface F28RecoveryActivityEvent {
  readonly event:
    | "SESSION_STARTED"
    | "OWNER_SCANNED"
    | "RETRY_SCHEDULED"
    | "ADOPTED"
    | "BLOCKED"
    | "UNCERTAIN"
    | "SESSION_COMPLETED";
  readonly sessionId: string;
  readonly scopeKey?: string;
  readonly scope?: F28RecoveryScopeInput;
  readonly owner?: string;
  readonly stage: F28RecoveryStage;
  readonly classification?: F28RecoveryClassification;
  readonly reasonCode: string;
  readonly summary: string;
  readonly occurrenceAt: string;
}

export interface F28RecoveryActivityPort {
  readonly append: (event: F28RecoveryActivityEvent) => void;
}

export interface F28RecoveryCoordinatorOptions {
  readonly persistence: F28RecoveryRepositories;
  readonly lifecycle: () => F28LifecycleSnapshot;
  readonly owners?: readonly F28RecoveryOwner[];
  readonly clock?: F28RecoveryClock;
  readonly activity?: F28RecoveryActivityPort;
}

const APPLICATION_SCOPE: F28RecoveryScopeInput = {
  schemaVersion: F28_SCHEMA_VERSION,
  kind: "application",
  id: "application",
  owner: "f28-lifecycle",
  stage: "LIFECYCLE",
};

function defaultClock(): F28RecoveryClock {
  return {
    now: () => new Date().toISOString(),
    monotonicNowMs: () => performance.now(),
  };
}

function safeRequestId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    throw new Error("F28_INVALID_REQUEST_ID");
}

function reason(input: {
  readonly code: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: F28RecoveryAction;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly evidenceRefs?: readonly string[];
}): F28OwnerOutcome["reason"] {
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    code: input.code,
    what: input.what,
    why: input.why,
    nextAction: input.nextAction,
    retryable: input.retryable,
    correlationId: input.correlationId,
    evidenceRefs: [...(input.evidenceRefs ?? [])].slice(0, 16),
  };
}

function completedOutcome(sessionId: string): F28OwnerOutcome {
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    classification: "COMPLETED",
    reason: reason({
      code: "RECOVERY_SCOPE_RECONCILED",
      what: "The durable recovery scope was reconciled.",
      why: "No additional lifecycle action was required for this scope.",
      nextAction: "NONE",
      retryable: false,
      correlationId: `f28-${sessionId}-lifecycle`,
    }),
    evidenceRefs: [],
  };
}

function lifecycleScope(scope: F28RecoveryScopeInput): boolean {
  return scope.kind === "application" && scope.stage === "LIFECYCLE";
}

function stageIndex(stage: F28RecoveryStage): number {
  return F28_RECOVERY_STAGES.indexOf(stage);
}

function uniqueScopes(
  scopes: readonly F28RecoveryScopeInput[],
): readonly F28RecoveryScopeInput[] {
  const seen = new Set<string>();
  const result: F28RecoveryScopeInput[] = [];
  for (const value of scopes) {
    const parsed = f28ScopeInputSchema.parse(value);
    const key = `${parsed.owner}:${parsed.stage}:${parsed.kind}:${parsed.id}:${parsed.expectedRevision ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed);
    if (result.length >= F28_MAX_SCOPES) break;
  }
  return result.sort(
    (left, right) =>
      stageIndex(left.stage) - stageIndex(right.stage) ||
      `${left.owner}:${left.kind}:${left.id}`.localeCompare(
        `${right.owner}:${right.kind}:${right.id}`,
      ),
  );
}

function isDue(scope: F28RecoveryScopeRecord, now: string): boolean {
  return scope.nextAttemptAt === undefined || scope.nextAttemptAt <= now;
}

function outcomeForOwnerFailure(
  sessionId: string,
  scope: F28RecoveryScopeInput,
  attemptNumber: number,
  error: unknown,
): F28OwnerOutcome {
  void error;
  const code =
    scope.stage === "AI" ? "AI_RECOVERY_OWNER_FAILED" : "RECOVERY_OWNER_FAILED";
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    classification: "UNCERTAIN",
    reason: reason({
      code,
      what: "The recovery owner did not return a committed outcome.",
      why: "Recovery cannot infer success from an interrupted owner call.",
      nextAction: "RECONCILE",
      retryable: false,
      correlationId: `f28-${sessionId}-${scope.kind}`,
      evidenceRefs: [`attempt-${attemptNumber}`],
    }),
    evidenceRefs: [`attempt-${attemptNumber}`],
  };
}

export class F28RecoveryCoordinator {
  private readonly owners: readonly F28RecoveryOwner[];
  private readonly clock: F28RecoveryClock;
  private readonly inFlight = new Map<
    string,
    Promise<F28RecoverySessionResult>
  >();
  private stopping = false;

  public constructor(private readonly options: F28RecoveryCoordinatorOptions) {
    this.owners = [...(options.owners ?? [])].sort(
      (left, right) =>
        stageIndex(left.stage) - stageIndex(right.stage) ||
        left.owner.localeCompare(right.owner),
    );
    this.clock = options.clock ?? defaultClock();
    const ownerNames = new Set<string>();
    for (const owner of this.owners) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(owner.owner))
        throw new Error("F28_INVALID_OWNER_ID");
      if (ownerNames.has(owner.owner)) throw new Error("F28_DUPLICATE_OWNER");
      ownerNames.add(owner.owner);
    }
  }

  public async request(
    input: F28RecoveryRequest,
  ): Promise<F28RecoverySessionResult> {
    if (this.stopping) throw new Error("F28_RECOVERY_STOPPING");
    safeRequestId(input.requestId);
    const observedLifecycle = this.options.lifecycle();
    const monotonicNowMs = this.clock.monotonicNowMs?.();
    const lifecycle = f28RecoverySessionRecordSchema.shape.lifecycle.parse({
      ...observedLifecycle,
      ...(monotonicNowMs === undefined ? {} : { monotonicNowMs }),
    });
    const requestKey = f28RequestKey({
      trigger: input.trigger,
      requestId: input.requestId,
      applicationSessionId: lifecycle.applicationSessionId,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
    });
    const coalescingKey =
      input.trigger === "wake" || input.trigger === "online"
        ? f28RequestKey({
            trigger: input.trigger,
            requestId: "environment",
            applicationSessionId: lifecycle.applicationSessionId,
            ...(input.scope === undefined ? {} : { scope: input.scope }),
            ...(input.expectedRevision === undefined
              ? {}
              : { expectedRevision: input.expectedRevision }),
          })
        : requestKey;
    const running = this.inFlight.get(coalescingKey);
    if (running !== undefined) return running;
    const work = this.execute(input, requestKey, lifecycle).finally(() => {
      this.inFlight.delete(coalescingKey);
    });
    this.inFlight.set(coalescingKey, work);
    return work;
  }

  public read(sessionId?: string): F28RecoveryProjection | undefined {
    return this.options.persistence.readProjection(sessionId);
  }

  public async startup(
    requestId = "f28-startup",
  ): Promise<F28RecoverySessionResult> {
    return this.request({ trigger: "startup", requestId });
  }

  public async wake(requestId = "f28-wake"): Promise<F28RecoverySessionResult> {
    return this.request({ trigger: "wake", requestId });
  }

  public async online(
    requestId = "f28-online",
  ): Promise<F28RecoverySessionResult> {
    return this.request({ trigger: "online", requestId });
  }

  public async rendererReplaced(
    requestId = "f28-renderer-replaced",
  ): Promise<F28RecoverySessionResult> {
    return this.request({ trigger: "renderer_replaced", requestId });
  }

  public stop(): void {
    this.stopping = true;
  }

  private async execute(
    input: F28RecoveryRequest,
    requestKey: string,
    lifecycle: F28LifecycleSnapshot,
  ): Promise<F28RecoverySessionResult> {
    const sessionId = `f28-session-${randomUUID()}`;
    const created = this.options.persistence.createOrGetSession({
      sessionId,
      requestKey,
      trigger: input.trigger,
      lifecycle,
      createdAt: this.clock.now(),
    });
    const session = created.session;
    this.emit({
      event: "SESSION_STARTED",
      sessionId: session.sessionId,
      stage: "LIFECYCLE",
      reasonCode: created.created
        ? "RECOVERY_SESSION_STARTED"
        : "RECOVERY_SESSION_COALESCED",
      summary: created.created
        ? "A bounded recovery session started."
        : "An equivalent recovery request joined its durable session.",
      occurrenceAt: this.clock.now(),
    });
    if (!created.created && session.status !== "RUNNING") {
      const projection = this.requireProjection(session.sessionId);
      return { session, projection, coalesced: true };
    }

    const discovered = await this.discoverScopes(input);
    const scopes = uniqueScopes([
      ...(input.scope === undefined ? [APPLICATION_SCOPE] : []),
      ...discovered,
      ...(input.scope === undefined ? [] : [input.scope]),
    ]);
    for (const scope of scopes)
      this.options.persistence.putScope(scope, session.sessionId);
    if (scopes.length === 0)
      this.options.persistence.putScope(APPLICATION_SCOPE, session.sessionId);

    const reconciliations = new Map<string, Promise<void>>();
    for (const stage of F28_RECOVERY_STAGES) {
      if (stage === "FINALIZE") break;
      this.options.persistence.updateStage(session.sessionId, stage);
      const sessionScopes = this.options.persistence
        .listScopes(session.sessionId)
        .filter((scope) => scope.stage === stage);
      if (stage === "LIFECYCLE") {
        for (const scope of sessionScopes) {
          if (!lifecycleScope(scope.scope) || scope.attemptCount > 0) continue;
          const begun = this.options.persistence.beginAttempt({
            sessionId: session.sessionId,
            scopeKey: scope.scopeKey,
            stage,
            expectedRevision: scope.scope.expectedRevision,
          });
          this.options.persistence.completeAttempt({
            attemptId: begun.attempt.attemptId,
            outcome: completedOutcome(session.sessionId),
          });
        }
        continue;
      }
      const ownerByName = new Map(
        this.owners
          .filter((owner) => owner.stage === stage)
          .map((owner) => [owner.owner, owner]),
      );
      for (const scope of sessionScopes) {
        if (
          f28IsTerminalClassification(scope.classification) &&
          scope.attemptCount > 0
        )
          continue;
        if (scope.attemptCount >= F28_MAX_ATTEMPTS) continue;
        if (!isDue(scope, this.clock.now()) && input.trigger !== "explicit")
          continue;
        const owner = ownerByName.get(scope.scope.owner);
        const begun = this.options.persistence.beginAttempt({
          sessionId: session.sessionId,
          scopeKey: scope.scopeKey,
          stage,
          expectedRevision: scope.scope.expectedRevision,
        });
        if (!begun.created && begun.attempt.status === "COMPLETED") continue;
        const context: F28RecoveryOwnerContext = {
          sessionId: session.sessionId,
          trigger: input.trigger,
          lifecycle,
          scope: scope.scope,
          attemptNumber: begun.attempt.attemptNumber,
          automatic: true,
          allowProviderInvocation: false,
          allowPublication: false,
          allowForcePush: false,
          allowArbitraryCommands: false,
          allowWorktreeReplacement: false,
        };
        let outcome: F28OwnerOutcome;
        if (owner === undefined) {
          outcome = {
            schemaVersion: F28_SCHEMA_VERSION,
            classification: "BLOCKED",
            reason: reason({
              code: "RECOVERY_OWNER_UNAVAILABLE",
              what: "The owner of this recovery scope is not available.",
              why: "Recovery cannot safely substitute another feature or scope.",
              nextAction: "RECONCILE",
              retryable: true,
              correlationId: `f28-${session.sessionId}-${scope.scope.kind}`,
            }),
            evidenceRefs: [scope.scopeKey],
          };
        } else if (!lifecycle.online && owner.requiresNetwork === true) {
          const nextAttemptAt = f28NextRetryAt(
            this.clock.now(),
            begun.attempt.attemptNumber,
          );
          outcome = {
            schemaVersion: F28_SCHEMA_VERSION,
            classification: "WAITING_FOR_NETWORK",
            reason: reason({
              code: "NETWORK_OFFLINE",
              what: "Recovery is waiting for network connectivity.",
              why: "The owner requires an authoritative remote read before it can continue.",
              nextAction: "WAIT",
              retryable: true,
              correlationId: `f28-${session.sessionId}-${scope.scope.kind}`,
            }),
            evidenceRefs: ["offline"],
            nextAttemptAt,
          };
        } else {
          try {
            if (owner.reconcileSession !== undefined) {
              let reconciliation = reconciliations.get(owner.owner);
              if (reconciliation === undefined) {
                const {
                  scope: _scope,
                  attemptNumber: _attempt,
                  ...sessionContext
                } = context;
                reconciliation = Promise.resolve().then(() =>
                  owner.reconcileSession!(sessionContext),
                );
                reconciliations.set(owner.owner, reconciliation);
              }
              await reconciliation;
            }
            outcome = f28OwnerOutcomeSchema.parse(await owner.recover(context));
          } catch (error) {
            outcome = outcomeForOwnerFailure(
              session.sessionId,
              scope.scope,
              begun.attempt.attemptNumber,
              error,
            );
          }
        }
        if (
          f28IsRetryableClassification(outcome.classification) &&
          outcome.nextAttemptAt === undefined
        )
          outcome = {
            ...outcome,
            nextAttemptAt: f28NextRetryAt(
              this.clock.now(),
              begun.attempt.attemptNumber,
            ),
          };
        this.options.persistence.completeAttempt({
          attemptId: begun.attempt.attemptId,
          outcome,
        });
        this.emit({
          event: f28IsRetryableClassification(outcome.classification)
            ? "RETRY_SCHEDULED"
            : f28IsAttentionClassification(outcome.classification)
              ? outcome.classification === "UNCERTAIN"
                ? "UNCERTAIN"
                : "BLOCKED"
              : outcome.classification === "ADOPTED"
                ? "ADOPTED"
                : "OWNER_SCANNED",
          sessionId: session.sessionId,
          scopeKey: scope.scopeKey,
          owner: owner?.owner,
          scope: scope.scope,
          stage,
          classification: outcome.classification,
          reasonCode: outcome.reason.code,
          summary: outcome.reason.what,
          occurrenceAt: this.clock.now(),
        });
      }
    }
    const finalScopes = this.options.persistence.listScopes(session.sessionId);
    const hasAttention = finalScopes.some((scope) =>
      f28IsAttentionClassification(scope.classification),
    );
    const hasRetry = finalScopes.some((scope) =>
      f28IsRetryableClassification(scope.classification),
    );
    const status: F28RecoverySessionRecord["status"] =
      hasAttention || hasRetry ? "PARTIAL" : "COMPLETED";
    const finalized = this.options.persistence.finalizeSession({
      sessionId: session.sessionId,
      status,
      stage: "FINALIZE",
    });
    const projection = this.requireProjection(finalized.sessionId);
    this.emit({
      event: "SESSION_COMPLETED",
      sessionId: finalized.sessionId,
      stage: "FINALIZE",
      reasonCode:
        status === "COMPLETED"
          ? "RECOVERY_COMPLETED"
          : "RECOVERY_ATTENTION_REQUIRED",
      summary:
        status === "COMPLETED"
          ? "Recovery completed with durable evidence."
          : "Recovery preserved one or more scopes for explicit attention or retry.",
      occurrenceAt: this.clock.now(),
    });
    return { session: finalized, projection, coalesced: !created.created };
  }

  private async discoverScopes(
    input: F28RecoveryRequest,
  ): Promise<readonly F28RecoveryScopeInput[]> {
    if (input.scope !== undefined)
      return [f28ScopeInputSchema.parse(input.scope)];
    const scopes: F28RecoveryScopeInput[] = [];
    for (const owner of this.owners) {
      if (owner.listScopes === undefined) continue;
      const listed = await owner.listScopes();
      scopes.push(...listed.slice(0, F28_MAX_SCOPES - scopes.length));
    }
    return scopes;
  }

  private requireProjection(sessionId: string): F28RecoveryProjection {
    const projection = this.options.persistence.readProjection(sessionId);
    if (projection === undefined)
      throw new Error("F28_RECOVERY_PROJECTION_MISSING");
    return projection;
  }

  private emit(event: F28RecoveryActivityEvent): void {
    try {
      this.options.activity?.append({
        ...event,
        summary: event.summary.slice(0, 512),
      });
    } catch {
      // Activity is diagnostic only; the recovery projection remains authoritative.
    }
  }
}
