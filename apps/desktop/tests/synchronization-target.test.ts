import { expect, it } from "vitest";
import { resolveSynchronizationTarget } from "../src/renderer/synchronization-target";

const batches = [
  { batchId: "batch-a", rows: [{ operationId: "result-a" }] },
  { batchId: "batch-b", rows: [{ operationId: "result-b" }] },
];

it("resolves successive result and batch targets without borrowing another record", () => {
  expect(
    resolveSynchronizationTarget(batches, { resultId: "result-a" }).row
      ?.operationId,
  ).toBe("result-a");
  expect(
    resolveSynchronizationTarget(batches, { batchId: "batch-b" }).row
      ?.operationId,
  ).toBe("result-b");
  expect(
    resolveSynchronizationTarget(batches, { resultId: "result-b" }).batch
      ?.batchId,
  ).toBe("batch-b");
  expect(resolveSynchronizationTarget(batches, { batchId: "missing" })).toEqual(
    { batch: undefined, row: undefined },
  );
  expect(
    resolveSynchronizationTarget(batches, { resultId: "missing" }),
  ).toEqual({ batch: undefined, row: undefined });
});
