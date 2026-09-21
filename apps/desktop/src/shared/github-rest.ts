/**
 * Provider-neutral contracts for the F06 GitHub REST boundary.
 *
 * These types deliberately contain repository/ref identities and normalized
 * feedback only. They never contain credentials, provider SDK objects, raw
 * response bodies, or arbitrary URLs supplied by a caller.
 */

import type { GithubServerIdentity } from "./github-server";

export const GITHUB_REST_SCHEMA_VERSION = 1 as const;
export const MAX_GITHUB_PR_URL_BYTES = 2_048;
export const MAX_GITHUB_OWNER_BYTES = 100;
export const MAX_GITHUB_REPOSITORY_BYTES = 100;
export const MAX_GITHUB_BRANCH_BYTES = 512;
export const MAX_GITHUB_PAGE_SIZE = 100;
export const MAX_GITHUB_PAGE_COUNT = 100;
export const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_GITHUB_BODY_BYTES = 256 * 1024;

export type GithubRestResource =
  | "pull_request"
  | "repository"
  | "branch_ref"
  | "review_comments"
  | "reviews"
  | "issue_comments";

export type GithubFeedbackSource =
  "REVIEW_COMMENT" | "REVIEW" | "ISSUE_COMMENT";

export type GithubRestReasonCategory =
  | "VALIDATION"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "RATE_LIMIT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NETWORK"
  | "TLS"
  | "TIMEOUT"
  | "CANCELLED"
  | "REDIRECT"
  | "PROTOCOL"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_SERVER"
  | "UNCERTAIN_MUTATION"
  | "UNKNOWN";

export type GithubRestNextAction =
  | "FIX_INPUT"
  | "REPLACE_ACCESS"
  | "WAIT"
  | "RETRY"
  | "RECONCILE"
  | "REVIEW_ENDPOINT"
  | "CONTACT_ADMIN"
  | "NONE";

export type GithubRestReasonCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_SERVER"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_FAILED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "NETWORK_FAILED"
  | "TLS_FAILED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "REDIRECT_REJECTED"
  | "CROSS_ORIGIN_REDIRECT"
  | "PROTOCOL_ERROR"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "PAGINATION_INCOMPLETE"
  | "PAGINATION_LIMIT_EXCEEDED"
  | "MUTATION_UNCERTAIN"
  | "CAPABILITY_UNAVAILABLE";

export interface GithubRestReason {
  readonly code: GithubRestReasonCode;
  readonly category: GithubRestReasonCategory;
  readonly retryable: boolean;
  readonly message: string;
  readonly nextAction: GithubRestNextAction;
  readonly correlationId: string;
  readonly retryAfterMs?: number;
  readonly rateLimitResetAt?: string;
}

export interface GithubRemoteServerIdentity extends GithubServerIdentity {
  readonly serverKey: string;
}

export interface GithubRepositoryIdentity {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly server: GithubRemoteServerIdentity;
  readonly providerId?: number;
  readonly owner: string;
  readonly name: string;
  readonly key: string;
  readonly available: true;
}

export interface GithubUnavailableRepositoryIdentity {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly server: GithubRemoteServerIdentity;
  readonly providerId?: number;
  readonly owner?: string;
  readonly name?: string;
  readonly key: string;
  readonly available: false;
  readonly reason: "DELETED" | "INACCESSIBLE" | "MISSING_FROM_PAYLOAD";
}

export type GithubAnyRepositoryIdentity =
  GithubRepositoryIdentity | GithubUnavailableRepositoryIdentity;

export interface GithubPullRequestIdentity {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly server: GithubRemoteServerIdentity;
  readonly repository: GithubRepositoryIdentity;
  readonly number: number;
  readonly key: string;
}

export interface GithubBranchRefIdentity {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly server: GithubRemoteServerIdentity;
  readonly repository: GithubRepositoryIdentity;
  readonly name: string;
  readonly key: string;
}

export interface GithubFeedbackResourceScope {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly resource: Exclude<GithubRestResource, "repository" | "branch_ref">;
  readonly pullRequest: GithubPullRequestIdentity;
  readonly key: string;
}

export interface GithubRemoteObjectIdentity {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly source: GithubFeedbackSource;
  readonly resource: GithubFeedbackResourceScope;
  readonly remoteId: string;
  readonly key: string;
}

export interface GithubResponseTarget {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly source: "ISSUE_COMMENT" | "REVIEW_COMMENT_REPLY";
  readonly pullRequest: GithubPullRequestIdentity;
  readonly commentId: string;
  readonly key: string;
}

export interface GithubParsedPullRequestUrl {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly server: GithubRemoteServerIdentity;
  readonly serverId?: string;
  readonly owner: string;
  readonly repositoryName: string;
  readonly repositoryKey: string;
  readonly number: number;
  readonly pullRequestKey: string;
  readonly normalizedUrl: string;
}

export interface GithubRepositoryMetadata {
  readonly identity: GithubRepositoryIdentity;
  readonly defaultBranch?: string;
  readonly isPrivate?: boolean;
  readonly isArchived?: boolean;
}

export type GithubPullRequestState = "OPEN" | "CLOSED";

export interface GithubPullRequestMetadata {
  readonly identity: GithubPullRequestIdentity;
  readonly number: number;
  readonly state: GithubPullRequestState;
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

export interface GithubBranchRef {
  readonly identity: GithubBranchRefIdentity;
  readonly sha: string;
}

export interface GithubPullRequestStateSnapshot {
  readonly identity: GithubPullRequestIdentity;
  readonly state: GithubPullRequestState;
  readonly merged: boolean;
  readonly headSha: string;
  readonly baseSha: string;
}

export interface GithubFeedbackAuthor {
  readonly id?: number;
  readonly login?: string;
  readonly name?: string;
}

export interface GithubFeedbackLocation {
  readonly path?: string;
  readonly line?: number;
  readonly startLine?: number;
  readonly side?: "LEFT" | "RIGHT";
  readonly startSide?: "LEFT" | "RIGHT";
  readonly diffHunk?: string;
  readonly position?: number;
}

export interface GithubFeedbackRecord {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly identity: GithubRemoteObjectIdentity;
  readonly source: GithubFeedbackSource;
  readonly pullRequest: GithubPullRequestIdentity;
  readonly repository: GithubRepositoryIdentity;
  readonly author: GithubFeedbackAuthor;
  readonly body?: string;
  readonly state?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly location?: GithubFeedbackLocation;
  /** Stable, complete input for a later deterministic semantic hash. */
  readonly semanticInput: Readonly<Record<string, unknown>>;
}

export interface GithubConditionalMetadata {
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface GithubPaginationCheckpoint {
  readonly page: number;
  readonly perPage: number;
  readonly nextPage?: number;
  readonly complete: boolean;
}

export interface GithubRequestMetadata {
  readonly schemaVersion: typeof GITHUB_REST_SCHEMA_VERSION;
  readonly correlationId: string;
  readonly resource: GithubRestResource;
  readonly scopeKey: string;
  readonly status: number;
  readonly conditional?: GithubConditionalMetadata;
  readonly pagination?: GithubPaginationCheckpoint;
}

export interface GithubRestUpdated<T> {
  readonly ok: true;
  readonly outcome: "UPDATED";
  readonly value: T;
  readonly metadata: GithubRequestMetadata;
}

export interface GithubRestNotModified {
  readonly ok: true;
  readonly outcome: "NOT_MODIFIED";
  readonly metadata: GithubRequestMetadata;
}

export interface GithubRestFailure {
  readonly ok: false;
  readonly outcome: "FAILED" | "UNCERTAIN";
  readonly reason: GithubRestReason;
  readonly metadata: Omit<GithubRequestMetadata, "status"> & {
    readonly status?: number;
  };
}

export type GithubRestResult<T> =
  GithubRestUpdated<T> | GithubRestNotModified | GithubRestFailure;

export interface GithubFeedbackPage {
  readonly resource: Exclude<GithubRestResource, "repository" | "branch_ref">;
  readonly scope: GithubFeedbackResourceScope;
  readonly items: readonly GithubFeedbackRecord[];
  readonly checkpoint: GithubPaginationCheckpoint;
}

export interface GithubFeedbackCollection {
  readonly resource: Exclude<GithubRestResource, "repository" | "branch_ref">;
  readonly scope: GithubFeedbackResourceScope;
  readonly items: readonly GithubFeedbackRecord[];
  readonly checkpoint: GithubPaginationCheckpoint;
}

export interface GithubApprovedPublicationContext {
  readonly approvalId: string;
  readonly ownerId: string;
  readonly approvedAt: string;
  readonly reviewedSnapshotHash: string;
}

export interface GithubResponsePost {
  readonly target: GithubResponseTarget;
  readonly body: string;
  readonly publication: GithubApprovedPublicationContext;
}

export interface GithubPostedResponse {
  readonly target: GithubResponseTarget;
  readonly remoteId: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface GithubCurrentStateExpectation {
  readonly expectedState?: GithubPullRequestState;
  readonly expectedMerged?: boolean;
  readonly expectedHeadSha?: string;
  readonly expectedBaseSha?: string;
}

export interface GithubCurrentStateVerification {
  readonly current: GithubPullRequestStateSnapshot;
  readonly matches: boolean;
  readonly mismatchFields: readonly (
    "state" | "merged" | "headSha" | "baseSha"
  )[];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validBoundedText(value: string, maximum: number): boolean {
  return (
    value.length > 0 &&
    byteLength(value) <= maximum &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

export function validGithubCorrelationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

export function validateGithubOwner(value: string): boolean {
  return (
    validBoundedText(value, MAX_GITHUB_OWNER_BYTES) &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function validateGithubRepositoryName(value: string): boolean {
  return (
    validBoundedText(value, MAX_GITHUB_REPOSITORY_BYTES) &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function validateGithubBranchName(value: string): boolean {
  return (
    validBoundedText(value, MAX_GITHUB_BRANCH_BYTES) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.includes("@{")
  );
}

export function serverKeyFor(identity: GithubServerIdentity): string {
  return `${identity.kind}:${identity.webOrigin.toLowerCase()}`;
}

export function remoteServerIdentity(
  identity: GithubServerIdentity,
): GithubRemoteServerIdentity {
  return { ...identity, serverKey: serverKeyFor(identity) };
}

export function repositoryKey(
  server: GithubRemoteServerIdentity,
  owner: string,
  name: string,
): string {
  return `${server.serverKey}:repo:${owner.toLowerCase()}/${name.toLowerCase()}`;
}

export function pullRequestKey(
  server: GithubRemoteServerIdentity,
  owner: string,
  name: string,
  number: number,
): string {
  return `${repositoryKey(server, owner, name)}#${number}`;
}

export function createRepositoryIdentity(input: {
  readonly server: GithubRemoteServerIdentity;
  readonly owner: string;
  readonly name: string;
  readonly providerId?: number;
}): GithubRepositoryIdentity {
  if (!validateGithubOwner(input.owner))
    throw new Error("INVALID_GITHUB_OWNER");
  if (!validateGithubRepositoryName(input.name))
    throw new Error("INVALID_GITHUB_REPOSITORY");
  return {
    schemaVersion: GITHUB_REST_SCHEMA_VERSION,
    server: input.server,
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    owner: input.owner,
    name: input.name,
    key: repositoryKey(input.server, input.owner, input.name),
    available: true,
  };
}

export function createPullRequestIdentity(input: {
  readonly server: GithubRemoteServerIdentity;
  readonly repository: GithubRepositoryIdentity;
  readonly number: number;
}): GithubPullRequestIdentity {
  if (!Number.isSafeInteger(input.number) || input.number < 1)
    throw new Error("INVALID_GITHUB_PULL_REQUEST_NUMBER");
  if (input.repository.server.serverKey !== input.server.serverKey)
    throw new Error("GITHUB_SERVER_IDENTITY_MISMATCH");
  return {
    schemaVersion: GITHUB_REST_SCHEMA_VERSION,
    server: input.server,
    repository: input.repository,
    number: input.number,
    key: pullRequestKey(
      input.server,
      input.repository.owner,
      input.repository.name,
      input.number,
    ),
  };
}

export function createBranchRefIdentity(input: {
  readonly repository: GithubRepositoryIdentity;
  readonly name: string;
}): GithubBranchRefIdentity {
  if (!validateGithubBranchName(input.name))
    throw new Error("INVALID_GITHUB_BRANCH");
  return {
    schemaVersion: GITHUB_REST_SCHEMA_VERSION,
    server: input.repository.server,
    repository: input.repository,
    name: input.name,
    key: `${input.repository.key}:heads:${input.name}`,
  };
}

export function createFeedbackResourceScope(input: {
  readonly pullRequest: GithubPullRequestIdentity;
  readonly resource: Exclude<GithubRestResource, "repository" | "branch_ref">;
}): GithubFeedbackResourceScope {
  return {
    schemaVersion: GITHUB_REST_SCHEMA_VERSION,
    resource: input.resource,
    pullRequest: input.pullRequest,
    key: `${input.pullRequest.key}:resource:${input.resource}`,
  };
}

export function createResponseTarget(input: {
  readonly pullRequest: GithubPullRequestIdentity;
  readonly source: GithubResponseTarget["source"];
  readonly commentId: string;
}): GithubResponseTarget {
  if (!/^[1-9][0-9]{0,19}$/u.test(input.commentId))
    throw new Error("INVALID_GITHUB_COMMENT_ID");
  return {
    schemaVersion: GITHUB_REST_SCHEMA_VERSION,
    source: input.source,
    pullRequest: input.pullRequest,
    commentId: input.commentId,
    key: `${input.pullRequest.key}:response:${input.source}:${input.commentId}`,
  };
}

export function isGithubRestReason(value: unknown): value is GithubRestReason {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.retryable === "boolean" &&
    typeof candidate.message === "string" &&
    byteLength(candidate.message) <= 512 &&
    !/(?:token|secret|password|authorization|cookie|api[_.-]?key)/iu.test(
      candidate.message,
    ) &&
    typeof candidate.nextAction === "string" &&
    typeof candidate.correlationId === "string" &&
    validGithubCorrelationId(candidate.correlationId) &&
    (candidate.retryAfterMs === undefined ||
      (typeof candidate.retryAfterMs === "number" &&
        Number.isSafeInteger(candidate.retryAfterMs) &&
        candidate.retryAfterMs >= 0 &&
        candidate.retryAfterMs <= 86_400_000)) &&
    (candidate.rateLimitResetAt === undefined ||
      typeof candidate.rateLimitResetAt === "string")
  );
}
