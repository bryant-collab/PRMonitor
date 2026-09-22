import type {
  GithubConditionalMetadata,
  GithubFeedbackCollection,
  GithubFeedbackRecord,
  GithubFeedbackResourceScope,
  GithubPaginationCheckpoint,
  GithubPullRequestIdentity,
  GithubPullRequestMetadata,
  GithubRestResource,
} from "../shared/github-rest";

export const DEFAULT_PR_POLL_INTERVAL_MS = 10 * 60 * 1_000;
export const MIN_PR_POLL_INTERVAL_MS = 60 * 1_000;
export const MAX_PR_POLL_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_PR_POLL_CONCURRENCY = 4;
export const MAX_PR_POLL_CONCURRENCY = 64;
export const DEFAULT_PR_POLL_PAGE_SIZE = 100;
export const DEFAULT_PR_POLL_MAX_PAGES = 100;

export type F10ResourceKind = Extract<
  GithubRestResource,
  "pull_request" | "review_comments" | "reviews" | "issue_comments"
>;

export const F10_RESOURCE_KINDS: readonly F10ResourceKind[] = [
  "pull_request",
  "review_comments",
  "reviews",
  "issue_comments",
];

export interface PollingConfigurationInput {
  readonly intervalMs?: number;
  readonly maxConcurrentResources?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface EffectivePollingConfiguration {
  readonly intervalMs: number;
  readonly maxConcurrentResources: number;
  readonly pageSize: number;
  readonly maxPages: number;
}

export function resolvePollingConfiguration(
  input: PollingConfigurationInput = {},
): EffectivePollingConfiguration {
  const intervalMs = input.intervalMs ?? DEFAULT_PR_POLL_INTERVAL_MS;
  const maxConcurrentResources =
    input.maxConcurrentResources ?? DEFAULT_PR_POLL_CONCURRENCY;
  const pageSize = input.pageSize ?? DEFAULT_PR_POLL_PAGE_SIZE;
  const maxPages = input.maxPages ?? DEFAULT_PR_POLL_MAX_PAGES;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < MIN_PR_POLL_INTERVAL_MS ||
    intervalMs > MAX_PR_POLL_INTERVAL_MS
  )
    throw new Error("F10_INVALID_POLL_INTERVAL");
  if (
    !Number.isSafeInteger(maxConcurrentResources) ||
    maxConcurrentResources < 1 ||
    maxConcurrentResources > MAX_PR_POLL_CONCURRENCY
  )
    throw new Error("F10_INVALID_POLL_CONCURRENCY");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new Error("F10_INVALID_PAGE_SIZE");
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new Error("F10_INVALID_MAX_PAGES");
  return { intervalMs, maxConcurrentResources, pageSize, maxPages };
}

export interface F10PollScope {
  readonly managedPrId: string;
  readonly serverId: string;
  readonly repositoryKey: string;
  readonly pullRequest: GithubPullRequestIdentity;
  readonly resource: F10ResourceKind;
  readonly resourceKey: string;
  readonly feedbackScope?: GithubFeedbackResourceScope;
}

export interface F10ResourceCheckpoint {
  readonly managedPrId: string;
  readonly serverId: string;
  readonly repositoryKey: string;
  readonly resource: F10ResourceKind;
  readonly resourceKey: string;
  readonly conditional?: GithubConditionalMetadata;
  readonly pagination?: GithubPaginationCheckpoint;
  readonly lastCompleteAttemptId?: string;
  readonly lastCompleteAt?: string;
  readonly version: number;
}

export type F10PollResourceStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "NOT_MODIFIED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED"
  | "SKIPPED";

export type F10PollRunStatus =
  "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "INTERRUPTED";

export interface F10PollReason {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly nextAction: string;
  readonly correlationId: string;
}

export interface F10ObservedVersionCandidate {
  readonly eventVersionId: string;
  readonly managedPrId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly remoteIdentity: string;
  readonly semanticHash: string;
  readonly sourceUpdatedAt?: string;
  readonly observedAt: string;
  readonly feedback: GithubFeedbackRecord;
}

export interface F10PollResourceResult {
  readonly attemptId: string;
  readonly pollRunId: string;
  readonly managedPrId: string;
  readonly resource: F10ResourceKind;
  readonly resourceKey: string;
  readonly status: F10PollResourceStatus;
  readonly checkpoint?: F10ResourceCheckpoint;
  readonly currentMetadata?: GithubPullRequestMetadata;
  readonly eventVersionIds: readonly string[];
  readonly newEventVersionIds: readonly string[];
  readonly newVersionCount: number;
  readonly reason?: F10PollReason;
}

export interface F10PollRunResult {
  readonly pollRunId: string;
  readonly correlationId: string;
  readonly status: F10PollRunStatus;
  readonly resources: readonly F10PollResourceResult[];
  readonly newVersionIds: readonly string[];
  readonly newSemanticInputCount: number;
  readonly activityDegraded: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface F10PollResourceAttemptRecord {
  readonly attemptId: string;
  readonly pollRunId: string;
  readonly scope: F10PollScope;
  readonly correlationId: string;
  readonly requestSnapshot: unknown;
  readonly priorCheckpoint: F10ResourceCheckpoint | undefined;
  readonly status: F10PollResourceStatus;
  readonly reason?: F10PollReason;
  readonly eventVersionIds: readonly string[];
  readonly newEventVersionIds: readonly string[];
  readonly newVersionCount: number;
  readonly startedAt: string;
  readonly committedAt?: string;
}

export interface F10PollRunRecord {
  readonly pollRunId: string;
  readonly correlationId: string;
  readonly configuration: EffectivePollingConfiguration;
  readonly status: F10PollRunStatus;
  readonly managedPrCount: number;
  readonly newVersionCount: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly attempts: readonly F10PollResourceAttemptRecord[];
}

export interface F10CurrentMetadataRecord {
  readonly managedPrId: string;
  readonly metadata: GithubPullRequestMetadata;
  readonly observedAt: string;
  readonly attemptId: string;
  readonly version: number;
}

export interface F10PollBeginInput {
  readonly pollRunId: string;
  readonly correlationId: string;
  readonly configuration: EffectivePollingConfiguration;
  readonly scopes: readonly F10PollScope[];
  readonly startedAt: string;
}

export interface F10PollBeginResult {
  readonly run: F10PollRunRecord;
  readonly attempts: readonly F10PollResourceAttemptRecord[];
  readonly skipped: readonly F10PollResourceResult[];
}

export interface F10PollFailureInput {
  readonly attemptId: string;
  readonly status: Extract<
    F10PollResourceStatus,
    "FAILED" | "CANCELLED" | "INTERRUPTED" | "SKIPPED"
  >;
  readonly reason: F10PollReason;
  readonly updatedAt: string;
}

export interface F10PollCommitInput {
  readonly attemptId: string;
  readonly status: Extract<F10PollResourceStatus, "COMPLETED" | "NOT_MODIFIED">;
  readonly conditional?: GithubConditionalMetadata;
  readonly pagination?: GithubPaginationCheckpoint;
  readonly observedAt: string;
  readonly feedback?: GithubFeedbackCollection;
  readonly versions: readonly F10ObservedVersionCandidate[];
  readonly currentMetadata?: GithubPullRequestMetadata;
}
