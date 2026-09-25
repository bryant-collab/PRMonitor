import {
  f18BundleItemSchema,
  f18ReviewBundleRecordSchema,
  type F18BundleItem,
  type F18ReviewBundleRecord,
} from "../../shared/f18-automatic-review";
import type {
  PersistenceRepositories,
  ReviewBundleRecord,
} from "./repositories";
import type { ReviewBundleCommitInput } from "./types";

export interface F18PersistIntentInput {
  readonly record: F18ReviewBundleRecord;
  readonly events: readonly ReviewBundleCommitInput["events"][number][];
  readonly managedPrExpectedVersion?: number;
}

export interface F18PersistUpdateInput {
  readonly record: F18ReviewBundleRecord;
  readonly expectedBundleVersion?: number;
  readonly managedPrExpectedVersion?: number;
}

export interface F18BundlePersistencePort {
  readonly get: (bundleId: string) => F18ReviewBundleRecord | undefined;
  readonly persistIntent: (
    input: F18PersistIntentInput,
  ) => F18ReviewBundleRecord;
  readonly update: (input: F18PersistUpdateInput) => F18ReviewBundleRecord;
  readonly recordDecision: (input: {
    readonly bundleId: string;
    readonly itemId: string;
    readonly decision: "accepted" | "overridden";
    readonly finalDisposition: "fixed" | "pushback" | "question" | "no_change";
    readonly instruction?: string;
    readonly answer?: string;
    readonly expectedVersion?: number;
    readonly actionId?: string;
  }) => F18ReviewBundleRecord;
}

function decisionFromPersistence(
  item: ReviewBundleRecord["items"][number],
): F18BundleItem["decision"] {
  return {
    decision: item.decision.decision,
    finalDisposition: item.decision.finalDisposition,
    ...(item.decision.userInstructions === undefined
      ? {}
      : { instruction: item.decision.userInstructions }),
    ...(item.decision.questionAnswer === undefined
      ? {}
      : { answer: item.decision.questionAnswer }),
  };
}

function fromPersistence(persisted: ReviewBundleRecord): F18ReviewBundleRecord {
  const parsed = f18ReviewBundleRecordSchema.parse(persisted.payload);
  const payloadItems = new Map(
    parsed.items.map((item) => [item.itemId, item] as const),
  );
  const items = persisted.items.map((item) => {
    const payload = f18BundleItemSchema.safeParse(item.payload);
    const existing =
      (payload.success ? payload.data : undefined) ?? payloadItems.get(item.id);
    if (existing === undefined) throw new Error("F18_ITEM_PAYLOAD_MISSING");
    return {
      ...existing,
      eventVersionId: item.eventVersionId,
      decision: decisionFromPersistence(item),
      decisionHistory: item.decisionHistory.map((history) => ({
        decision: history.decision as F18BundleItem["decision"]["decision"],
        finalDisposition:
          history.finalDisposition as F18BundleItem["decision"]["finalDisposition"],
        ...(history.userInstructions === undefined
          ? {}
          : { instruction: history.userInstructions }),
        ...(history.questionAnswer === undefined
          ? {}
          : { answer: history.questionAnswer }),
      })),
    };
  });
  return f18ReviewBundleRecordSchema.parse({
    ...parsed,
    state: persisted.state,
    stage: persisted.stage,
    version: persisted.version,
    updatedAt: persisted.updatedAt,
    items,
  });
}

function toPersistenceItem(
  item: F18BundleItem,
): ReviewBundleCommitInput["items"][number] {
  return {
    id: item.itemId,
    eventVersionId: item.eventVersionId,
    payload: item,
    decision: {
      decision: item.decision.decision,
      finalDisposition: item.decision.finalDisposition,
      ...(item.decision.instruction === undefined
        ? {}
        : { userInstructions: item.decision.instruction }),
      ...(item.decision.answer === undefined
        ? {}
        : { questionAnswer: item.decision.answer }),
    },
  };
}

export class F18PersistenceRepositories implements F18BundlePersistencePort {
  public constructor(private readonly repositories: PersistenceRepositories) {}

  public get(bundleId: string): F18ReviewBundleRecord | undefined {
    const persisted = this.repositories.getReviewBundle(bundleId);
    return persisted === undefined ? undefined : fromPersistence(persisted);
  }

  public persistIntent(input: F18PersistIntentInput): F18ReviewBundleRecord {
    const record = f18ReviewBundleRecordSchema.parse(input.record);
    const persisted = this.repositories.persistReviewBundleAtomic({
      batch: {
        id: record.batchId,
        managedPrId: record.managedPrId,
        payload: {
          schemaVersion: 1,
          eventVersionIds: record.input.remoteEventVersionIds,
        },
      },
      bundle: {
        id: record.bundleId,
        managedPrId: record.managedPrId,
        state: record.state,
        stage: record.stage,
        automaticOperationKey: record.operationId,
        payload: record,
      },
      events: input.events,
      items: record.items.map(toPersistenceItem),
      ...(input.managedPrExpectedVersion === undefined
        ? {}
        : { managedPrExpectedVersion: input.managedPrExpectedVersion }),
    });
    return fromPersistence(persisted);
  }

  public update(input: F18PersistUpdateInput): F18ReviewBundleRecord {
    const record = f18ReviewBundleRecordSchema.parse(input.record);
    const persisted = this.repositories.updateReviewBundleAtomic({
      bundleId: record.bundleId,
      state: record.state,
      stage: record.stage,
      payload: record,
      items: record.items.map(toPersistenceItem),
      ...(input.expectedBundleVersion === undefined
        ? {}
        : { expectedBundleVersion: input.expectedBundleVersion }),
      ...(input.managedPrExpectedVersion === undefined
        ? {}
        : { managedPrExpectedVersion: input.managedPrExpectedVersion }),
      managedPrState: record.state,
    });
    return fromPersistence(persisted);
  }

  public recordDecision(input: {
    readonly bundleId: string;
    readonly itemId: string;
    readonly decision: "accepted" | "overridden";
    readonly finalDisposition: "fixed" | "pushback" | "question" | "no_change";
    readonly instruction?: string;
    readonly answer?: string;
    readonly expectedVersion?: number;
    readonly actionId?: string;
  }): F18ReviewBundleRecord {
    const persisted = this.repositories.recordReviewBundleItemDecision({
      bundleId: input.bundleId,
      itemId: input.itemId,
      decision: input.decision,
      finalDisposition: input.finalDisposition,
      ...(input.instruction === undefined
        ? {}
        : { userInstructions: input.instruction }),
      ...(input.answer === undefined ? {} : { questionAnswer: input.answer }),
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedBundleVersion: input.expectedVersion }),
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    });
    return fromPersistence(persisted);
  }
}
