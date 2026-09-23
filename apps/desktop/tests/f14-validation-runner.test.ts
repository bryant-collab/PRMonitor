import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialValidationRun,
  createOneRunAuthorization,
  createValidationSnapshot,
  parseValidationProfile,
  resolveValidationProfile,
  type ExitObservation,
  type ProcessControlPort,
  type PreparedCommand,
  type ValidationPhase,
  type ValidationProcessHandle,
  type ValidationProfile,
  type ValidationResolution,
  type ValidationRunnerPort,
} from "@prmonitor/validation-contract";
import type {
  F13InspectionResult,
  F13WorktreeRecord,
} from "../src/shared/f13-contracts";
import {
  F14ValidationRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import {
  ValidationRunService,
  type F14Clock,
  type F14TimerPort,
  type F14ValidationRequest,
} from "../src/main/f14-validation-runner";

const TIME = "2026-09-23T12:00:00.000Z";
const operationId = "operation-1";
const ownerId = "owner-1";
const repositoryId = "repository-1";

const stores: PersistenceStore[] = [];
const roots: string[] = [];

async function fixture(): Promise<{ root: string; store: PersistenceStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f14-"));
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => TIME }, applicationBuild: "f14-test" },
  );
  roots.push(root);
  stores.push(store);
  return { root, store };
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function command(id: string, phase: ValidationPhase): Record<string, unknown> {
  return {
    kind: "command",
    id,
    label: id,
    executable: process.execPath,
    arguments: [],
    workingDirectory: ".",
    phase,
    timeoutSeconds: 1,
    outputLimitBytes: 4_096,
  };
}

function profileWithPhases(): ValidationProfile {
  const parsed = parseValidationProfile({
    schemaVersion: 1,
    steps: [
      command("baseline", "baseline"),
      command("post-change", "post_change"),
      command("both", "both"),
    ],
  });
  if (!parsed.ok) throw new Error("test profile is invalid");
  return parsed.profile;
}

function profileWithManualCheck(): ValidationProfile {
  const parsed = parseValidationProfile({
    schemaVersion: 1,
    steps: [
      command("automated", "post_change"),
      {
        kind: "manual",
        id: "manual-check",
        label: "Manual check",
        instructions: "Inspect the resulting UI.",
        phase: "post_change",
      },
    ],
  });
  if (!parsed.ok) throw new Error("test manual profile is invalid");
  return parsed.profile;
}

function readyResolution(
  profile: ValidationProfile = profileWithPhases(),
): Extract<ValidationResolution, { status: "ready" }> {
  const authorization = createOneRunAuthorization({
    repositoryId,
    operationId,
    profile,
    authorizedAt: TIME,
  });
  const resolved = resolveValidationProfile({
    repositoryId,
    operationId,
    now: TIME,
    oneRun: { profile, authorization },
  });
  if (resolved.status !== "ready")
    throw new Error("test resolution is not ready");
  return resolved;
}

function inspection(
  root: string,
  currentRevision = "head",
): F13InspectionResult {
  const worktree = {
    canonicalPath: root,
    worktreeBaselineSha: "base",
    currentHeadSha: currentRevision,
  } as unknown as F13WorktreeRecord;
  return {
    ok: true,
    worktree,
    snapshot: {
      manifest: { headSha: currentRevision },
    } as F13InspectionResult["snapshot"],
  };
}

async function* output(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value, "utf8");
}

class FakeRunner implements ValidationRunnerPort<string> {
  readonly started: PreparedCommand[] = [];

  public constructor(
    private readonly outcomes:
      readonly ExitObservation[] | readonly Promise<ExitObservation>[],
    private readonly stdoutText = "ok\n",
  ) {}

  public async start(input: {
    readonly snapshot: unknown;
    readonly command: PreparedCommand;
  }): Promise<ValidationProcessHandle<string>> {
    this.started.push(input.command);
    const outcome = this.outcomes[this.started.length - 1] ?? { exitCode: 0 };
    return {
      processTree: `tree-${this.started.length}`,
      stdout: output(this.stdoutText),
      stderr: output(""),
      wait: () => Promise.resolve(outcome),
    };
  }
}

function fakeClock(waits: number[] = []): F14Clock {
  return {
    now: () => TIME,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  };
}

function fakeTimer(): F14TimerPort {
  return {
    setTimeout: () => "timer",
    clearTimeout: () => undefined,
  };
}

function fakeProcessControl(
  survivors: readonly string[] = [],
  calls: { graceful: string[]; force: string[][] } = {
    graceful: [],
    force: [],
  },
): ProcessControlPort<string> {
  return {
    requestGracefulTermination: async (processTree) => {
      calls.graceful.push(processTree);
    },
    listSurvivingProcesses: async () => survivors,
    forceTerminate: async (processes) => {
      calls.force.push([...processes]);
    },
  };
}

function request(
  resolution: ValidationResolution,
  overrides: Partial<F14ValidationRequest> = {},
): F14ValidationRequest {
  return {
    operationId,
    runId: "run-1",
    idempotencyKey: "key-1",
    correlationId: "correlation-1",
    ownerType: "review",
    ownerId,
    consumer: "review",
    requestedPhase: "post_change",
    resolution,
    ...overrides,
  };
}

function service(
  store: PersistenceStore,
  root: string,
  runner: ValidationRunnerPort<string>,
  processControl: ProcessControlPort<string> = fakeProcessControl(),
  clock: F14Clock = fakeClock(),
): ValidationRunService {
  return new ValidationRunService({
    repositories: new F14ValidationRepositories(store, { clock }),
    worktrees: { inspectOperation: async () => inspection(root) },
    runner,
    processControl,
    clock,
    timer: fakeTimer(),
    platform: process.platform === "win32" ? "win32" : "posix",
    environment: process.env,
    toolchainEnvironment: process.env,
    knownSecrets: ["super-secret"],
  });
}

describe("F14 deterministic validation runner", () => {
  it("persists an explicit no-run result without spawning a child", async () => {
    const { root, store } = await fixture();
    const runner = new FakeRunner([]);
    const validation = service(store, root, runner);
    const unavailable = resolveValidationProfile({
      repositoryId,
      operationId,
      now: TIME,
    });

    const result = await validation.run(
      request(unavailable, {
        runId: "run-no-profile",
        idempotencyKey: "key-no-profile",
      }),
    );

    expect(result.record.evidence.status).toBe("not_run");
    expect(result.record.evidence.reason).toBe("NO_PROFILE");
    expect(runner.started).toHaveLength(0);
    expect(
      new F14ValidationRepositories(store).getRun("run-no-profile")?.status,
    ).toBe("not_run");
  });

  it("selects the requested phase, stops after the first non-pass, and is idempotent", async () => {
    const { root, store } = await fixture();
    const runner = new FakeRunner([{ exitCode: 1 }], "token=super-secret\n");
    const validation = service(store, root, runner);
    const input = request(readyResolution());

    const result = await validation.run(input);
    const replay = await validation.run(input);
    const steps = result.record.evidence.steps;

    expect(result.record.evidence.status).toBe("failed");
    expect(
      steps.map((step) => [step.stepId, step.status, step.reason]),
    ).toEqual([
      ["baseline", "not_run", "PHASE_NOT_SELECTED"],
      ["post-change", "failed", "NON_ZERO_EXIT"],
      ["both", "not_run", "PRIOR_STEP_STOPPED"],
    ]);
    expect(
      steps[1]?.kind === "command" ? steps[1].stdout?.text : "",
    ).not.toContain("super-secret");
    expect(runner.started).toHaveLength(1);
    expect(replay.record.version).toBe(result.record.version);
  });

  it("exposes bounded redacted validation context without process or write authority", async () => {
    const { root, store } = await fixture();
    const validation = service(
      store,
      root,
      new FakeRunner([{ exitCode: 1 }], "token=super-secret\n"),
    );
    const result = await validation.run(
      request(readyResolution(), {
        runId: "run-provider-context",
        idempotencyKey: "key-provider-context",
      }),
    );

    const context = validation.providerContext("run-provider-context");
    expect(context).toMatchObject({
      schemaVersion: 1,
      runId: "run-provider-context",
      operationId,
      status: "failed",
    });
    expect(JSON.stringify(context)).not.toContain("super-secret");
    expect(JSON.stringify(context)).not.toMatch(
      /executable|arguments|canonicalWorkingDirectory|resolvedExecutable|worktreePath|shell|environment/iu,
    );
    expect(context?.steps[1]).toMatchObject({
      status: "failed",
      stdout: { safe: true },
    });
    expect(context?.steps[1]?.stdout?.text).not.toContain("super-secret");

    const providerClaim = { status: "passed", exitCode: 0 };
    expect(providerClaim.status).toBe("passed");
    expect(validation.providerContext("run-provider-context")?.status).toBe(
      result.record.status,
    );
    expect(context?.steps[1]).not.toHaveProperty("write");
    expect(context?.steps[1]).not.toHaveProperty("command");
  });

  it("finalizes a running durable record as interrupted after restart", async () => {
    const { root, store } = await fixture();
    const resolution = readyResolution();
    const snapshot = createValidationSnapshot({
      resolved: resolution,
      snapshotId: "snapshot-restart",
      createdAt: TIME,
      worktree: {
        canonicalRoot: root,
        baselineRevision: "base",
        currentRevision: "head",
      },
    });
    const evidence = createInitialValidationRun({
      snapshot,
      runId: "run-restart",
      startedAt: TIME,
    });
    new F14ValidationRepositories(store, { clock: fakeClock() }).saveRunIntent({
      runId: "run-restart",
      operationId,
      idempotencyKey: "key-restart",
      correlationId: "correlation-restart",
      ownerType: "review",
      ownerId,
      consumer: "review",
      requestedPhase: "post_change",
      resolutionStatus: "ready",
      snapshot,
      evidence,
      nextAction: "WAIT_FOR_VALIDATION",
    });
    store.close();
    const reopened = await initializePersistence(
      {
        databasePath: path.join(root, "database", "prmonitor.sqlite"),
        backupRoot: path.join(root, "backups"),
      },
      { clock: { now: () => TIME }, applicationBuild: "f14-restart-test" },
    );
    stores.push(reopened);

    const restarted = service(reopened, root, new FakeRunner([]));
    await restarted.reconcileStartup();
    const recovered = restarted.read("run-restart");

    expect(recovered?.evidence.status).toBe("interrupted");
    expect(recovered?.evidence.reason).toBe("APPLICATION_RESTARTED");
    expect(recovered?.nextAction).toBe("REVIEW_VALIDATION_EVIDENCE");
  });

  it("keeps manual evidence separate and requires a current verified attestation", async () => {
    const { root, store } = await fixture();
    const validation = service(store, root, new FakeRunner([{ exitCode: 0 }]));
    const result = await validation.run(
      request(readyResolution(profileWithManualCheck()), {
        runId: "run-manual",
        idempotencyKey: "key-manual",
      }),
    );

    expect(result.record.evidence.status).toBe("not_run");
    expect(result.record.evidence.reason).toBe("MANUAL_CHECK_NOT_RUN");
    const attested = await validation.recordManualAttestation({
      runId: "run-manual",
      ownerId,
      checkId: "manual-check",
      outcome: "verified",
      attestedBy: "developer-1",
      notes: "Confirmed the expected UI state.",
    });
    const manualStep = attested.record.evidence.steps.find(
      (step) => step.stepId === "manual-check",
    );

    expect(attested.record.evidence.status).toBe("passed");
    expect(attested.record.evidence.manualAttestations[0]?.outcome).toBe(
      "verified",
    );
    expect(
      validation
        .readModel("run-manual")
        ?.steps.find((step) => step.stepId === "manual-check")?.manualLabel,
    ).toBe("Verified manually");
    expect(manualStep?.kind).toBe("manual");
  });

  it("records cancellation and the required graceful termination window", async () => {
    const { root, store } = await fixture();
    let resolveWait!: (value: ExitObservation) => void;
    const wait = new Promise<ExitObservation>((resolve) => {
      resolveWait = resolve;
    });
    const runner = new FakeRunner([wait]);
    const calls = { graceful: [], force: [] } as {
      graceful: string[];
      force: string[][];
    };
    const waits: number[] = [];
    const validation = service(
      store,
      root,
      runner,
      fakeProcessControl(["tree-1"], calls),
      fakeClock(waits),
    );
    const running = validation.run(
      request(readyResolution(), {
        runId: "run-cancel",
        idempotencyKey: "key-cancel",
      }),
    );
    while (runner.started.length === 0) await Promise.resolve();
    expect(validation.cancel("run-cancel")).toBe(true);
    resolveWait({ exitCode: 0 });
    const result = await running;

    expect(result.record.evidence.status).toBe("interrupted");
    expect(result.record.evidence.reason).toBe("USER_CANCELLED");
    expect(calls.graceful).toEqual(["tree-1"]);
    expect(calls.force).toEqual([["tree-1"]]);
    expect(waits).toEqual([5_000]);
  });
});
