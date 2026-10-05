/** An explicit target never falls back to an unrelated saved result. */
export function resolveSynchronizationTarget<
  T extends {
    readonly batchId: string;
    readonly rows: readonly { readonly operationId: string }[];
  },
>(
  batches: readonly T[],
  target: { readonly batchId?: string; readonly resultId?: string },
) {
  const batch =
    target.resultId !== undefined
      ? batches.find((item) =>
          item.rows.some((row) => row.operationId === target.resultId),
        )
      : target.batchId !== undefined
        ? batches.find((item) => item.batchId === target.batchId)
        : batches[0];
  const row =
    target.resultId !== undefined
      ? batch?.rows.find((item) => item.operationId === target.resultId)
      : batch?.rows[0];
  return { batch, row };
}
