import { describe, expect, it } from "vitest";
import {
  startupRecoveryReadiness,
  startupRecoveryRelaunchArguments,
} from "../src/main/setup-startup-recovery";
import { parseLaunchArguments } from "../src/shared/routing";
import { PersistenceError } from "../src/main/persistence/types";
import { setupReadinessSchema } from "../src/shared/setup-readiness";

describe("bootstrap failure setup projection", () => {
  it("keeps the latest accepted target through an explicit startup retry", () => {
    const args = startupRecoveryRelaunchArguments(
      ["application-entry", "--safe-existing-flag", "prmonitor://home"],
      {
        schemaVersion: 1,
        kind: "REVIEW_BUNDLE",
        id: "saved-review-fixture",
        requestId: "fixture",
      },
    );
    expect(args.slice(0, 2)).toEqual([
      "application-entry",
      "--safe-existing-flag",
    ]);
    const target = parseLaunchArguments(args);
    expect(target?.ok && target.value.kind).toBe("REVIEW_BUNDLE");
    expect(target?.ok && target.value.id).toBe("saved-review-fixture");
  });
  it("keeps inaccessible state unconfirmed and discards raw exception details", () => {
    const result = startupRecoveryReadiness(
      new Error("private path, database bytes and token must not escape"),
      1,
    );
    expect(setupReadinessSchema.safeParse(result).success).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.checks[0]?.description).toContain("preserve existing data");
    expect(
      result.checks
        .slice(1)
        .every((check) => check.status === "temporarily-unavailable"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private path");
  });
  it("requires verified recovery for corruption rather than a replacement database", () => {
    const error = new PersistenceError({
      code: "CORRUPT_DATABASE",
      stage: "open",
      what: "unsafe raw detail",
      why: "raw detail",
      nextAction: "RESTORE_BACKUP",
      correlationId: "fixture",
      databaseId: "fixture",
      details: {},
    });
    expect(startupRecoveryReadiness(error, 2).checks[0]?.description).toContain(
      "verified backup",
    );
  });
});
