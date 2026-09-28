import type {
  PersistenceRepositories,
  SynchronizationAdmissionResultInput,
} from "./repositories";
import type {
  F25SynchronizationBatchReadModel,
  F25SynchronizationResultReadModel,
} from "../../shared/f25-synchronization";
import {
  isF25SynchronizationBatchReadModel,
  isF25SynchronizationResultReadModel,
} from "../../shared/f25-synchronization";

export interface F25PersistencePort {
  readonly persistAdmission: (input: {
    readonly batch: F25SynchronizationBatchReadModel;
    readonly results: readonly F25SynchronizationResultReadModel[];
  }) => { readonly created: boolean };
  readonly getBatch: (
    batchId: string,
  ) => F25SynchronizationBatchReadModel | undefined;
  readonly getBatchByIdempotencyKey: (
    idempotencyKey: string,
  ) => F25SynchronizationBatchReadModel | undefined;
  readonly listBatches: () => readonly F25SynchronizationBatchReadModel[];
  readonly putBatch: (
    batch: F25SynchronizationBatchReadModel,
  ) => F25SynchronizationBatchReadModel;
  readonly getResult: (
    operationId: string,
  ) => F25SynchronizationResultReadModel | undefined;
  readonly listResults: () => readonly F25SynchronizationResultReadModel[];
  readonly putResult: (
    result: F25SynchronizationResultReadModel,
    expectedVersion?: number,
  ) => F25SynchronizationResultReadModel;
}

function storedBatch(
  batch: F25SynchronizationBatchReadModel,
): Record<string, unknown> {
  const { authorization, authorizationId, ...withoutAuthorization } = batch;
  return {
    ...withoutAuthorization,
    authz: authorization,
    authzId: authorizationId,
    results: [],
  };
}

function inputProjection(
  input: F25SynchronizationResultReadModel["input"],
): Record<string, unknown> {
  const { authorizationId, ...withoutAuthorizationId } = input;
  return { ...withoutAuthorizationId, authzId: authorizationId };
}

function storedResult(
  result: F25SynchronizationResultReadModel,
): Record<string, unknown> {
  const { input, handoff, aiUsage, ...withoutInput } = result;
  const { tokens, ...withoutTokens } = aiUsage;
  return {
    ...withoutInput,
    input: inputProjection(input),
    aiUsage: { ...withoutTokens, usageUnits: tokens },
    ...(handoff === undefined
      ? {}
      : { handoff: { ...handoff, input: inputProjection(handoff.input) } }),
  };
}

function restoreInput(
  value: unknown,
): F25SynchronizationResultReadModel["input"] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("F25_PERSISTED_INPUT_INVALID");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.authzId !== "string")
    throw new Error("F25_PERSISTED_INPUT_INVALID");
  const { authzId, ...withoutAuthzId } = candidate;
  return {
    ...withoutAuthzId,
    authorizationId: authzId,
  } as F25SynchronizationResultReadModel["input"];
}

function restoreBatch(value: unknown): F25SynchronizationBatchReadModel {
  if (isF25SynchronizationBatchReadModel(value)) return value;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("F25_PERSISTED_BATCH_INVALID");
  const candidate = value as Record<string, unknown>;
  if (candidate.authz === undefined || typeof candidate.authzId !== "string")
    throw new Error("F25_PERSISTED_BATCH_INVALID");
  const { authz, authzId, ...withoutAuthz } = candidate;
  const restored = {
    ...withoutAuthz,
    authorization: authz,
    authorizationId: authzId,
  };
  if (!isF25SynchronizationBatchReadModel(restored))
    throw new Error("F25_PERSISTED_BATCH_INVALID");
  return restored;
}

function restoreResult(value: unknown): F25SynchronizationResultReadModel {
  if (isF25SynchronizationResultReadModel(value)) return value;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("F25_PERSISTED_RESULT_INVALID");
  const candidate = value as Record<string, unknown>;
  const input = restoreInput(candidate.input);
  const aiUsageValue = candidate.aiUsage;
  if (
    typeof aiUsageValue !== "object" ||
    aiUsageValue === null ||
    Array.isArray(aiUsageValue)
  )
    throw new Error("F25_PERSISTED_RESULT_INVALID");
  const { usageUnits, ...withoutTokenCount } = aiUsageValue as Record<
    string,
    unknown
  >;
  if (typeof usageUnits !== "number")
    throw new Error("F25_PERSISTED_RESULT_INVALID");
  const handoffValue = candidate.handoff;
  const handoff =
    typeof handoffValue === "object" &&
    handoffValue !== null &&
    !Array.isArray(handoffValue)
      ? {
          ...(handoffValue as Record<string, unknown>),
          input: restoreInput((handoffValue as Record<string, unknown>).input),
        }
      : undefined;
  const restored = {
    ...candidate,
    input,
    aiUsage: { ...withoutTokenCount, tokens: usageUnits },
    ...(handoff === undefined ? {} : { handoff }),
  };
  if (!isF25SynchronizationResultReadModel(restored))
    throw new Error("F25_PERSISTED_RESULT_INVALID");
  return restored;
}

function resultInput(
  result: F25SynchronizationResultReadModel,
): SynchronizationAdmissionResultInput {
  const row = result.input.row;
  return {
    synchronizationOperationId: result.operationId,
    synchronizationBatchId: result.batchId,
    managedPrId: result.managedPrId,
    status: result.status,
    sourceRepositoryId: row.sourceRepository.key,
    destinationRepositoryId: row.destinationRepository.key,
    sourceBranch: row.syncSourceBranch,
    destinationBranch: row.prHeadBranch,
    syncSourceSha: row.syncSourceSha,
    prHeadSha: row.prHeadSha,
    syncMergeBaseSha: result.mergeBaseSha,
    sourceChangeEvidence: result.sourceChangeEvidence,
    prHeadChangeEvidence: result.prHeadChangeEvidence,
    userConsultation: result.conflictResolution?.consultationHistory,
    aiOperationId: result.aiOperationId,
    reason: result.reason,
    payload: storedResult(result),
  };
}

export class F25PersistenceRepositories implements F25PersistencePort {
  public constructor(private readonly repositories: PersistenceRepositories) {}

  public persistAdmission(input: {
    readonly batch: F25SynchronizationBatchReadModel;
    readonly results: readonly F25SynchronizationResultReadModel[];
  }): { readonly created: boolean } {
    if (!isF25SynchronizationBatchReadModel(input.batch))
      throw new Error("F25_BATCH_INVALID");
    if (
      input.results.length > 250 ||
      !input.results.every(isF25SynchronizationResultReadModel)
    )
      throw new Error("F25_RESULTS_INVALID");
    return this.repositories.persistSynchronizationAdmission({
      synchronizationBatchId: input.batch.batchId,
      status: input.batch.status,
      payload: storedBatch(input.batch),
      results: input.results.map(resultInput),
    });
  }

  private rehydrateBatch(
    batch: F25SynchronizationBatchReadModel,
  ): F25SynchronizationBatchReadModel {
    const results = this.listResults().filter(
      (result) => result.batchId === batch.batchId,
    );
    const rehydrated = { ...batch, results };
    if (!isF25SynchronizationBatchReadModel(rehydrated))
      throw new Error("F25_PERSISTED_BATCH_INVALID");
    return rehydrated;
  }

  public getBatch(
    batchId: string,
  ): F25SynchronizationBatchReadModel | undefined {
    const record = this.repositories.getSynchronizationBatch(batchId);
    if (record === undefined) return undefined;
    return this.rehydrateBatch(restoreBatch(record.payload));
  }

  public getBatchByIdempotencyKey(
    idempotencyKey: string,
  ): F25SynchronizationBatchReadModel | undefined {
    return this.listBatches().find(
      (batch) => batch.idempotencyKey === idempotencyKey,
    );
  }

  public listBatches(): readonly F25SynchronizationBatchReadModel[] {
    return this.repositories.listSynchronizationBatches().flatMap((record) => {
      return [this.rehydrateBatch(restoreBatch(record.payload))];
    });
  }

  public putBatch(
    batch: F25SynchronizationBatchReadModel,
  ): F25SynchronizationBatchReadModel {
    if (!isF25SynchronizationBatchReadModel(batch))
      throw new Error("F25_BATCH_INVALID");
    const current = this.getBatch(batch.batchId);
    const next = {
      ...batch,
      results: [],
      version: current === undefined ? batch.version : current.version + 1,
    } satisfies F25SynchronizationBatchReadModel;
    this.repositories.putSynchronizationBatch({
      synchronizationBatchId: next.batchId,
      status: next.status,
      payload: storedBatch(next),
    });
    return this.rehydrateBatch(next);
  }

  public getResult(
    operationId: string,
  ): F25SynchronizationResultReadModel | undefined {
    const record = this.repositories.getSynchronizationResult(operationId);
    if (record === undefined) return undefined;
    return restoreResult(record.payload);
  }

  public listResults(): readonly F25SynchronizationResultReadModel[] {
    return this.repositories.listSynchronizationResults().flatMap((record) => {
      return [restoreResult(record.payload)];
    });
  }

  public putResult(
    result: F25SynchronizationResultReadModel,
    expectedVersion?: number,
  ): F25SynchronizationResultReadModel {
    if (!isF25SynchronizationResultReadModel(result))
      throw new Error("F25_RESULT_INVALID");
    const current = this.repositories.getSynchronizationResult(
      result.operationId,
    );
    const currentVersion = current?.version ?? 0;
    const next = {
      ...result,
      version: current === undefined ? result.version : currentVersion + 1,
    } satisfies F25SynchronizationResultReadModel;
    const persisted = this.repositories.putSynchronizationResult({
      ...resultInput(next),
      expectedVersion:
        expectedVersion ?? (current === undefined ? 0 : currentVersion),
      worktreeId:
        next.worktree !== undefined &&
        this.repositories.hasWorktree(next.worktree.worktreeId)
          ? next.worktree.worktreeId
          : undefined,
      validationRunId:
        next.validation !== undefined &&
        this.repositories.hasValidationRun(next.validation.runId)
          ? next.validation.runId
          : undefined,
      payload: storedResult(next),
    });
    for (const conflict of next.conflicts)
      this.repositories.putSynchronizationConflict({
        synchronizationOperationId: next.operationId,
        path: conflict.path,
        source: conflict.source,
        destination: conflict.destination,
        mergeBase: conflict.mergeBase,
        details: conflict.details,
        reason: next.reason,
      });
    return restoreResult(persisted.payload);
  }
}
