import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_TIMEOUT_SECONDS,
  VALIDATION_PROFILE_EXAMPLE,
  validationProfileV1Schema,
  parseValidationProfile,
  readStoredValidationProfile,
  serializeValidationProfile,
  canonicalProfileJson,
  hashValidationProfile,
  createApprovalRecord,
  createOneRunAuthorization,
  buildConfirmationSummary,
  resolveValidationProfile,
  validationWarning,
  type ValidationProfile,
} from "../src/index.js";

function command(id: string, executable = "npm"): ValidationProfile {
  return {
    schemaVersion: 1,
    steps: [
      {
        kind: "command",
        id,
        label: id,
        executable,
        arguments: ["test"],
        workingDirectory: ".",
        phase: "post_change",
        timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
        outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      },
    ],
  };
}

describe("versioned validation profile", () => {
  it("normalizes defaults and keeps command/manual discriminators visible", () => {
    const result = parseValidationProfile({
      schemaVersion: 1,
      steps: [
        {
          kind: "command",
          id: "test",
          label: "Tests",
          executable: "npm",
          arguments: ["test"],
        },
        {
          kind: "manual",
          id: "visual",
          label: "Visual",
          instructions: "Look at it.",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.profile.steps).toEqual([
      {
        kind: "command",
        id: "test",
        label: "Tests",
        executable: "npm",
        arguments: ["test"],
        workingDirectory: ".",
        phase: "post_change",
        timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
        outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
      },
      {
        kind: "manual",
        id: "visual",
        label: "Visual",
        instructions: "Look at it.",
        phase: "post_change",
      },
    ]);
  });

  it("rejects unsupported versions, unknown keys, duplicate IDs, empty profiles, and shell command strings", () => {
    expect(
      parseValidationProfile({ schemaVersion: 2, steps: [] }),
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
    });
    expect(
      parseValidationProfile({ schemaVersion: 1, steps: [], typo: true }),
    ).toMatchObject({ ok: false });
    expect(
      parseValidationProfile({
        schemaVersion: 1,
        steps: [
          {
            kind: "command",
            id: "same",
            label: "One",
            executable: "npm",
            arguments: [],
          },
          {
            kind: "command",
            id: "same",
            label: "Two",
            executable: "npm",
            arguments: [],
          },
        ],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_PROFILE" });
    expect(
      parseValidationProfile({ schemaVersion: 1, steps: [] }),
    ).toMatchObject({ ok: false });
    expect(
      parseValidationProfile({
        schemaVersion: 1,
        steps: [
          {
            kind: "command",
            id: "bad",
            label: "Bad",
            executable: "npm test",
            arguments: [],
          },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(parseValidationProfile({ steps: [] })).toMatchObject({
      ok: false,
      code: "INVALID_PROFILE",
    });
    expect(
      parseValidationProfile({
        schemaVersion: 1,
        steps: [
          {
            kind: "command",
            id: "bad",
            label: "Bad",
            executable: "npm",
            arguments: [],
            env: { TOKEN: "x" },
          },
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it("preserves build instructions as non-executable context and normalizes validation phases", () => {
    const result = parseValidationProfile({
      schemaVersion: 1,
      buildInstructions: "The monorepo build starts from the repository root.",
      steps: [
        {
          kind: "command",
          id: "baseline",
          label: "Baseline",
          executable: "npm",
          arguments: [],
          phase: "baseline",
        },
        {
          kind: "manual",
          id: "review",
          label: "Review",
          instructions: "Inspect the result.",
          phase: "both",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.profile.buildInstructions).toContain("monorepo");
    expect(result.profile.steps.map((step) => step.phase)).toEqual([
      "baseline",
      "both",
    ]);
    const summary = buildConfirmationSummary(result.profile, {
      source: "saved",
      repositoryId: "github:example/repo",
    });
    expect(summary.buildInstructions).toContain("monorepo");
    expect(summary.steps.map((step) => step.phase)).toEqual([
      "baseline",
      "both",
    ]);
  });

  it("round-trips a version-1 stored profile through the compatibility reader", () => {
    const serialized = JSON.stringify({
      steps: [
        {
          kind: "command",
          id: "test",
          label: "Tests",
          executable: "npm",
          arguments: ["test"],
        },
      ],
      schemaVersion: 1,
    });
    const result = readStoredValidationProfile(serialized);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      readStoredValidationProfile(serializeValidationProfile(result.profile)),
    ).toEqual(result);
    expect(result.profile.schemaVersion).toBe(1);
  });

  it("rejects tempting discovery inputs because resolution accepts only explicit candidates", () => {
    const result = resolveValidationProfile({
      repositoryId: "github:example/repo",
      checkedIn: undefined,
    });
    expect(result).toMatchObject({
      status: "unavailable",
      reason: "NO_PROFILE",
    });
    const tempting = {
      packageJson: { scripts: { test: "npm test" } },
      readme: "run npm test",
      aiHistory: [{ executable: "npm", arguments: ["test"] }],
      processHistory: [{ command: "npm test" }],
    };
    expect(
      resolveValidationProfile({
        repositoryId: "github:example/repo",
        ...(tempting as never),
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "NO_PROFILE",
    });
  });

  it("does not turn repository discovery fixtures into an implicit profile", async () => {
    const fixtureNames = [
      "package.json",
      "build.yml",
      "README.md",
      "ai-output.json",
      "process-history.json",
    ];
    for (const fixtureName of fixtureNames) {
      expect(
        (
          await readFile(
            new URL(`../fixtures/discovery/${fixtureName}`, import.meta.url),
            "utf8",
          )
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      resolveValidationProfile({ repositoryId: "github:example/repo" }),
    ).toMatchObject({
      status: "unavailable",
      reason: "NO_PROFILE",
    });
  });
});

describe("normalization, authorization, and precedence", () => {
  const repositoryId = "github:example/repo";
  const operationId = "operation-1";
  const saved = command("saved");
  const checkedIn = command("checked-in");
  const oneRun = command("one-run");

  it("hashes meaning, not object-key order or whitespace", () => {
    const first = {
      schemaVersion: 1,
      steps: [
        {
          kind: "command",
          id: "test",
          label: "Tests",
          executable: "npm",
          arguments: [],
        },
      ],
    };
    const second = {
      steps: [
        {
          kind: "command",
          arguments: [],
          executable: "npm",
          label: "Tests",
          id: "test",
        },
      ],
      schemaVersion: 1,
    };
    expect(hashValidationProfile(first)).toBe(hashValidationProfile(second));
    expect(canonicalProfileJson(first)).toContain('"schemaVersion":1');
    expect(
      hashValidationProfile({
        ...first,
        steps: [{ ...first.steps[0], arguments: ["test"] }],
      }),
    ).not.toBe(hashValidationProfile(first));
  });

  it("selects one complete source and never merges steps", () => {
    const savedApproval = createApprovalRecord({
      repositoryId,
      source: "saved",
      profile: saved,
      approvedAt: "2026-09-19T12:00:00.000Z",
    });
    const checkedApproval = createApprovalRecord({
      repositoryId,
      source: "checked-in",
      profile: checkedIn,
      approvedAt: "2026-09-19T12:00:00.000Z",
    });
    const oneRunAuthorization = createOneRunAuthorization({
      repositoryId,
      operationId,
      profile: oneRun,
      authorizedAt: "2026-09-19T12:00:00.000Z",
    });
    const resolved = resolveValidationProfile({
      repositoryId,
      operationId,
      oneRun: {
        profile: oneRun,
        authorization: oneRunAuthorization,
        isAiProposal: true,
      },
      saved: { profile: saved, approval: savedApproval },
      checkedIn: { profile: checkedIn, approval: checkedApproval },
    });
    expect(resolved).toMatchObject({
      status: "ready",
      source: "one-run",
      isAiProposal: true,
    });
    if (resolved.status === "ready") {
      expect(resolved.profile.steps.map((step) => step.id)).toEqual([
        "one-run",
      ]);
    }
  });

  it("covers every source-presence combination with fixed whole-profile precedence", () => {
    const savedApproval = createApprovalRecord({
      repositoryId,
      source: "saved",
      profile: saved,
      approvedAt: "2026-09-19T12:00:00.000Z",
    });
    const checkedApproval = createApprovalRecord({
      repositoryId,
      source: "checked-in",
      profile: checkedIn,
      approvedAt: "2026-09-19T12:00:00.000Z",
    });
    const oneRunAuthorization = createOneRunAuthorization({
      repositoryId,
      operationId,
      profile: oneRun,
      authorizedAt: "2026-09-19T12:00:00.000Z",
    });
    const sources = {
      one: { profile: oneRun, authorization: oneRunAuthorization },
      saved: { profile: saved, approval: savedApproval },
      checked: { profile: checkedIn, approval: checkedApproval },
    } as const;
    const expected = ["checked-in", "saved", "one-run"] as const;
    for (let mask = 0; mask < 8; mask += 1) {
      const input = {
        repositoryId,
        operationId,
        ...(mask & 1 ? { oneRun: sources.one } : {}),
        ...(mask & 2 ? { saved: sources.saved } : {}),
        ...(mask & 4 ? { checkedIn: sources.checked } : {}),
      };
      const result = resolveValidationProfile(input);
      if (mask === 0) {
        expect(result).toMatchObject({
          status: "unavailable",
          reason: "NO_PROFILE",
        });
      } else {
        const expectedSource =
          mask & 1 ? expected[2] : mask & 2 ? expected[1] : expected[0];
        expect(result).toMatchObject({
          status: "ready",
          source: expectedSource,
        });
      }
    }
  });

  it("requires confirmation for AI proposals, unapproved saved profiles, and changed content", () => {
    expect(
      resolveValidationProfile({
        repositoryId,
        operationId,
        oneRun: { profile: oneRun, isAiProposal: true },
      }),
    ).toMatchObject({
      status: "confirmation_required",
      trustReason: "MISSING_AUTHORIZATION",
    });
    expect(resolveValidationProfile({ repositoryId, saved })).toMatchObject({
      status: "confirmation_required",
      trustReason: "MISSING_AUTHORIZATION",
    });
    const approval = createApprovalRecord({
      repositoryId,
      source: "checked-in",
      profile: checkedIn,
      approvedAt: "2026-09-19T12:00:00.000Z",
    });
    const changed = {
      ...checkedIn,
      steps: [{ ...checkedIn.steps[0], arguments: ["different"] }],
    };
    expect(
      resolveValidationProfile({
        repositoryId,
        checkedIn: { profile: changed, approval },
      }),
    ).toMatchObject({
      status: "confirmation_required",
      trustReason: "CONTENT_HASH_MISMATCH",
    });
  });

  it("fails closed for malformed persisted authorization records", () => {
    const approval = createApprovalRecord({
      repositoryId,
      source: "saved",
      profile: saved,
      approvedAt: "2026-09-19T12:00:00.000Z",
    });
    const malformed = { ...approval, unexpected: "field" };
    expect(
      resolveValidationProfile({
        repositoryId,
        saved: { profile: saved, approval: malformed as never },
      }),
    ).toMatchObject({
      status: "confirmation_required",
      trustReason: "INVALID_AUTHORIZATION",
    });
  });

  it("expires one-run authorization by operation and time", () => {
    const authorization = createOneRunAuthorization({
      repositoryId,
      operationId,
      profile: oneRun,
      authorizedAt: "2026-09-19T12:00:00.000Z",
      expiresAt: "2026-09-19T13:00:00.000Z",
    });
    expect(
      resolveValidationProfile({
        repositoryId,
        operationId: "other",
        now: "2026-09-19T12:30:00.000Z",
        oneRun: { profile: oneRun, authorization },
      }),
    ).toMatchObject({
      status: "confirmation_required",
      trustReason: "OPERATION_MISMATCH",
    });
    expect(
      resolveValidationProfile({
        repositoryId,
        operationId,
        now: "2026-09-19T13:00:00.000Z",
        oneRun: { profile: oneRun, authorization },
      }),
    ).toMatchObject({
      status: "confirmation_required",
      trustReason: "AUTHORIZATION_EXPIRED",
    });
    expect(
      resolveValidationProfile({
        repositoryId,
        operationId,
        operationEnded: true,
        oneRun: { profile: oneRun, authorization },
      }),
    ).toMatchObject({
      status: "confirmation_required",
      trustReason: "AUTHORIZATION_EXPIRED",
    });
  });

  it("provides complete secret-free confirmation content with visible manual steps", () => {
    const profile = {
      schemaVersion: 1 as const,
      steps: [
        {
          kind: "command" as const,
          id: "test",
          label: "Tests",
          executable: "npm",
          arguments: ["test"],
          workingDirectory: ".",
          timeoutSeconds: 1,
          outputLimitBytes: 10,
        },
        {
          kind: "manual" as const,
          id: "manual",
          label: "Manual",
          instructions: "Inspect the result.",
        },
      ],
    };
    const summary = buildConfirmationSummary(profile, {
      source: "checked-in",
      repositoryId,
    });
    expect(summary.steps).toEqual([
      expect.objectContaining({
        kind: "command",
        timeoutSeconds: 1,
        outputLimitBytes: 10,
      }),
      expect.objectContaining({
        kind: "manual",
        instructions: "Inspect the result.",
      }),
    ]);
    expect(summary.securityNotice).toContain(
      "does not claim an operating-system or network sandbox",
    );
  });

  it("validates the committed JSON Schema against its generated source", async () => {
    const schemaPath = new URL(
      "../../../Specs/contracts/validation-profile.v1.schema.json",
      import.meta.url,
    );
    const committed = JSON.parse(await readFile(schemaPath, "utf8")) as unknown;
    const generated = zodToJsonSchema(validationProfileV1Schema, {
      $refStrategy: "none",
      name: "ValidationProfileV1",
    });
    expect(committed).toEqual(generated);
    expect(parseValidationProfile(VALIDATION_PROFILE_EXAMPLE).ok).toBe(true);
  });

  it("serializes precise no-profile warning copy", () => {
    expect(validationWarning("NO_PROFILE")).toMatchObject({
      code: "NO_PROFILE",
      title: "Validation not run",
    });
  });
});
