import { createHash, randomUUID } from "node:crypto";
import {
  createGithubPullRequestIdentity,
  parseGithubPullRequestUrl,
} from "./github-rest-client";
import type { GithubServerProfileRecord } from "./persistence/repositories";
import type {
  GithubPullRequestMetadata,
  GithubPullRequestIdentity,
  GithubRestResult,
} from "../shared/github-rest";
import {
  validateManagedPrPath,
  validateManagedPrUrl,
  validatePrIntentContext,
  validateSyncSourceBranchOverride,
  type AddPrAttemptStatus,
  type ManagedPrAddInput,
  type ManagedPrConfigurationInput,
  type ManagedPrOperationKind,
  type ManagedPrOperationView,
  type ManagedPrReadModel,
  type ManagedPrListView,
  type AddPrAttemptView,
  type ManagedPrReason,
  type ManagedPrCloneInput,
  type ManagedPrRemoteSnapshot,
  type ManagedPrCandidateListView,
  type ManagedPrCandidateView,
  MAX_MANAGED_PR_REASON_BYTES,
} from "../shared/managed-pr";
import type { F07AddAttemptRecord, F07PersistenceRepositories } from "./persistence/f07-repositories";
import { LocalGitInspector } from "./local-git-inspector";

export interface ManagedPrServiceOptions {
  readonly repositories: F07PersistenceRepositories;
  readonly profileForServerId: (
    serverId: string,
  ) => GithubServerProfileRecord | undefined;
  readonly getPullRequest: (input: {
    readonly profile: GithubServerProfileRecord;
    readonly identity: GithubPullRequestIdentity;
    readonly correlationId: string;
    readonly signal?: AbortSignal;
  }) => Promise<GithubRestResult<GithubPullRequestMetadata>>;
  readonly inspector?: LocalGitInspector;
  readonly now?: () => string;
}

export class ManagedPrServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly nextAction: string,
  ) {
    super(message);
    this.name = "ManagedPrServiceError";
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function safeCorrelation(prefix: string): string {
  return `${prefix}-${hash(`${prefix}:${randomUUID()}`)}`;
}

function boundedUtf8(value: string, maximum: number): string {
  let result = "";
  for (const character of value) {
    if (new TextEncoder().encode(result + character).byteLength > maximum) break;
    result += character;
  }
  return result;
}

function safeReason(
  code: string,
  category: ManagedPrReason["category"],
  what: string,
  why: string,
  nextAction: ManagedPrReason["nextAction"],
  correlationId: string,
): ManagedPrReason {
  const boundedWhat = boundedUtf8(what, MAX_MANAGED_PR_REASON_BYTES);
  const boundedWhy = boundedUtf8(why, MAX_MANAGED_PR_REASON_BYTES);
  return {
    code,
    category,
    what: boundedWhat,
    why: boundedWhy,
    nextAction,
    correlationId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(correlationId) ? correlationId : "f07-managed-pr",
  };
}

function statusFromReason(reason: ManagedPrReason): AddPrAttemptStatus {
  if (reason.category === "CANCELLED") return "CANCELLED";
  if (reason.category === "RECOVERY") return "RECOVERY_REQUIRED";
  return "FAILED";
}

function operationFailure(
  kind: ManagedPrOperationKind,
  reason: ManagedPrReason,
  attempt?: F07AddAttemptRecord,
): ManagedPrOperationView {
  return {
    schemaVersion: 1,
    kind,
    status: attempt?.status ?? "FAILED",
    ...(attempt === undefined ? {} : { attempt: publicAttempt(attempt) }),
    reason,
  };
}

function operationFromAttempt(
  kind: ManagedPrOperationKind,
  attempt: F07AddAttemptRecord,
  managedPr: ManagedPrReadModel | undefined,
): ManagedPrOperationView {
  return {
    schemaVersion: 1,
    kind,
    status: attempt.status,
    attempt: publicAttempt(attempt),
    ...(managedPr === undefined ? {} : { managedPr }),
    ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
  };
}

function publicAttempt(attempt: F07AddAttemptRecord): AddPrAttemptView {
  return {
    schemaVersion: 1,
    id: attempt.id,
    correlationId: attempt.correlationId,
    idempotencyKey: attempt.idempotencyKey,
    canonicalPrKey: attempt.canonicalPrKey,
    serverId: attempt.serverId,
    normalizedUrl: attempt.normalizedUrl,
    status: attempt.status,
    ...(attempt.managedPrId === undefined ? {} : { managedPrId: attempt.managedPrId }),
    ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    version: attempt.version,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

function profileIsVerified(profile: GithubServerProfileRecord): boolean {
  return profile.auth?.status === "VERIFIED" && profile.auth.activeRevision !== undefined;
}

function safeTitle(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 16_384) return undefined;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return undefined;
  }
  return value;
}

function remoteSnapshot(
  profile: GithubServerProfileRecord,
  canonicalUrl: string,
  metadata: GithubPullRequestMetadata,
): ManagedPrRemoteSnapshot {
  return {
    schemaVersion: 1,
    canonicalUrl,
    pullRequestKey: metadata.identity.key,
    serverId: profile.serverId,
    server: metadata.identity.server,
    owner: metadata.identity.repository.owner,
    repositoryName: metadata.identity.repository.name,
    number: metadata.number,
    state: metadata.state,
    merged: metadata.merged,
    ...(safeTitle(metadata.title) === undefined ? {} : { title: safeTitle(metadata.title) }),
    baseRepository: metadata.baseRepository,
    headRepository: metadata.headRepository,
    baseBranch: metadata.baseBranch,
    headBranch: metadata.headBranch,
    baseSha: metadata.baseSha,
    headSha: metadata.headSha,
    ...(metadata.defaultBranch === undefined ? {} : { defaultBranch: metadata.defaultBranch }),
  };
}

function reasonFromGithub(
  result: Extract<GithubRestResult<unknown>, { readonly ok: false }>,
  correlationId: string,
): ManagedPrReason {
  const category = result.reason.category;
  const mappedCategory: ManagedPrReason["category"] =
    category === "AUTHENTICATION"
      ? "AUTHENTICATION"
      : category === "AUTHORIZATION"
        ? "AUTHORIZATION"
        : category === "NOT_FOUND"
          ? "NOT_FOUND"
          : category === "RATE_LIMIT"
            ? "RATE_LIMIT"
            : category === "TIMEOUT"
              ? "TIMEOUT"
              : category === "CANCELLED"
                ? "CANCELLED"
                : category === "NETWORK" || category === "TLS"
                  ? "NETWORK"
                  : category === "CONFLICT"
                    ? "CONFLICT"
                    : category === "VALIDATION" || category === "MALFORMED_RESPONSE" || category === "PROTOCOL"
                      ? "VALIDATION"
                      : "UNKNOWN";
  const nextAction: ManagedPrReason["nextAction"] =
    result.reason.nextAction === "REPLACE_ACCESS"
      ? "REPLACE_ACCESS"
      : result.reason.nextAction === "WAIT"
        ? "WAIT"
        : result.reason.nextAction === "FIX_INPUT"
          ? "FIX_INPUT"
          : result.reason.nextAction === "RECONCILE"
            ? "RETRY"
            : "RETRY";
  return safeReason(result.reason.code, mappedCategory, result.reason.message, "The remote metadata request did not produce a validated pull-request snapshot.", nextAction, correlationId);
}

function reasonFromError(error: unknown, correlationId: string): ManagedPrReason {
  if (error instanceof ManagedPrServiceError)
    return safeReason(error.code, "VALIDATION", error.message, "The managed-PR operation was rejected before an unsafe external effect.", error.nextAction as ManagedPrReason["nextAction"], correlationId);
  return safeReason("REMOTE_REQUEST_FAILED", "NETWORK", "The pull-request metadata request could not be completed safely.", "The managed PR was not created and can be retried from the persisted attempt.", "RETRY", correlationId);
}

export class ManagedPrService {
  private readonly inspector: LocalGitInspector;
  private readonly now: () => string;

  public constructor(private readonly options: ManagedPrServiceOptions) {
    this.inspector = options.inspector ?? new LocalGitInspector({ now: options.now });
    this.now = options.now ?? defaultNow;
  }

  public reconcileStartup(): void {
    this.options.repositories.reconcileStartup(
      safeReason("ADD_PR_INTERRUPTED", "RECOVERY", "An Add PR attempt was interrupted before its outcome was durable.", "The attempt is preserved and requires an explicit retry.", "RETRY", "f07-startup-reconcile"),
    );
  }

  public list(): ManagedPrListView {
    return {
      schemaVersion: 1,
      managedPrs: this.options.repositories.listManagedPrs(),
      attempts: this.options.repositories.listAddAttempts().map(publicAttempt),
    };
  }

  public async read(managedPrId: string): Promise<ManagedPrReadModel | undefined> {
    const current = this.options.repositories.getManagedPr(managedPrId);
    if (current === undefined || current.localClone === undefined) return current;
    const inspection = await this.inspector.inspect({
      path: current.localClone.canonicalRoot,
      server: current.baseRepository.server,
      expectedRepository: current.baseRepository,
      correlationId: `f07-read-${hash(managedPrId)}`,
    });
    if (inspection.ok) {
      if (current.localClone.status === inspection.status && current.localClone.cleanState === inspection.cleanState)
        return current;
      return this.options.repositories.updateCloneStatus({
        managedPrId,
        status: inspection.status,
        cleanState: inspection.cleanState,
        validationSnapshot: inspection.validationSnapshot,
      }) ?? current;
    }
    if (current.localSetupStatus === inspection.status) return current;
    return this.options.repositories.updateCloneStatus({
      managedPrId,
      status: inspection.status,
      cleanState: "UNKNOWN",
      validationSnapshot: {
        inspectorVersion: "f07-git-inspector-v1",
        validatedAt: this.now(),
        remoteCount: 0,
        worktreeRoot: current.localClone.canonicalRoot,
      },
      reason: inspection.reason,
    }) ?? current;
  }

  public async add(input: ManagedPrAddInput, signal?: AbortSignal): Promise<ManagedPrOperationView> {
    const requestCorrelationId = safeCorrelation("f07-add");
    const validUrl = validateManagedPrUrl(input.url);
    if (!validUrl.ok) return operationFailure("ADD_PR", safeReason(validUrl.error.code, "VALIDATION", validUrl.error.message, "The Add PR intent was rejected before authentication or network access.", validUrl.error.nextAction, requestCorrelationId));
    const profile = this.options.profileForServerId(input.serverId);
    if (profile === undefined || !profileIsVerified(profile))
      return operationFailure("ADD_PR", safeReason("SERVER_NOT_VERIFIED", "AUTHENTICATION", "The selected GitHub server is not verified for pull-request requests.", "Verify the server profile before adding a PR.", "REPLACE_ACCESS", requestCorrelationId));
    const context = validatePrIntentContext(input.context);
    if (!context.ok) return operationFailure("ADD_PR", safeReason(context.error.code, "VALIDATION", context.error.message, "The Add PR intent was rejected before it was persisted.", context.error.nextAction, requestCorrelationId));
    const override = validateSyncSourceBranchOverride(input.syncSourceBranchOverride);
    if (!override.ok) return operationFailure("ADD_PR", safeReason(override.error.code, "VALIDATION", override.error.message, "The Add PR intent was rejected before it was persisted.", override.error.nextAction, requestCorrelationId));
    const parsed = parseGithubPullRequestUrl(validUrl.value, profile);
    if (!parsed.ok) return operationFailure("ADD_PR", safeReason(parsed.code, "VALIDATION", parsed.message, "The URL was rejected before any credentialed request or durable managed-PR creation.", "FIX_INPUT", requestCorrelationId));
    const identity = createGithubPullRequestIdentity({ server: parsed.value.server, owner: parsed.value.owner, repositoryName: parsed.value.repositoryName, number: parsed.value.number });
    const attemptId = `add-pr-${hash(parsed.value.pullRequestKey)}`;
    const idempotencyKey = `f07-add-${hash(parsed.value.pullRequestKey)}`;
    const correlationId = `f07-add-${hash(parsed.value.pullRequestKey)}`;
    let begun;
    try {
      begun = this.options.repositories.beginAddAttempt({
        attemptId,
        correlationId,
        idempotencyKey,
        canonicalPrKey: parsed.value.pullRequestKey,
        serverId: profile.serverId,
        profileVersion: profile.version,
        normalizedUrl: parsed.value.normalizedUrl,
        parsedInput: parsed.value,
        context: context.value,
        syncSourceBranchOverride: override.value,
      });
    } catch (error) {
      return operationFailure("ADD_PR", reasonFromError(error, correlationId));
    }
    if (!begun.shouldFetch)
      return operationFromAttempt("ADD_PR", begun.attempt, begun.attempt.managedPrId === undefined ? undefined : await this.read(begun.attempt.managedPrId));
    let result: GithubRestResult<GithubPullRequestMetadata>;
    try {
      result = await this.options.getPullRequest({ profile, identity, correlationId, signal });
    } catch (error) {
      const failure = signal?.aborted
        ? safeReason("REQUEST_CANCELLED", "CANCELLED", "The Add PR request was cancelled before metadata was committed.", "The durable add attempt remains retryable and no managed PR was created.", "RETRY", correlationId)
        : reasonFromError(error, correlationId);
      const attempt = this.options.repositories.markAddAttempt(attemptId, { status: statusFromReason(failure), reason: failure, expectedVersion: begun.attempt.version });
      return operationFailure("ADD_PR", failure, attempt);
    }
    if (!result.ok) {
      const failure = reasonFromGithub(result, correlationId);
      const attempt = this.options.repositories.markAddAttempt(attemptId, { status: result.outcome === "UNCERTAIN" ? "RECOVERY_REQUIRED" : statusFromReason(failure), reason: failure, expectedVersion: begun.attempt.version });
      return operationFailure("ADD_PR", failure, attempt);
    }
    if (result.outcome === "NOT_MODIFIED") {
      const failure = safeReason("MALFORMED_RESPONSE", "VALIDATION", "GitHub returned no pull-request metadata for a new managed PR.", "A complete remote snapshot is required before a managed PR can be created.", "RETRY", correlationId);
      const attempt = this.options.repositories.markAddAttempt(attemptId, { status: "FAILED", reason: failure, expectedVersion: begun.attempt.version });
      return operationFailure("ADD_PR", failure, attempt);
    }
    const metadata = result.value;
    if (metadata.identity.key !== parsed.value.pullRequestKey || metadata.baseRepository.key !== identity.repository.key) {
      const failure = safeReason("REMOTE_IDENTITY_MISMATCH", "VALIDATION", "GitHub returned metadata for a different pull request identity.", "The response was rejected and no managed PR was created.", "RETRY", correlationId);
      const attempt = this.options.repositories.markAddAttempt(attemptId, { status: "FAILED", reason: failure, expectedVersion: begun.attempt.version });
      return operationFailure("ADD_PR", failure, attempt);
    }
    let localClone;
    if (input.localClonePath !== undefined) {
      const validPath = validateManagedPrPath(input.localClonePath);
      if (!validPath.ok) {
        const failure = safeReason(validPath.error.code, "LOCAL_PATH", validPath.error.message, "The remote PR was inspected but the local clone selection was not committed.", validPath.error.nextAction, correlationId);
        const attempt = this.options.repositories.markAddAttempt(attemptId, { status: "FAILED", reason: failure, expectedVersion: begun.attempt.version });
        return operationFailure("ADD_PR", failure, attempt);
      }
      const inspected = await this.inspector.inspect({ path: validPath.value, server: metadata.identity.server, expectedRepository: metadata.baseRepository, correlationId });
      if (!inspected.ok) {
        const attempt = this.options.repositories.markAddAttempt(attemptId, { status: "FAILED", reason: inspected.reason, expectedVersion: begun.attempt.version });
        return operationFailure("ADD_PR", inspected.reason, attempt);
      }
      localClone = {
        associationId: `managed-pr-clone-${hash(parsed.value.pullRequestKey)}`,
        status: inspected.status,
        cleanState: inspected.cleanState,
        canonicalRoot: inspected.canonicalRoot,
        repository: inspected.repository,
        validationSnapshot: inspected.validationSnapshot,
        validatedAt: inspected.validationSnapshot.validatedAt,
        version: 1,
      } as const;
    }
    const snapshot = remoteSnapshot(profile, parsed.value.normalizedUrl, metadata);
    const managedPrId = `managed-pr-${hash(parsed.value.pullRequestKey)}`;
    try {
      const managedPr = this.options.repositories.commitManagedPr({
        attemptId,
        managedPrId,
        remote: snapshot,
        primaryState: "WATCHING",
        context: context.value,
        syncSourceBranchOverride: override.value,
        ...(localClone === undefined ? {} : { localClone }),
      });
      return {
        schemaVersion: 1,
        kind: "ADD_PR",
        status: "SUCCEEDED",
        ...(() => {
          const attempt = this.options.repositories.getAddAttempt(attemptId);
          return attempt === undefined ? {} : { attempt: publicAttempt(attempt) };
        })(),
        managedPr,
      };
    } catch {
      const existing = await this.read(managedPrId);
      if (existing !== undefined) {
        const attempt = this.options.repositories.getAddAttempt(attemptId);
        return operationFromAttempt("ADD_PR", attempt ?? begun.attempt, existing);
      }
      const failure = safeReason("ADD_PR_COMMIT_UNCERTAIN", "RECOVERY", "The Add PR commit outcome could not be confirmed.", "Reload the managed-PR list and explicitly retry the persisted attempt.", "RETRY", correlationId);
      let attempt = this.options.repositories.getAddAttempt(attemptId);
      if (attempt?.status === "PENDING") attempt = this.options.repositories.markAddAttempt(attemptId, { status: "RECOVERY_REQUIRED", reason: failure, expectedVersion: attempt.version });
      return operationFailure("ADD_PR", failure, attempt);
    }
  }

  public async retryAdd(attemptId: string, signal?: AbortSignal): Promise<ManagedPrOperationView> {
    const attempt = this.options.repositories.getAddAttempt(attemptId);
    if (attempt === undefined)
      return operationFailure("RETRY_ADD_PR", safeReason("ADD_ATTEMPT_NOT_FOUND", "RECOVERY", "The Add PR attempt no longer exists.", "Refresh the managed-PR list and submit the URL again.", "RELOAD", "f07-retry"));
    const operation = await this.add({ serverId: attempt.serverId, url: attempt.normalizedUrl, context: attempt.context ?? "", syncSourceBranchOverride: attempt.syncSourceBranchOverride ?? "" }, signal);
    return { ...operation, kind: "RETRY_ADD_PR" };
  }

  public async candidates(managedPrId: string): Promise<ManagedPrCandidateListView> {
    const managedPr = await this.read(managedPrId);
    if (managedPr === undefined) throw new ManagedPrServiceError("MANAGED_PR_NOT_FOUND", "The managed PR no longer exists.", "RELOAD");
    const candidates: readonly ManagedPrCandidateView[] = this.options.repositories.listCandidates(managedPr.baseRepository.key).map((candidate) => ({
      schemaVersion: 1 as const,
      canonicalRoot: candidate.canonicalRoot,
      repository: candidate.repository,
      status: candidate.status as ManagedPrCandidateView["status"],
      cleanState: candidate.cleanState as ManagedPrCandidateView["cleanState"],
      ...(candidate.lastValidatedAt === undefined ? {} : { lastValidatedAt: candidate.lastValidatedAt }),
    }));
    return {
      schemaVersion: 1,
      managedPrId,
      candidates,
    };
  }

  public async attachClone(input: ManagedPrCloneInput): Promise<ManagedPrOperationView> {
    // Keep the caller's optimistic version intact while the selected path is
    // inspected. A read refresh must not turn a valid attach into a stale edit.
    const managedPr = this.options.repositories.getManagedPr(input.managedPrId);
    if (managedPr === undefined) return operationFailure("ATTACH_CLONE", safeReason("MANAGED_PR_NOT_FOUND", "RECOVERY", "The managed PR no longer exists.", "Refresh the managed-PR list before attaching a clone.", "RELOAD", "f07-attach"));
    const validPath = validateManagedPrPath(input.path);
    if (!validPath.ok) return operationFailure("ATTACH_CLONE", safeReason(validPath.error.code, "LOCAL_PATH", validPath.error.message, "The clone was not attached.", validPath.error.nextAction, "f07-attach"));
    const inspection = await this.inspector.inspect({ path: validPath.value, server: managedPr.baseRepository.server, expectedRepository: managedPr.baseRepository, correlationId: "f07-attach" });
    if (!inspection.ok) return operationFailure("ATTACH_CLONE", inspection.reason);
    const localClone = {
      associationId: managedPr.localClone?.associationId ?? `managed-pr-clone-${hash(managedPr.pullRequestKey)}`,
      status: inspection.status,
      cleanState: inspection.cleanState,
      canonicalRoot: inspection.canonicalRoot,
      repository: inspection.repository,
      validationSnapshot: inspection.validationSnapshot,
      validatedAt: inspection.validationSnapshot.validatedAt,
      version: (managedPr.localClone?.version ?? 0) + 1,
    } as const;
    try {
      const updated = this.options.repositories.attachClone({ managedPrId: input.managedPrId, expectedVersion: input.expectedVersion, localClone });
      return { schemaVersion: 1, kind: "ATTACH_CLONE", status: "COMPLETED", managedPr: updated };
    } catch (error) {
      return operationFailure("ATTACH_CLONE", reasonFromError(error, "f07-attach"));
    }
  }

  public async clearClone(input: { readonly managedPrId: string; readonly expectedVersion: number }): Promise<ManagedPrOperationView> {
    try {
      const managedPr = this.options.repositories.clearClone(input.managedPrId, input.expectedVersion);
      return { schemaVersion: 1, kind: "CLEAR_CLONE", status: "COMPLETED", managedPr };
    } catch (error) {
      return operationFailure("CLEAR_CLONE", reasonFromError(error, "f07-clear"));
    }
  }

  public async saveConfiguration(input: ManagedPrConfigurationInput): Promise<ManagedPrOperationView> {
    const context = validatePrIntentContext(input.context);
    if (!context.ok) return operationFailure("SAVE_CONFIGURATION", safeReason(context.error.code, "VALIDATION", context.error.message, "The configuration was not saved.", context.error.nextAction, "f07-config"));
    const override = validateSyncSourceBranchOverride(input.syncSourceBranchOverride);
    if (!override.ok) return operationFailure("SAVE_CONFIGURATION", safeReason(override.error.code, "VALIDATION", override.error.message, "The configuration was not saved.", override.error.nextAction, "f07-config"));
    try {
      const managedPr = this.options.repositories.saveConfiguration({ managedPrId: input.managedPrId, expectedVersion: input.expectedVersion, context: context.value, syncSourceBranchOverride: override.value });
      return { schemaVersion: 1, kind: "SAVE_CONFIGURATION", status: "COMPLETED", managedPr };
    } catch (error) {
      return operationFailure("SAVE_CONFIGURATION", reasonFromError(error, "f07-config"));
    }
  }
}

export function createManagedPrService(options: ManagedPrServiceOptions): ManagedPrService {
  return new ManagedPrService(options);
}
