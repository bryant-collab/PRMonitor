import { createHash, randomUUID } from "node:crypto";
import {
  createFeedbackResourceScope,
  createPullRequestIdentity,
  type GithubFeedbackRecord,
  type GithubRestReason,
  type GithubRestResult,
} from "../shared/github-rest";
import type { ActivityEventInput } from "../shared/activity";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import type {
  GithubReadClient,
  GithubRestReadOptions,
} from "./github-rest-client";
import type { GithubServerProfileRecord } from "./persistence/repositories";
import type { ActivityWriter } from "./activity-service";
import type { F10PersistenceRepositories } from "./persistence/f10-repositories";
import {
  F10_RESOURCE_KINDS,
  resolvePollingConfiguration,
  type EffectivePollingConfiguration,
  type F10ObservedVersionCandidate,
  type F10PollBeginResult,
  type F10PollCommitInput,
  type F10PollFailureInput,
  type F10PollReason,
  type F10PollResourceAttemptRecord,
  type F10PollResourceResult,
  type F10PollRunResult,
  type F10PollScope,
  type PollingConfigurationInput,
} from "./pr-polling-contracts";
import { encodeSnapshot } from "./persistence/codecs";

export interface F10ManagedPrSource {
  readonly listManagedPrs: () => readonly ManagedPrReadModel[];
}

/**
 * The runtime persistence class is intentionally structural here. Keeping the
 * watcher on a narrow port makes the no-network/no-AI contract straightforward
 * to exercise with deterministic fakes while the production instance uses F03
 * SQLite repositories.
 */
export interface PrWatcherPersistence {
  readonly commitsResourceActivityInTransaction?: boolean;
  beginPollRun: (
    input: Parameters<F10PersistenceRepositories["beginPollRun"]>[0],
  ) => F10PollBeginResult;
  startResourceAttempt: (attemptId: string, startedAt: string) => boolean;
  commitResource: (input: F10PollCommitInput) => F10PollResourceResult;
  failResource: (input: F10PollFailureInput) => F10PollResourceResult;
  finalizePollRun: (input: {
    readonly pollRunId: string;
    readonly status: Exclude<F10PollRunResult["status"], "RUNNING">;
    readonly completedAt: string;
  }) => unknown;
  reconcileStartup: (reason: F10PollReason, updatedAt?: string) => void;
  getPollRun: (pollRunId: string) =>
    | {
        readonly attempts: readonly F10PollResourceAttemptRecord[];
      }
    | undefined;
}

export interface PrWatcherOptions {
  readonly managedPrs: F10ManagedPrSource;
  readonly persistence: PrWatcherPersistence;
  readonly githubClientForServer: (
    serverId: string,
  ) => GithubReadClient | undefined;
  readonly profileForServerId?: (
    serverId: string,
  ) => GithubServerProfileRecord | undefined;
  readonly activity?: ActivityWriter;
  readonly clock?: { now(): string };
  readonly polling?: PollingConfigurationInput;
}

interface ActivityState {
  degraded: boolean;
}

function defaultClock(): { now(): string } {
  return { now: () => new Date().toISOString() };
}

function timestamp(clock: { now(): string }): string {
  const value = clock.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    throw new Error("F10_CLOCK_MUST_RETURN_UTC_MILLISECONDS");
  return value;
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeUnicode(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeUnicode);
  if (value === null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("F10_SEMANTIC_INPUT_NOT_PLAIN");
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key.normalize("NFC"), normalizeUnicode(item)]),
  );
}

function semanticExtras(record: GithubFeedbackRecord): Record<string, unknown> {
  const excluded = new Set([
    "source",
    "remoteId",
    "repositoryKey",
    "pullRequestKey",
    "author",
    "body",
    "state",
    "createdAt",
    "updatedAt",
    "location",
    "observedAt",
    "observationTime",
    "transport",
    "headers",
  ]);
  return Object.fromEntries(
    Object.entries(record.semanticInput).filter(([key]) => !excluded.has(key)),
  );
}

function canonicalSemanticInput(record: GithubFeedbackRecord): unknown {
  const location = record.location;
  const author = record.author;
  return normalizeUnicode({
    schemaVersion: 1,
    source: record.source,
    resource: record.identity.resource.resource,
    resourceKey: record.identity.resource.key,
    serverKey: record.identity.resource.pullRequest.server.serverKey,
    repositoryKey: record.repository.key,
    pullRequestKey: record.pullRequest.key,
    remoteId: record.identity.remoteId,
    author: {
      id: author.id ?? null,
      login: author.login ?? null,
      name: author.name ?? null,
    },
    body: record.body ?? null,
    state: record.state ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    location:
      location === undefined
        ? null
        : {
            path: location.path ?? null,
            line: location.line ?? null,
            startLine: location.startLine ?? null,
            side: location.side ?? null,
            startSide: location.startSide ?? null,
            diffHunk: location.diffHunk ?? null,
            position: location.position ?? null,
          },
    extra: semanticExtras(record),
  });
}

export function buildF10ObservedVersion(input: {
  readonly managedPrId: string;
  readonly feedback: GithubFeedbackRecord;
  readonly observedAt: string;
}): F10ObservedVersionCandidate {
  const semantic = encodeSnapshot(canonicalSemanticInput(input.feedback));
  const sourceId = input.feedback.identity.key;
  const eventVersionId = `f10-event-version-${shortHash(
    `${sourceId}|${semantic.payloadHash}`,
  ).slice(0, 32)}`;
  return {
    eventVersionId,
    managedPrId: input.managedPrId,
    sourceKind:
      input.feedback.source === "REVIEW_COMMENT"
        ? "REVIEW_COMMENT"
        : input.feedback.source === "REVIEW"
          ? "REVIEW"
          : "ISSUE_COMMENT",
    sourceId,
    remoteIdentity: input.feedback.identity.key,
    semanticHash: semantic.payloadHash,
    ...(input.feedback.updatedAt === undefined
      ? {}
      : { sourceUpdatedAt: input.feedback.updatedAt }),
    observedAt: input.observedAt,
    feedback: input.feedback,
  };
}

export function pollingScopesForManagedPr(
  managedPr: ManagedPrReadModel,
): readonly F10PollScope[] {
  const pullRequest = createPullRequestIdentity({
    server: managedPr.baseRepository.server,
    repository: managedPr.baseRepository,
    number: managedPr.number,
  });
  return F10_RESOURCE_KINDS.map((resource) => {
    const feedbackScope =
      resource === "pull_request"
        ? undefined
        : createFeedbackResourceScope({ pullRequest, resource });
    return {
      managedPrId: managedPr.id,
      serverId: managedPr.serverId,
      repositoryKey: managedPr.baseRepository.key,
      pullRequest,
      resource,
      resourceKey:
        feedbackScope?.key ?? `${pullRequest.key}:resource:pull_request`,
      ...(feedbackScope === undefined ? {} : { feedbackScope }),
    } satisfies F10PollScope;
  });
}

function failureReason(
  reason: GithubRestReason | undefined,
  fallbackCorrelationId: string,
): F10PollReason {
  if (reason === undefined)
    return {
      code: "POLL_REQUEST_FAILED",
      message: "The GitHub resource request did not complete.",
      retryable: true,
      nextAction: "RETRY",
      correlationId: fallbackCorrelationId,
    };
  return {
    code: reason.code,
    message: reason.message,
    retryable: reason.retryable,
    nextAction: reason.nextAction,
    correlationId: reason.correlationId,
  };
}

function cancelledReason(correlationId: string): F10PollReason {
  return {
    code: "REQUEST_CANCELLED",
    message:
      "The poll resource request was cancelled before its durable commit.",
    retryable: true,
    nextAction: "RETRY",
    correlationId,
  };
}

function interruptedReason(correlationId: string): F10PollReason {
  return {
    code: "POLL_INTERRUPTED",
    message:
      "The poll resource attempt was interrupted before durable completion.",
    retryable: true,
    nextAction: "RETRY",
    correlationId,
  };
}

function genericFailure(message: string, correlationId: string): F10PollReason {
  return {
    code: "POLL_REQUEST_FAILED",
    message,
    retryable: true,
    nextAction: "RETRY",
    correlationId,
  };
}

function resourceStatusFromResult<T>(
  result: GithubRestResult<T>,
): "FAILED" | "CANCELLED" {
  if (
    !result.ok &&
    (result.reason.code === "REQUEST_CANCELLED" ||
      result.reason.category === "CANCELLED")
  )
    return "CANCELLED";
  return "FAILED";
}

function readSource(source: F10ManagedPrSource): readonly ManagedPrReadModel[] {
  const values = source.listManagedPrs();
  if (!Array.isArray(values)) throw new Error("F10_MANAGED_PR_SOURCE_INVALID");
  return values;
}

function asReadOptions(
  attempt: F10PollResourceAttemptRecord,
  profile: GithubServerProfileRecord | undefined,
  signal: AbortSignal | undefined,
): GithubRestReadOptions {
  return {
    ...(profile === undefined ? {} : { profile }),
    serverId: attempt.scope.serverId,
    ...(attempt.priorCheckpoint?.conditional === undefined
      ? {}
      : { conditional: attempt.priorCheckpoint.conditional }),
    correlationId: attempt.correlationId,
    ...(signal === undefined ? {} : { signal }),
  };
}

function completeOutcome(result: F10PollResourceResult): boolean {
  return result.status === "COMPLETED" || result.status === "NOT_MODIFIED";
}

function aggregateStatus(
  results: readonly F10PollResourceResult[],
): Exclude<F10PollRunResult["status"], "RUNNING"> {
  if (results.length === 0) return "COMPLETED";
  if (results.every(completeOutcome)) return "COMPLETED";
  if (results.every((result) => result.status === "CANCELLED"))
    return "CANCELLED";
  if (results.every((result) => result.status === "INTERRUPTED"))
    return "INTERRUPTED";
  if (results.every((result) => result.status === "FAILED")) return "FAILED";
  return "PARTIAL";
}

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function consume(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index]!);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(values.length, 1)) },
      () => consume(),
    ),
  );
  return results;
}

export class PrWatcher {
  public readonly configuration: EffectivePollingConfiguration;
  private readonly clock: { now(): string };
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly inFlight = new Map<string, Promise<F10PollRunResult>>();

  public constructor(private readonly options: PrWatcherOptions) {
    this.configuration = resolvePollingConfiguration(options.polling);
    this.clock = options.clock ?? defaultClock();
  }

  public start(input: { readonly runImmediately?: boolean } = {}): void {
    if (this.running) return;
    this.running = true;
    this.reconcileStartup();
    this.schedule();
    if (input.runImmediately === true) void this.run();
  }

  /** F12 owns the cadence, but F10 still performs its startup recovery. */
  public reconcileStartup(): void {
    try {
      this.options.persistence.reconcileStartup(
        interruptedReason("f10-startup-reconcile"),
        timestamp(this.clock),
      );
    } catch {
      this.appendActivity(
        {
          eventId: "f10-startup-reconcile-failed",
          eventType: "POLL_FAILED",
          stage: "POLLING",
          correlationId: "f10-startup-reconcile",
          operationId: "f10-startup-reconcile",
          occurrenceAt: timestamp(this.clock),
          severity: "ERROR",
          reason: {
            code: "POLL_FAILED",
            what: "Interrupted PR feedback polling could not be reconciled at startup.",
            why: "The durable polling recovery boundary was unavailable.",
            nextAction: "RETRY",
          },
          summary: "PR feedback polling recovery failed",
          details: { recovery: "startup" },
        },
        { degraded: false },
      );
    }
  }

  public stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  public run(signal?: AbortSignal): Promise<F10PollRunResult> {
    return this.runForManagedPrs(undefined, signal);
  }

  /** F12 supplies a durable per-scope cadence; this method keeps F10 scoped. */
  public runForManagedPrs(
    managedPrIds: readonly string[] | undefined,
    signal?: AbortSignal,
  ): Promise<F10PollRunResult> {
    const scope =
      managedPrIds === undefined
        ? "ALL"
        : [...new Set(managedPrIds)].sort().join(",");
    const existing = this.inFlight.get(scope);
    if (existing !== undefined) return existing;
    const execution = this.execute(signal, managedPrIds).finally(() => {
      this.inFlight.delete(scope);
    });
    this.inFlight.set(scope, execution);
    return execution;
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run()
        .catch(() => undefined)
        .finally(() => this.schedule());
    }, this.configuration.intervalMs);
  }

  private async execute(
    signal: AbortSignal | undefined,
    managedPrIds?: readonly string[],
  ): Promise<F10PollRunResult> {
    if (signal?.aborted) throw new Error("F10_POLL_CANCELLED_BEFORE_INTENT");
    const startedAt = timestamp(this.clock);
    const correlationId = identifier("f10-poll");
    const runId = identifier("f10-run");
    const allManagedPrs = readSource(this.options.managedPrs);
    const managedPrScope =
      managedPrIds === undefined ? undefined : new Set(managedPrIds);
    const managedPrs =
      managedPrScope === undefined
        ? allManagedPrs
        : allManagedPrs.filter((managedPr: ManagedPrReadModel) =>
            managedPrScope.has(managedPr.id),
          );
    const scopes = managedPrs.flatMap((managedPr) =>
      pollingScopesForManagedPr(managedPr),
    );
    const begin = this.options.persistence.beginPollRun({
      pollRunId: runId,
      correlationId,
      configuration: this.configuration,
      scopes,
      startedAt,
    });
    const activityState: ActivityState = { degraded: false };
    this.appendActivity(
      {
        eventId: `${runId}-started`,
        eventType: "POLL_STARTED",
        stage: "POLLING",
        correlationId,
        operationId: runId,
        managedPrId: managedPrs.length === 1 ? managedPrs[0]?.id : undefined,
        occurrenceAt: startedAt,
        severity: "INFO",
        reason: {
          code: "POLL_STARTED",
          what: "PR feedback polling started.",
          why: "The main process is checking each managed pull request resource independently.",
          nextAction: "WAIT",
        },
        summary: "PR feedback polling started",
        details: {
          managedPrCount: managedPrs.length,
          resourceAttemptCount: begin.attempts.length,
          skippedCount: begin.skipped.length,
        },
      },
      activityState,
    );

    const results = await boundedMap(
      begin.attempts,
      this.configuration.maxConcurrentResources,
      (attempt) => this.runResourceAttempt(attempt, signal, activityState),
    );
    const allResults = [...begin.skipped, ...results].sort((left, right) =>
      `${left.managedPrId}:${left.resourceKey}`.localeCompare(
        `${right.managedPrId}:${right.resourceKey}`,
      ),
    );
    const status = aggregateStatus(allResults);
    const completedAt = timestamp(this.clock);
    try {
      this.options.persistence.finalizePollRun({
        pollRunId: runId,
        status,
        completedAt,
      });
    } catch {
      activityState.degraded = true;
    }
    const newVersionIds = [
      ...new Set(allResults.flatMap((result) => result.newEventVersionIds)),
    ];
    const result: F10PollRunResult = {
      pollRunId: runId,
      correlationId,
      status,
      resources: allResults,
      newVersionIds,
      newSemanticInputCount: newVersionIds.length,
      activityDegraded: activityState.degraded,
      startedAt,
      completedAt,
    };
    this.appendActivity(
      {
        eventId: `${runId}-completed`,
        eventType: status === "COMPLETED" ? "POLL_COMPLETED" : "POLL_FAILED",
        stage: "POLLING",
        correlationId,
        operationId: runId,
        occurrenceAt: completedAt,
        severity: status === "COMPLETED" ? "INFO" : "WARNING",
        reason: {
          code: status === "COMPLETED" ? "POLL_COMPLETED" : "POLL_FAILED",
          what:
            status === "COMPLETED"
              ? "PR feedback polling completed."
              : "One or more PR feedback resources need another observation attempt.",
          why:
            status === "COMPLETED"
              ? "Every requested resource reached a complete durable outcome."
              : "A resource outcome was failed, cancelled, interrupted, or skipped.",
          nextAction: status === "COMPLETED" ? "NONE" : "RETRY",
        },
        summary:
          status === "COMPLETED"
            ? "PR feedback polling completed"
            : "PR feedback polling needs attention",
        details: {
          status,
          resourceCount: allResults.length,
          newVersionCount: newVersionIds.length,
          activityDegraded: activityState.degraded,
        },
      },
      activityState,
    );
    return {
      ...result,
      activityDegraded: activityState.degraded,
    };
  }

  private async runResourceAttempt(
    attempt: F10PollResourceAttemptRecord,
    signal: AbortSignal | undefined,
    activityState: ActivityState,
  ): Promise<F10PollResourceResult> {
    const startTime = timestamp(this.clock);
    if (signal?.aborted) {
      return this.failAttempt(
        attempt,
        "CANCELLED",
        cancelledReason(attempt.correlationId),
        startTime,
        activityState,
      );
    }
    try {
      if (
        !this.options.persistence.startResourceAttempt(
          attempt.attemptId,
          startTime,
        )
      ) {
        const recovered = this.options.persistence
          .getPollRun(attempt.pollRunId)
          ?.attempts.find(
            (candidate) => candidate.attemptId === attempt.attemptId,
          );
        if (recovered !== undefined && recovered.status !== "PENDING")
          return {
            attemptId: recovered.attemptId,
            pollRunId: recovered.pollRunId,
            managedPrId: recovered.scope.managedPrId,
            resource: recovered.scope.resource,
            resourceKey: recovered.scope.resourceKey,
            status: recovered.status,
            eventVersionIds: recovered.eventVersionIds,
            newEventVersionIds: recovered.newEventVersionIds,
            newVersionCount: recovered.newVersionCount,
            ...(recovered.reason === undefined
              ? {}
              : { reason: recovered.reason }),
          };
      }
    } catch {
      return this.failAttempt(
        attempt,
        "FAILED",
        genericFailure(
          "The poll resource intent could not be claimed before the request.",
          attempt.correlationId,
        ),
        startTime,
        activityState,
      );
    }

    this.appendActivity(
      {
        eventId: `${attempt.attemptId}-started`,
        eventType: "POLL_PROGRESS",
        stage: "POLLING",
        correlationId: attempt.correlationId,
        operationId: attempt.pollRunId,
        managedPrId: attempt.scope.managedPrId,
        occurrenceAt: startTime,
        severity: "DEBUG",
        reason: {
          code: "POLL_PROGRESS",
          what: "A PR feedback resource request started.",
          why: "The resource has its own persisted conditional and pagination scope.",
          nextAction: "WAIT",
        },
        summary: "PR feedback resource request started",
        details: {
          resource: attempt.scope.resource,
          resourceKey: attempt.scope.resourceKey,
        },
      },
      activityState,
    );

    let client: GithubReadClient | undefined;
    try {
      client = this.options.githubClientForServer(attempt.scope.serverId);
    } catch {
      return this.failAttempt(
        attempt,
        "FAILED",
        genericFailure(
          "The GitHub read capability could not be acquired safely.",
          attempt.correlationId,
        ),
        timestamp(this.clock),
        activityState,
      );
    }
    if (client === undefined)
      return this.failAttempt(
        attempt,
        "FAILED",
        {
          code: "GITHUB_CLIENT_UNAVAILABLE",
          message:
            "The configured GitHub server is not ready for a read-only poll.",
          retryable: true,
          nextAction: "RETRY",
          correlationId: attempt.correlationId,
        },
        timestamp(this.clock),
        activityState,
      );

    let profile: GithubServerProfileRecord | undefined;
    try {
      profile = this.options.profileForServerId?.(attempt.scope.serverId);
    } catch {
      return this.failAttempt(
        attempt,
        "FAILED",
        genericFailure(
          "The GitHub server profile could not be read safely.",
          attempt.correlationId,
        ),
        timestamp(this.clock),
        activityState,
      );
    }
    const readOptions = asReadOptions(attempt, profile, signal);
    try {
      if (attempt.scope.resource === "pull_request") {
        const response = await client.getPullRequest({
          ...readOptions,
          identity: attempt.scope.pullRequest,
        });
        if (!response.ok)
          return this.failGithubResult(
            attempt,
            response,
            signal,
            activityState,
          );
        const commitInput: F10PollCommitInput = {
          attemptId: attempt.attemptId,
          status:
            response.outcome === "NOT_MODIFIED" ? "NOT_MODIFIED" : "COMPLETED",
          conditional: response.metadata.conditional,
          pagination: attempt.priorCheckpoint?.pagination,
          observedAt: timestamp(this.clock),
          ...(response.outcome === "UPDATED"
            ? { currentMetadata: response.value }
            : {}),
          versions: [],
        };
        if (signal?.aborted)
          return this.failAttempt(
            attempt,
            "CANCELLED",
            cancelledReason(attempt.correlationId),
            timestamp(this.clock),
            activityState,
          );
        return this.commitAttempt(commitInput, attempt, activityState);
      }

      const feedbackScope = attempt.scope.feedbackScope;
      if (feedbackScope === undefined)
        return this.failAttempt(
          attempt,
          "FAILED",
          genericFailure(
            "The feedback resource scope is missing.",
            attempt.correlationId,
          ),
          timestamp(this.clock),
          activityState,
        );
      const response = await client.getFeedbackCollection({
        ...readOptions,
        scope: feedbackScope,
        page: 1,
        perPage: this.configuration.pageSize,
        maxPages: this.configuration.maxPages,
      });
      if (!response.ok)
        return this.failGithubResult(attempt, response, signal, activityState);
      if (response.outcome === "NOT_MODIFIED") {
        if (signal?.aborted)
          return this.failAttempt(
            attempt,
            "CANCELLED",
            cancelledReason(attempt.correlationId),
            timestamp(this.clock),
            activityState,
          );
        return this.commitAttempt(
          {
            attemptId: attempt.attemptId,
            status: "NOT_MODIFIED",
            conditional: response.metadata.conditional,
            pagination: attempt.priorCheckpoint?.pagination,
            observedAt: timestamp(this.clock),
            versions: [],
          },
          attempt,
          activityState,
        );
      }
      if (!response.value.checkpoint.complete)
        return this.failAttempt(
          attempt,
          "FAILED",
          {
            code: "PAGINATION_INCOMPLETE",
            message:
              "The feedback page sequence did not complete within the bounded handoff.",
            retryable: true,
            nextAction: "RETRY",
            correlationId: attempt.correlationId,
          },
          timestamp(this.clock),
          activityState,
        );
      const observedAt = timestamp(this.clock);
      const versions = response.value.items.map((feedback) =>
        buildF10ObservedVersion({
          managedPrId: attempt.scope.managedPrId,
          feedback,
          observedAt,
        }),
      );
      if (signal?.aborted)
        return this.failAttempt(
          attempt,
          "CANCELLED",
          cancelledReason(attempt.correlationId),
          timestamp(this.clock),
          activityState,
        );
      return this.commitAttempt(
        {
          attemptId: attempt.attemptId,
          status: "COMPLETED",
          conditional: response.metadata.conditional,
          pagination: response.value.checkpoint,
          observedAt,
          feedback: response.value,
          versions,
        },
        attempt,
        activityState,
      );
    } catch {
      return this.failAttempt(
        attempt,
        signal?.aborted ? "CANCELLED" : "FAILED",
        signal?.aborted
          ? cancelledReason(attempt.correlationId)
          : genericFailure(
              "The GitHub resource request could not be completed safely.",
              attempt.correlationId,
            ),
        timestamp(this.clock),
        activityState,
      );
    }
  }

  private async failGithubResult<T>(
    attempt: F10PollResourceAttemptRecord,
    response: GithubRestResult<T>,
    signal: AbortSignal | undefined,
    activityState: ActivityState,
  ): Promise<F10PollResourceResult> {
    const status = signal?.aborted
      ? "CANCELLED"
      : resourceStatusFromResult(response);
    return this.failAttempt(
      attempt,
      status,
      signal?.aborted
        ? cancelledReason(attempt.correlationId)
        : failureReason(
            response.ok ? undefined : response.reason,
            attempt.correlationId,
          ),
      timestamp(this.clock),
      activityState,
    );
  }

  private commitAttempt(
    input: F10PollCommitInput,
    attempt: F10PollResourceAttemptRecord,
    activityState: ActivityState,
  ): F10PollResourceResult {
    if (
      this.options.persistence.commitsResourceActivityInTransaction !== true &&
      this.options.activity !== undefined &&
      !this.appendCommitAuthorizationActivity(input, attempt, activityState)
    )
      return this.failAttempt(
        attempt,
        "FAILED",
        {
          code: "ACTIVITY_UNAVAILABLE",
          message:
            "The structured activity record could not be written before the resource commit.",
          retryable: true,
          nextAction: "RETRY",
          correlationId: attempt.correlationId,
        },
        timestamp(this.clock),
        activityState,
      );
    try {
      const result = this.options.persistence.commitResource(input);
      if (
        this.options.persistence.commitsResourceActivityInTransaction !== true
      )
        this.appendResourceActivity(result, attempt, activityState);
      return result;
    } catch {
      activityState.degraded = true;
      const reconciled = this.options.persistence
        .getPollRun(attempt.pollRunId)
        ?.attempts.find(
          (candidate) => candidate.attemptId === attempt.attemptId,
        );
      if (
        reconciled !== undefined &&
        (reconciled.status === "COMPLETED" ||
          reconciled.status === "NOT_MODIFIED")
      ) {
        const result: F10PollResourceResult = {
          attemptId: reconciled.attemptId,
          pollRunId: reconciled.pollRunId,
          managedPrId: reconciled.scope.managedPrId,
          resource: reconciled.scope.resource,
          resourceKey: reconciled.scope.resourceKey,
          status: reconciled.status,
          eventVersionIds: reconciled.eventVersionIds,
          newEventVersionIds: reconciled.newEventVersionIds,
          newVersionCount: reconciled.newVersionCount,
          ...(reconciled.reason === undefined
            ? {}
            : { reason: reconciled.reason }),
        };
        return result;
      }
      return this.failAttempt(
        attempt,
        "INTERRUPTED",
        interruptedReason(attempt.correlationId),
        timestamp(this.clock),
        activityState,
      );
    }
  }

  private failAttempt(
    attempt: F10PollResourceAttemptRecord,
    status: Extract<
      F10PollResourceResult["status"],
      "FAILED" | "CANCELLED" | "INTERRUPTED" | "SKIPPED"
    >,
    reason: F10PollReason,
    updatedAt: string,
    activityState: ActivityState,
  ): F10PollResourceResult {
    let result: F10PollResourceResult;
    try {
      result = this.options.persistence.failResource({
        attemptId: attempt.attemptId,
        status,
        reason,
        updatedAt,
      });
    } catch {
      result = {
        attemptId: attempt.attemptId,
        pollRunId: attempt.pollRunId,
        managedPrId: attempt.scope.managedPrId,
        resource: attempt.scope.resource,
        resourceKey: attempt.scope.resourceKey,
        status: "INTERRUPTED",
        eventVersionIds: [],
        newEventVersionIds: [],
        newVersionCount: 0,
        reason: interruptedReason(attempt.correlationId),
      };
      activityState.degraded = true;
    }
    if (this.options.persistence.commitsResourceActivityInTransaction !== true)
      this.appendResourceActivity(result, attempt, activityState);
    return result;
  }

  private appendResourceActivity(
    result: F10PollResourceResult,
    attempt: F10PollResourceAttemptRecord,
    activityState: ActivityState,
  ): void {
    const occurredAt = timestamp(this.clock);
    this.appendActivity(
      {
        eventId: `${attempt.attemptId}-finished`,
        eventType:
          result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
            ? "POLL_PROGRESS"
            : "POLL_FAILED",
        stage: "POLLING",
        correlationId: attempt.correlationId,
        operationId: attempt.pollRunId,
        managedPrId: attempt.scope.managedPrId,
        occurrenceAt: occurredAt,
        severity:
          result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
            ? "INFO"
            : "WARNING",
        reason: {
          code:
            result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
              ? "POLL_PROGRESS"
              : "POLL_FAILED",
          what:
            result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
              ? "A PR feedback resource observation committed."
              : "A PR feedback resource observation did not commit.",
          why:
            result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
              ? "The resource checkpoint and immutable observations were handled independently."
              : (result.reason?.message ??
                "The resource remains retryable or needs attention."),
          nextAction:
            result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
              ? "WAIT"
              : "RETRY",
        },
        summary:
          result.status === "COMPLETED" || result.status === "NOT_MODIFIED"
            ? "PR feedback resource observation committed"
            : "PR feedback resource observation failed",
        details: {
          resource: result.resource,
          resourceKey: result.resourceKey,
          status: result.status,
          newVersionCount: result.newVersionCount,
        },
      },
      activityState,
    );
  }

  private appendCommitAuthorizationActivity(
    input: F10PollCommitInput,
    attempt: F10PollResourceAttemptRecord,
    activityState: ActivityState,
  ): boolean {
    return this.appendActivity(
      {
        eventId: `${attempt.attemptId}-commit-authorized`,
        eventType: "POLL_PROGRESS",
        stage: "POLLING",
        correlationId: attempt.correlationId,
        operationId: attempt.pollRunId,
        managedPrId: attempt.scope.managedPrId,
        occurrenceAt: attempt.startedAt,
        severity: "DEBUG",
        reason: {
          code: "POLL_PROGRESS",
          what: "A complete PR feedback resource observation is ready to commit.",
          why: "The bounded F09 diagnostic handoff succeeded before the authoritative resource transaction.",
          nextAction: "WAIT",
        },
        summary: "PR feedback resource observation ready to commit",
        details: {
          resource: attempt.scope.resource,
          resourceKey: attempt.scope.resourceKey,
          outcome: input.status,
          candidateVersionCount: input.versions.length,
        },
      },
      activityState,
    );
  }

  private appendActivity(
    input: ActivityEventInput,
    activityState: ActivityState,
  ): boolean {
    if (this.options.activity === undefined) return true;
    try {
      const result = this.options.activity.append(input);
      const accepted =
        result.outcome === "inserted" || result.outcome === "replayed";
      if (!accepted) activityState.degraded = true;
      return accepted;
    } catch {
      activityState.degraded = true;
      return false;
    }
  }
}
