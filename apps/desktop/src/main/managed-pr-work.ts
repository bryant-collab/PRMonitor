import {
  managedPrWorkSchema,
  type ManagedPrWork,
} from "../shared/managed-pr-work";

export function projectManagedPrWork(
  managedPrId: string,
  reviews: readonly {
    readonly managedPrId: string;
    readonly bundleId: string;
    readonly updatedAt: string;
  }[],
  batches: readonly {
    readonly batchId: string;
    readonly rows: readonly {
      readonly managedPrId: string;
      readonly operationId: string;
    }[];
  }[],
  offset = 0,
): ManagedPrWork {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 50000)
    throw Error("SAVED_WORK_OFFSET_INVALID");
  const ownedReviews = reviews
    .filter((review) => review.managedPrId === managedPrId)
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.bundleId.localeCompare(b.bundleId),
    );
  const ownedSync = batches.flatMap((batch) =>
    batch.rows
      .filter((row) => row.managedPrId === managedPrId)
      .map((row) => ({ batchId: batch.batchId, resultId: row.operationId })),
  );
  return managedPrWorkSchema.parse({
    managedPrId,
    reviews: ownedReviews
      .slice(offset, offset + 50)
      .map(({ bundleId, updatedAt }) => ({ bundleId, updatedAt })),
    synchronization: ownedSync.slice(offset, offset + 50),
    ...(Math.max(ownedReviews.length, ownedSync.length) > offset + 50
      ? { nextOffset: offset + 50 }
      : {}),
  });
}
