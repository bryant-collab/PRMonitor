import type {
  GithubBranchRef,
  GithubPullRequestStateSnapshot,
  GithubRestFailure,
  GithubRestResult,
  GithubAnyRepositoryIdentity,
  GithubRepositoryIdentity,
} from "../shared/github-rest";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import type { ManagedPrInboxReadModel } from "../shared/inbox";
import type {
  F24F13ReadinessEvidence,
  F24F16ConfigurationReference,
  F24HandoffRecord,
  F24PreparationAuthorization,
  F24PreparationHandoffResult,
  F24PreparationIntent,
  F24PreparationIntentSnapshot,
  F24Reason,
  F24ResolutionRow,
  F24SelectionCommandInput,
  F24SelectionSession,
  F24SynchronizationConfirmation,
} from "../shared/f24-synchronization";
import {
  applyF24SelectionCommand,
  createF24SelectionSession,
  f24BranchRefIdentity,
  f24EligibleReason,
  f24Fingerprint,
  f24PrepareOnlyMessage,
  f24Reason,
  f24SafeIdentifier,
  resolveF24EffectiveSource,
} from "../shared/f24-synchronization";
import type { F24PersistenceRepositories } from "./persistence/f24-repositories";
import type { GithubReadClient } from "./github-rest-client";

export interface F24InboxPort {
  readonly read: () => ManagedPrInboxReadModel;
}

export interface F24ManagedPrPort {
  readonly getManagedPr: (
    managedPrId: string,
  ) => ManagedPrReadModel | undefined;
}

export interface F24GithubReadPort {
  readonly getReadClient: (serverId: string) => GithubReadClient | undefined;
}

export interface F24F13ReadinessInput {
  readonly operationId: string;
  readonly managedPrId: string;
  readonly sourceRepositoryKey: string;
  readonly destinationRepositoryKey: string;
  readonly sourceBranch: string;
  readonly destinationBranch: string;
  readonly syncSourceSha: string;
  readonly prHeadSha: string;
  readonly developerClonePath?: string;
  readonly developerCloneRepositoryKey?: string;
  readonly worktreeRoot?: string;
  readonly rootRevision?: number;
  readonly correlationId: string;
}

export interface F24F13ReadinessResult {
  readonly ok: boolean;
  readonly rootRevision: number;
  readonly evidenceRevision: string;
  readonly reason?: F24Reason;
}

export interface F24F13ReadinessPort {
  readonly check: (
    input: F24F13ReadinessInput,
  ) => Promise<F24F13ReadinessResult> | F24F13ReadinessResult;
}

export interface F24F16ReferencePort {
  readonly readReference: () => F24F16ConfigurationReference | undefined;
}

export interface F24PreparationHandoffPort {
  readonly accept: (
    authorization: F24PreparationAuthorization,
  ) => Promise<F24PreparationHandoffResult>;
}

export interface F24PersistencePort {
  readonly persistIntent: F24PersistenceRepositories["persistIntent"];
  readonly getPreparationIntent: F24PersistenceRepositories["getPreparationIntent"];
  readonly getPreparationIntentByIdempotencyKey: F24PersistenceRepositories["getPreparationIntentByIdempotencyKey"];
  readonly listPreparationIntents: F24PersistenceRepositories["listPreparationIntents"];
  readonly updateHandoff: F24PersistenceRepositories["updateHandoff"];
}

export interface F24SynchronizationServiceOptions {
  readonly inbox: F24InboxPort;
  readonly managedPrs: F24ManagedPrPort;
  readonly github: F24GithubReadPort;
  readonly f13: F24F13ReadinessPort;
  readonly f16?: F24F16ReferencePort;
  readonly persistence: F24PersistencePort;
  readonly handoff?: F24PreparationHandoffPort;
  readonly now?: () => string;
}

export class F24SynchronizationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly reason: F24Reason,
  ) {
    super(message);
    this.name = "F24SynchronizationError";
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function safeCorrelation(managedPrId: string, suffix: string): string {
  const value = `f24-${managedPrId}-${suffix}`;
  return f24SafeIdentifier(value) ? value : `f24-${suffix}`;
}

function failureOutcome(
  result: GithubRestResult<unknown>,
): "FAILED" | "UNCERTAIN" | "NOT_MODIFIED" | "UPDATED" {
  if (result.ok) return result.outcome;
  return result.outcome;
}

function observation(result: GithubRestResult<unknown>): {
  readonly correlationId: string;
  readonly status?: number;
  readonly outcome: "UPDATED" | "NOT_MODIFIED" | "FAILED" | "UNCERTAIN";
} {
  return {
    correlationId: result.metadata.correlationId,
    ...(result.metadata.status === undefined
      ? {}
      : { status: result.metadata.status }),
    outcome: failureOutcome(result),
  };
}

function failureReason(
  result: GithubRestFailure,
  category: F24Reason["category"],
  code: string,
  what: string,
  correlationId: string,
): F24Reason {
  const mappedCategory: F24Reason["category"] =
    result.reason.category === "AUTHENTICATION"
      ? "AUTHENTICATION"
      : result.reason.category === "AUTHORIZATION"
        ? "AUTHORIZATION"
        : result.reason.category === "RATE_LIMIT"
          ? "RATE_LIMIT"
          : result.reason.category === "NETWORK" ||
              result.reason.category === "TLS"
            ? "NETWORK"
            : result.reason.category === "TIMEOUT"
              ? "TIMEOUT"
              : result.reason.category === "CANCELLED"
                ? "CANCELLED"
                : category;
  const nextAction: F24Reason["nextAction"] =
    mappedCategory === "AUTHENTICATION" || mappedCategory === "AUTHORIZATION"
      ? "OPEN_PR_SETTINGS"
      : mappedCategory === "CANCELLED"
        ? "CLEAR_SELECTION"
        : "RETRY_RESOLUTION";
  return f24Reason({
    code,
    category: mappedCategory,
    what,
    why: result.reason.message,
    nextAction,
    retryable: result.reason.retryable,
    correlationId,
  });
}

function genericReason(
  code: string,
  category: F24Reason["category"],
  what: string,
  why: string,
  nextAction: F24Reason["nextAction"],
  correlationId: string,
  retryable = false,
): F24Reason {
  return f24Reason({
    code,
    category,
    what,
    why,
    nextAction,
    retryable,
    correlationId,
  });
}

function repositoryAvailable(
  repository: GithubAnyRepositoryIdentity,
): repository is GithubRepositoryIdentity {
  return repository.available === true;
}

function rowWithReason(input: {
  readonly managedPr: ManagedPrReadModel;
  readonly projectionRevision: number;
  readonly sourceBranch: string;
  readonly sourceProvenance: F24ResolutionRow["sourceProvenance"];
  readonly reason: F24Reason;
  readonly sourceRepository?: ManagedPrReadModel["baseRepository"];
  readonly destinationRepository?: ManagedPrReadModel["headRepository"];
  readonly observedAt: string;
  readonly observations?: readonly F24ResolutionRow["observations"][number][];
  readonly currentPrState?: F24ResolutionRow["currentPrState"];
  readonly currentPrMerged?: boolean;
  readonly sourceRef?: F24ResolutionRow["sourceRef"];
  readonly destinationRef?: F24ResolutionRow["destinationRef"];
  readonly syncSourceSha?: string;
  readonly prHeadSha?: string;
  readonly f13Readiness?: F24F13ReadinessEvidence;
  readonly operationId?: string;
}): F24ResolutionRow {
  return {
    schemaVersion: 1,
    managedPrId: input.managedPr.id,
    configurationRevisionId: input.managedPr.configuration.revisionId,
    configurationRevision: input.managedPr.configuration.revision,
    inboxProjectionRevision: input.projectionRevision,
    sourceProvenance: input.sourceProvenance,
    syncSourceBranch: input.sourceBranch,
    prHeadBranch: input.managedPr.prHeadBranch,
    sourceRepository: input.sourceRepository ?? input.managedPr.baseRepository,
    destinationRepository:
      input.destinationRepository ?? input.managedPr.headRepository,
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    ...(input.destinationRef === undefined
      ? {}
      : { destinationRef: input.destinationRef }),
    ...(input.currentPrState === undefined
      ? {}
      : { currentPrState: input.currentPrState }),
    ...(input.currentPrMerged === undefined
      ? {}
      : { currentPrMerged: input.currentPrMerged }),
    ...(input.syncSourceSha === undefined
      ? {}
      : { syncSourceSha: input.syncSourceSha }),
    ...(input.prHeadSha === undefined ? {} : { prHeadSha: input.prHeadSha }),
    storedPrBaseSha: input.managedPr.prBaseSha,
    storedPrHeadSha: input.managedPr.prHeadSha,
    observedAt: input.observedAt,
    observationRevision: f24Fingerprint({
      managedPrId: input.managedPr.id,
      observations: input.observations ?? [],
      sourceRef: input.sourceRef?.key,
      destinationRef: input.destinationRef?.key,
      syncSourceSha: input.syncSourceSha,
      prHeadSha: input.prHeadSha,
    }),
    observations: input.observations ?? [],
    ...(input.f13Readiness === undefined
      ? {}
      : { f13Readiness: input.f13Readiness }),
    eligibility:
      input.reason.category === "ELIGIBLE" ? "ELIGIBLE" : "INELIGIBLE",
    reason: input.reason,
    ...(input.operationId === undefined
      ? {}
      : { operationId: input.operationId }),
  };
}

function sourceIdentityMismatch(
  expected: string,
  actual: string,
  correlationId: string,
): F24Reason {
  return genericReason(
    "REMOTE_IDENTITY_MISMATCH",
    "IDENTITY_MISMATCH",
    "A remote ref returned a different identity than requested.",
    `The requested ref ${expected} was observed as ${actual}; PRMonitor will not choose another repository or branch.`,
    "RETRY_RESOLUTION",
    correlationId,
  );
}

function shaMismatch(
  what: string,
  expected: string,
  actual: string,
  correlationId: string,
): F24Reason {
  return genericReason(
    "REMOTE_SHA_MOVED",
    "SHA_MISMATCH",
    what,
    `The stored snapshot expected ${expected}, but the current exact ref is ${actual}. Resolve a fresh visible summary before confirming.`,
    "RETRY_RESOLUTION",
    correlationId,
  );
}

function isSameRepositoryRef(
  expected: { readonly key: string; readonly name: string },
  actual: { readonly key: string; readonly name: string },
): boolean {
  return expected.key === actual.key && expected.name === actual.name;
}

function currentStateValue(
  result: GithubRestResult<GithubPullRequestStateSnapshot>,
): GithubPullRequestStateSnapshot | undefined {
  return result.ok && result.outcome === "UPDATED" ? result.value : undefined;
}

function branchValue(
  result: GithubRestResult<GithubBranchRef>,
): GithubBranchRef | undefined {
  return result.ok && result.outcome === "UPDATED" ? result.value : undefined;
}

function f13Evidence(
  operationId: string,
  result: F24F13ReadinessResult,
  developerCloneRepositoryKey: string | undefined,
): F24F13ReadinessEvidence {
  return {
    schemaVersion: 1,
    ready: result.ok,
    operationId,
    rootRevision: result.rootRevision,
    evidenceRevision: result.evidenceRevision,
    ...(developerCloneRepositoryKey === undefined
      ? {}
      : { developerCloneRepositoryKey }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

export class F24SynchronizationService {
  private selection: F24SelectionSession | undefined;
  private readonly confirmations = new Map<
    string,
    F24SynchronizationConfirmation
  >();
  private readonly now: () => string;

  public constructor(
    private readonly options: F24SynchronizationServiceOptions,
  ) {
    this.now = options.now ?? defaultNow;
  }

  public readSelection(): F24SelectionSession {
    const projection = this.options.inbox.read();
    if (this.selection === undefined)
      this.selection = createF24SelectionSession({
        projection,
        now: this.now(),
      });
    return this.selection;
  }

  public resetSelection(): F24SelectionSession {
    const projection = this.options.inbox.read();
    this.selection = createF24SelectionSession({
      projection,
      now: this.now(),
    });
    this.confirmations.clear();
    return this.selection;
  }

  public applySelection(input: F24SelectionCommandInput): F24SelectionSession {
    const projection = this.options.inbox.read();
    const current = this.readSelection();
    try {
      this.selection = applyF24SelectionCommand(
        current,
        projection,
        input,
        this.now(),
      );
      return this.selection;
    } catch (error) {
      const code =
        error instanceof TypeError ? error.message : "F24_SELECTION_REJECTED";
      const reason = genericReason(
        code,
        "SELECTION_STALE",
        "The synchronization selection was not changed.",
        "The inbox changed or the selected pull request identity is not part of the authoritative projection.",
        "RETRY_RESOLUTION",
        "f24-selection",
        true,
      );
      throw new F24SynchronizationError(code, reason.what, reason);
    }
  }

  public async openSynchronization(): Promise<F24SynchronizationConfirmation> {
    const selection = this.readSelection();
    if (!selection.canOpen)
      throw new F24SynchronizationError(
        "F24_EMPTY_SELECTION",
        "Select at least one managed pull request before opening synchronization.",
        genericReason(
          "EMPTY_SELECTION",
          "SELECTION_STALE",
          "No pull requests are selected.",
          "Synchronization preparation has no target scope.",
          "CLEAR_SELECTION",
          "f24-selection",
        ),
      );
    const projection = this.options.inbox.read();
    if (projection.version !== selection.projectionRevision)
      throw new F24SynchronizationError(
        "F24_SELECTION_PROJECTION_STALE",
        "The inbox changed before synchronization could be resolved. Read the current inbox and select again.",
        genericReason(
          "SELECTION_PROJECTION_STALE",
          "SELECTION_STALE",
          "The selected inbox snapshot is stale.",
          "A synchronization summary must name the current managed pull-request identities.",
          "RETRY_RESOLUTION",
          "f24-selection",
          true,
        ),
      );
    return this.resolveSelection(
      selection.selectedManagedPrIds,
      selection.version,
      selection.projectionRevision,
    );
  }

  /**
   * F27 uses the same exact resolver for a single-result re-evaluation.  This
   * deliberately stops at an F24 preparation authorization; F25 remains the
   * only downstream handoff and the old result is never rewritten.
   */
  public async resolveForReevaluation(
    managedPrId: string,
  ): Promise<F24PreparationAuthorization> {
    const projection = this.options.inbox.read();
    const confirmation = await this.resolveSelection(
      [managedPrId],
      0,
      projection.version,
    );
    if (!confirmation.confirmEnabled || confirmation.rows.length !== 1) {
      const row = confirmation.rows[0];
      throw new F24SynchronizationError(
        "F24_REEVALUATION_NOT_ELIGIBLE",
        "The current pull-request identity is not eligible for re-evaluation.",
        row?.reason ??
          genericReason(
            "REEVALUATION_NOT_ELIGIBLE",
            "NO_ELIGIBLE",
            "The current synchronization target is not eligible.",
            "F27 preserves the old result and will not guess a replacement source, repository, branch, or SHA.",
            "RETRY_RESOLUTION",
            safeCorrelation(managedPrId, "reevaluation"),
          ),
      );
    }
    const snapshot = this.createIntentSnapshot(confirmation);
    const existing =
      this.options.persistence.getPreparationIntentByIdempotencyKey(
        snapshot.idempotencyKey,
      );
    const intent =
      existing ??
      this.options.persistence.persistIntent({
        snapshot,
        handoff: {
          status: "PENDING",
          authorizationId: `f24-auth-${f24Fingerprint(snapshot.intentId)}`,
          updatedAt: snapshot.createdAt,
        },
      });
    return this.authorizationFor(intent);
  }

  private async resolveSelection(
    selectedManagedPrIds: readonly string[],
    selectionSessionVersion: number,
    projectionRevision: number,
  ): Promise<F24SynchronizationConfirmation> {
    const f16Configuration = this.options.f16?.readReference();
    const rows = await Promise.all(
      selectedManagedPrIds.map((managedPrId) =>
        this.resolveManagedPr(
          managedPrId,
          projectionRevision,
          f16Configuration,
        ),
      ),
    );
    const eligibleCount = rows.filter(
      (row) => row.eligibility === "ELIGIBLE",
    ).length;
    const resolutionRevision = f24Fingerprint({
      projectionRevision,
      selectedManagedPrIds,
      rows,
      f16Configuration,
    });
    const confirmation: F24SynchronizationConfirmation = {
      schemaVersion: 1,
      kind: "synchronization-confirmation",
      selectionSessionVersion,
      inboxProjectionRevision: projectionRevision,
      resolutionRevision,
      generatedAt: this.now(),
      selectedCount: rows.length,
      eligibleCount,
      ineligibleCount: rows.length - eligibleCount,
      rows,
      confirmEnabled: eligibleCount > 0,
      prepareOnly: true,
      prepareOnlyMessage: f24PrepareOnlyMessage(),
      ...(f16Configuration === undefined ? {} : { f16Configuration }),
    };
    this.confirmations.set(resolutionRevision, confirmation);
    while (this.confirmations.size > 16) {
      const oldest = this.confirmations.keys().next().value;
      if (oldest === undefined) break;
      this.confirmations.delete(oldest);
    }
    return confirmation;
  }

  private async resolveManagedPr(
    managedPrId: string,
    projectionRevision: number,
    f16Configuration: F24F16ConfigurationReference | undefined,
  ): Promise<F24ResolutionRow> {
    const managedPr = this.options.managedPrs.getManagedPr(managedPrId);
    const observedAt = this.now();
    if (managedPr === undefined) {
      return rowWithReason({
        managedPr: {
          // This object is never exposed as an F07 read model; it only gives
          // the bounded row a stable identity when the card disappeared.
          id: managedPrId,
          schemaVersion: 1,
          canonicalUrl: "missing",
          pullRequestKey: `missing:${managedPrId}`,
          serverId: "missing-server",
          owner: "missing",
          repositoryName: "missing",
          number: 1,
          state: "OPEN",
          merged: false,
          baseRepository: {
            schemaVersion: 1,
            server: {
              kind: "GITHUB_COM",
              webOrigin: "missing",
              apiBaseUrl: "missing",
              host: "missing",
              serverKey: "missing-server",
            },
            owner: "missing",
            name: "missing",
            key: "missing:repo:missing/missing",
            available: true,
          },
          headRepository: {
            schemaVersion: 1,
            server: {
              kind: "GITHUB_COM",
              webOrigin: "missing",
              apiBaseUrl: "missing",
              host: "missing",
              serverKey: "missing-server",
            },
            owner: "missing",
            name: "missing",
            key: "missing:repo:missing/missing",
            available: true,
          },
          prBaseBranch: "missing",
          prHeadBranch: "missing",
          prBaseSha: "0000000",
          prHeadSha: "0000000",
          primaryState: "WATCHING",
          localSetupStatus: "LOCAL_CLONE_REQUIRED",
          configuration: {
            revisionId: `missing-${managedPrId}`,
            revision: 1,
            context: null,
            syncSourceBranchOverride: null,
            contentHash: "0".repeat(64),
            source: "ADD_PR",
            createdAt: observedAt,
          },
          version: 1,
          createdAt: observedAt,
          updatedAt: observedAt,
        },
        projectionRevision,
        sourceBranch: "missing",
        sourceProvenance: "PR_BASE_BRANCH",
        observedAt,
        reason: genericReason(
          "MANAGED_PR_NOT_FOUND",
          "UNKNOWN_MANAGED_PR",
          "The selected pull request is no longer managed.",
          "The authoritative inbox identity could not be read from F07.",
          "RETRY_RESOLUTION",
          "f24-missing",
          true,
        ),
      });
    }
    const effectiveSource = resolveF24EffectiveSource({
      syncSourceBranchOverride:
        managedPr.configuration.syncSourceBranchOverride,
      prBaseBranch: managedPr.prBaseBranch,
    });
    if (!effectiveSource.ok)
      return rowWithReason({
        managedPr,
        projectionRevision,
        sourceBranch: managedPr.prBaseBranch || "invalid",
        sourceProvenance: "PR_BASE_BRANCH",
        observedAt,
        reason: genericReason(
          "SOURCE_BRANCH_INVALID",
          "CONFIGURATION_INVALID",
          "The synchronization source branch is invalid.",
          "F24 can use only the saved branch override or the explicit pull-request base branch.",
          "OPEN_PR_SETTINGS",
          safeCorrelation(managedPr.id, "config"),
        ),
      });

    const sourceRepository = managedPr.baseRepository;
    const destinationRepository = managedPr.headRepository;
    const correlationId = safeCorrelation(managedPr.id, "remote");
    if (!repositoryAvailable(sourceRepository))
      return rowWithReason({
        managedPr,
        projectionRevision,
        sourceBranch: effectiveSource.branch,
        sourceProvenance: effectiveSource.provenance,
        observedAt,
        reason: genericReason(
          "SOURCE_REPOSITORY_UNAVAILABLE",
          "SOURCE_REPOSITORY_UNAVAILABLE",
          "The source repository is unavailable.",
          "Synchronization requires the explicit pull-request base repository; F24 will not guess another repository.",
          "RETRY_RESOLUTION",
          correlationId,
          true,
        ),
      });
    if (!repositoryAvailable(destinationRepository))
      return rowWithReason({
        managedPr,
        projectionRevision,
        sourceBranch: effectiveSource.branch,
        sourceProvenance: effectiveSource.provenance,
        observedAt,
        reason: genericReason(
          "DESTINATION_REPOSITORY_UNAVAILABLE",
          "DESTINATION_REPOSITORY_UNAVAILABLE",
          "The destination pull-request repository is unavailable.",
          "The explicit head repository is missing, deleted, or inaccessible; F24 will not select a same-named repository.",
          "RETRY_RESOLUTION",
          correlationId,
          true,
        ),
      });

    const client = this.options.github.getReadClient(managedPr.serverId);
    if (client === undefined)
      return rowWithReason({
        managedPr,
        projectionRevision,
        sourceBranch: effectiveSource.branch,
        sourceProvenance: effectiveSource.provenance,
        observedAt,
        reason: genericReason(
          "GITHUB_READ_CLIENT_UNAVAILABLE",
          "AUTHENTICATION",
          "The verified GitHub read connection is unavailable.",
          "F24 cannot resolve exact current refs without the deterministic F06 read boundary.",
          "OPEN_PR_SETTINGS",
          correlationId,
          true,
        ),
      });

    const pullRequestIdentity = {
      schemaVersion: 1 as const,
      server: sourceRepository.server,
      repository: sourceRepository,
      number: managedPr.number,
      key: managedPr.pullRequestKey,
    };
    const sourceRef = f24BranchRefIdentity(
      sourceRepository,
      effectiveSource.branch,
    );
    const destinationRef = f24BranchRefIdentity(
      destinationRepository,
      managedPr.prHeadBranch,
    );
    let stateResult: GithubRestResult<GithubPullRequestStateSnapshot>;
    let sourceResult: GithubRestResult<GithubBranchRef>;
    let destinationResult: GithubRestResult<GithubBranchRef>;
    try {
      [stateResult, sourceResult, destinationResult] = await Promise.all([
        client.getPullRequestState({
          serverId: managedPr.serverId,
          identity: pullRequestIdentity,
          correlationId: `${correlationId}-pr`,
        }),
        client.getBranchRef({
          serverId: managedPr.serverId,
          ref: sourceRef,
          correlationId: `${correlationId}-source`,
        }),
        client.getBranchRef({
          serverId: managedPr.serverId,
          ref: destinationRef,
          correlationId: `${correlationId}-destination`,
        }),
      ]);
    } catch {
      return rowWithReason({
        managedPr,
        projectionRevision,
        sourceBranch: effectiveSource.branch,
        sourceProvenance: effectiveSource.provenance,
        sourceRepository,
        destinationRepository,
        observedAt,
        reason: genericReason(
          "REMOTE_READ_THROWN",
          "REMOTE_READ_FAILED",
          "The current pull-request or branch refs could not be read.",
          "The read provider did not return a typed result; F24 refuses to use cached or implicit repository data.",
          "RETRY_RESOLUTION",
          correlationId,
          true,
        ),
      });
    }
    const observations = [
      observation(stateResult),
      observation(sourceResult),
      observation(destinationResult),
    ];
    const state = currentStateValue(stateResult);
    const source = branchValue(sourceResult);
    const destination = branchValue(destinationResult);
    const common = {
      managedPr,
      projectionRevision,
      sourceBranch: effectiveSource.branch,
      sourceProvenance: effectiveSource.provenance,
      sourceRepository,
      destinationRepository,
      observedAt,
      observations,
      ...(state === undefined ? {} : { currentPrState: state.state }),
      ...(state === undefined ? {} : { currentPrMerged: state.merged }),
      ...(source === undefined ? {} : { sourceRef: source.identity }),
      ...(destination === undefined
        ? {}
        : { destinationRef: destination.identity }),
      ...(source === undefined ? {} : { syncSourceSha: source.sha }),
      ...(destination === undefined ? {} : { prHeadSha: destination.sha }),
    } as const;

    if (!stateResult.ok || state === undefined)
      return rowWithReason({
        ...common,
        reason: !stateResult.ok
          ? failureReason(
              stateResult,
              "REMOTE_READ_FAILED",
              "PR_STATE_READ_FAILED",
              "The current pull-request state could not be read.",
              correlationId,
            )
          : genericReason(
              "PR_STATE_NOT_AVAILABLE",
              "REMOTE_READ_FAILED",
              "The current pull-request state was not returned.",
              "F24 cannot authorize preparation from cached state.",
              "RETRY_RESOLUTION",
              correlationId,
              true,
            ),
      });
    if (state.identity.key !== pullRequestIdentity.key)
      return rowWithReason({
        ...common,
        reason: sourceIdentityMismatch(
          pullRequestIdentity.key,
          state.identity.key,
          correlationId,
        ),
      });
    if (state.state !== "OPEN")
      return rowWithReason({
        ...common,
        reason: genericReason(
          "PR_CLOSED",
          "PR_CLOSED",
          "The pull request is closed.",
          "F24 prepares only open pull-request branch synchronizations.",
          "RETRY_RESOLUTION",
          correlationId,
        ),
      });
    if (state.merged)
      return rowWithReason({
        ...common,
        reason: genericReason(
          "PR_MERGED",
          "PR_MERGED",
          "The pull request is already merged.",
          "A merged pull request is not a synchronization target.",
          "NONE",
          correlationId,
        ),
      });
    if (!sourceResult.ok || source === undefined)
      return rowWithReason({
        ...common,
        reason: !sourceResult.ok
          ? failureReason(
              sourceResult,
              "SOURCE_REF_UNAVAILABLE",
              "SOURCE_REF_READ_FAILED",
              "The current source branch ref could not be read.",
              correlationId,
            )
          : genericReason(
              "SOURCE_REF_NOT_AVAILABLE",
              "SOURCE_REF_UNAVAILABLE",
              "The current source branch ref was not returned.",
              "F24 will not substitute the repository default branch or a same-named ref.",
              "RETRY_RESOLUTION",
              correlationId,
              true,
            ),
      });
    if (!destinationResult.ok || destination === undefined)
      return rowWithReason({
        ...common,
        reason: !destinationResult.ok
          ? failureReason(
              destinationResult,
              "DESTINATION_REF_UNAVAILABLE",
              "DESTINATION_REF_READ_FAILED",
              "The current destination branch ref could not be read.",
              correlationId,
            )
          : genericReason(
              "DESTINATION_REF_NOT_AVAILABLE",
              "DESTINATION_REF_UNAVAILABLE",
              "The current destination branch ref was not returned.",
              "F24 requires the explicit pull-request head repository and branch.",
              "RETRY_RESOLUTION",
              correlationId,
              true,
            ),
      });
    if (
      !isSameRepositoryRef(sourceRef, source.identity) ||
      !isSameRepositoryRef(destinationRef, destination.identity)
    )
      return rowWithReason({
        ...common,
        reason: sourceIdentityMismatch(
          `${sourceRef.key} and ${destinationRef.key}`,
          `${source.identity.key} and ${destination.identity.key}`,
          correlationId,
        ),
      });
    if (destination.sha !== state.headSha)
      return rowWithReason({
        ...common,
        reason: shaMismatch(
          "The destination branch and pull-request head disagree.",
          state.headSha,
          destination.sha,
          correlationId,
        ),
      });
    if (
      effectiveSource.provenance === "PR_BASE_BRANCH" &&
      source.sha !== state.baseSha
    )
      return rowWithReason({
        ...common,
        reason: shaMismatch(
          "The source base branch and pull-request base disagree.",
          state.baseSha,
          source.sha,
          correlationId,
        ),
      });
    if (destination.sha !== managedPr.prHeadSha)
      return rowWithReason({
        ...common,
        reason: shaMismatch(
          "The pull-request head moved after its managed snapshot.",
          managedPr.prHeadSha,
          destination.sha,
          correlationId,
        ),
      });
    if (
      effectiveSource.provenance === "PR_BASE_BRANCH" &&
      source.sha !== managedPr.prBaseSha
    )
      return rowWithReason({
        ...common,
        reason: shaMismatch(
          "The pull-request base moved after its managed snapshot.",
          managedPr.prBaseSha,
          source.sha,
          correlationId,
        ),
      });

    const operationId = `sync-prep-${f24Fingerprint({
      managedPrId: managedPr.id,
      configurationRevision: managedPr.configuration.revision,
      sourceBranch: effectiveSource.branch,
      sourceSha: source.sha,
      destinationSha: destination.sha,
    })}`;
    const readinessInput: F24F13ReadinessInput = {
      operationId,
      managedPrId: managedPr.id,
      sourceRepositoryKey: sourceRepository.key,
      destinationRepositoryKey: destinationRepository.key,
      sourceBranch: effectiveSource.branch,
      destinationBranch: managedPr.prHeadBranch,
      syncSourceSha: source.sha,
      prHeadSha: destination.sha,
      ...(managedPr.localClone?.canonicalRoot === undefined
        ? {}
        : { developerClonePath: managedPr.localClone.canonicalRoot }),
      ...(managedPr.localClone?.repository.key === undefined
        ? {}
        : { developerCloneRepositoryKey: managedPr.localClone.repository.key }),
      ...(f16Configuration?.worktreeRootRevision === undefined
        ? {}
        : { rootRevision: f16Configuration.worktreeRootRevision }),
      correlationId,
    };
    let readiness: F24F13ReadinessResult;
    try {
      readiness = await this.options.f13.check(readinessInput);
    } catch {
      readiness = {
        ok: false,
        rootRevision: readinessInput.rootRevision ?? 0,
        evidenceRevision: f24Fingerprint({ operationId, outcome: "THREW" }),
        reason: genericReason(
          "F13_READINESS_UNAVAILABLE",
          "F13_NOT_READY",
          "Synchronization worktree readiness could not be checked.",
          "F24 cannot authorize preparation without a typed F13 readiness result.",
          "RETRY_RESOLUTION",
          correlationId,
          true,
        ),
      };
    }
    const evidence = f13Evidence(
      operationId,
      readiness,
      readinessInput.developerCloneRepositoryKey,
    );
    if (!readiness.ok)
      return rowWithReason({
        ...common,
        f13Readiness: evidence,
        operationId,
        reason:
          readiness.reason ??
          genericReason(
            "F13_NOT_READY",
            "F13_NOT_READY",
            "The synchronization worktree is not ready.",
            "F13 did not approve the operation-owned preparation boundary.",
            "RETRY_RESOLUTION",
            correlationId,
            true,
          ),
      });
    return rowWithReason({
      ...common,
      f13Readiness: evidence,
      operationId,
      reason: f24EligibleReason(correlationId),
    });
  }

  public async confirmPreparation(input: {
    readonly resolutionRevision: string;
    readonly actor?: "USER";
  }): Promise<F24PreparationIntent> {
    const existingConfirmation = this.confirmations.get(
      input.resolutionRevision,
    );
    if (existingConfirmation === undefined)
      throw new F24SynchronizationError(
        "F24_STALE_SUMMARY",
        "The synchronization summary is no longer available. Resolve the current selection again.",
        genericReason(
          "STALE_SUMMARY",
          "STALE_SUMMARY",
          "The synchronization summary is stale or belongs to another renderer session.",
          "F24 never refreshes a confirmation invisibly.",
          "RETRY_RESOLUTION",
          "f24-confirm",
          true,
        ),
      );
    const snapshot = this.createIntentSnapshot(existingConfirmation);
    const existing =
      this.options.persistence.getPreparationIntentByIdempotencyKey(
        snapshot.idempotencyKey,
      );
    if (existing !== undefined) return existing;
    const currentSelection = this.readSelection();
    const currentProjection = this.options.inbox.read();
    if (
      currentProjection.version !==
        existingConfirmation.inboxProjectionRevision ||
      currentSelection.version !== existingConfirmation.selectionSessionVersion
    )
      throw new F24SynchronizationError(
        "F24_STALE_SUMMARY",
        "The inbox selection changed before confirmation. Resolve a new visible summary.",
        genericReason(
          "STALE_SUMMARY",
          "STALE_SUMMARY",
          "The confirmation inputs are no longer current.",
          "The inbox projection or transient selection changed after resolution.",
          "RETRY_RESOLUTION",
          "f24-confirm",
          true,
        ),
      );

    const revalidated = await this.resolveSelection(
      currentSelection.selectedManagedPrIds,
      currentSelection.version,
      currentProjection.version,
    );
    if (
      revalidated.resolutionRevision !== existingConfirmation.resolutionRevision
    )
      throw new F24SynchronizationError(
        "F24_STALE_SUMMARY",
        "Remote or managed pull-request state changed before confirmation. Review the new visible summary.",
        genericReason(
          "REMOTE_SNAPSHOT_CHANGED",
          "STALE_SUMMARY",
          "The remote synchronization snapshot changed.",
          "F24 rejected the old summary instead of silently authorizing different repository, ref, or SHA inputs.",
          "RETRY_RESOLUTION",
          "f24-confirm",
          true,
        ),
      );
    if (!existingConfirmation.confirmEnabled)
      throw new F24SynchronizationError(
        "F24_NO_ELIGIBLE_PR",
        "No selected pull request is eligible for preparation.",
        genericReason(
          "NO_ELIGIBLE_PR",
          "NO_ELIGIBLE",
          "No selected pull request can be prepared.",
          "The summary retains every skipped row and its actionable reason; an empty preparation batch is not created.",
          "RETRY_RESOLUTION",
          "f24-confirm",
        ),
      );
    const authorizationId = `f24-auth-${f24Fingerprint(snapshot.intentId)}`;
    const initialHandoff: F24HandoffRecord = {
      status: "PENDING",
      authorizationId,
      updatedAt: snapshot.createdAt,
    };
    const persisted = this.options.persistence.persistIntent({
      snapshot,
      handoff: initialHandoff,
    });
    if (persisted.snapshot.idempotencyKey !== snapshot.idempotencyKey)
      return persisted;
    if (this.options.handoff === undefined) return persisted;
    return this.performHandoff(persisted);
  }

  private createIntentSnapshot(
    confirmation: F24SynchronizationConfirmation,
  ): F24PreparationIntentSnapshot {
    const eligibleRows = confirmation.rows.filter(
      (row) => row.eligibility === "ELIGIBLE",
    );
    const ineligibleRows = confirmation.rows.filter(
      (row) => row.eligibility === "INELIGIBLE",
    );
    const scopeKey = f24Fingerprint({
      managedPrIds: confirmation.rows.map((row) => row.managedPrId).sort(),
    });
    const idempotencyKey = f24Fingerprint({
      scopeKey,
      resolutionRevision: confirmation.resolutionRevision,
    });
    const intentId = `f24-intent-${f24Fingerprint(idempotencyKey)}`;
    return {
      schemaVersion: 1,
      intentId,
      idempotencyKey,
      scopeKey,
      resolutionRevision: confirmation.resolutionRevision,
      selectionSessionVersion: confirmation.selectionSessionVersion,
      inboxProjectionRevision: confirmation.inboxProjectionRevision,
      selectedManagedPrIds: confirmation.rows.map((row) => row.managedPrId),
      rows: confirmation.rows,
      eligibleRows,
      ineligibleRows,
      ...(confirmation.f16Configuration === undefined
        ? {}
        : { f16Configuration: confirmation.f16Configuration }),
      actor: "USER",
      correlationId: `f24-confirm-${f24Fingerprint(confirmation.resolutionRevision)}`,
      createdAt: confirmation.generatedAt,
    };
  }

  private authorizationFor(
    intent: F24PreparationIntent,
  ): F24PreparationAuthorization {
    return {
      schemaVersion: 1,
      kind: "SynchronizationPreparationAuthorization",
      intentId: intent.snapshot.intentId,
      idempotencyKey: intent.snapshot.idempotencyKey,
      resolutionRevision: intent.snapshot.resolutionRevision,
      createdAt: intent.snapshot.createdAt,
      eligible: intent.snapshot.eligibleRows,
      skippedManagedPrIds: intent.snapshot.ineligibleRows.map(
        (row) => row.managedPrId,
      ),
      skipped: intent.snapshot.ineligibleRows,
      preparationOnly: true,
      capabilities: {
        prepareWorktree: true,
        commit: false,
        push: false,
        githubWrite: false,
        aiProvider: false,
        publication: false,
        conversationResolution: false,
      },
    };
  }

  private async performHandoff(
    intent: F24PreparationIntent,
  ): Promise<F24PreparationIntent> {
    const authorization = this.authorizationFor(intent);
    try {
      const result = await this.options.handoff!.accept(authorization);
      if (result.status === "ACKNOWLEDGED")
        return this.options.persistence.updateHandoff({
          intentId: intent.snapshot.intentId,
          expectedVersion: intent.version,
          status: "ACKNOWLEDGED",
          authorizationId:
            result.authorizationId ?? intent.handoff.authorizationId,
        });
      const reason =
        result.reason ??
        genericReason(
          "F25_HANDOFF_FAILED",
          "HANDOFF",
          "Preparation was recorded but the downstream handoff failed.",
          "The durable F24 intent remains available for an explicit retry or reconciliation.",
          "RECONCILE",
          intent.snapshot.correlationId,
          true,
        );
      return this.options.persistence.updateHandoff({
        intentId: intent.snapshot.intentId,
        expectedVersion: intent.version,
        status: result.status,
        authorizationId:
          result.authorizationId ?? intent.handoff.authorizationId,
        reason,
      });
    } catch {
      const reason = genericReason(
        "F25_HANDOFF_UNCERTAIN",
        "HANDOFF",
        "Preparation was recorded but downstream acknowledgement is uncertain.",
        "The same durable authorization identity must be reconciled before another handoff is attempted.",
        "RECONCILE",
        intent.snapshot.correlationId,
        true,
      );
      try {
        return this.options.persistence.updateHandoff({
          intentId: intent.snapshot.intentId,
          expectedVersion: intent.version,
          status: "UNCERTAIN",
          reason,
        });
      } catch {
        return intent;
      }
    }
  }

  public async reconcilePreparation(
    intentId: string,
  ): Promise<F24PreparationIntent> {
    const intent = this.options.persistence.getPreparationIntent(intentId);
    if (intent === undefined)
      throw new F24SynchronizationError(
        "F24_INTENT_NOT_FOUND",
        "The synchronization preparation intent could not be found.",
        genericReason(
          "INTENT_NOT_FOUND",
          "HANDOFF",
          "The preparation intent is unavailable.",
          "No durable F24 intent was found for the requested identity.",
          "RETRY_RESOLUTION",
          "f24-reconcile",
        ),
      );
    if (intent.handoff.status === "ACKNOWLEDGED") return intent;
    if (this.options.handoff === undefined) return intent;
    return this.performHandoff(intent);
  }

  public readPreparationIntent(
    intentId: string,
  ): F24PreparationIntent | undefined {
    return this.options.persistence.getPreparationIntent(intentId);
  }

  public listPreparationIntents(): readonly F24PreparationIntent[] {
    return this.options.persistence.listPreparationIntents();
  }
}
