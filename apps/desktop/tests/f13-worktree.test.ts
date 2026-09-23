import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  F13PersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import {
  F13WorktreeService,
  type F13OsPathAdapter,
} from "../src/main/f13-service";

const execFileAsync = promisify(execFile);
const FIXED_TIME = "2026-09-23T12:00:00.000Z";

interface Fixture {
  readonly root: string;
  readonly store: PersistenceStore;
  readonly service: F13WorktreeService;
  readonly developerClone: string;
  readonly baseSha: string;
  readonly headSha: string;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      LC_ALL: "C",
      LANG: "C",
    },
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function readNormalized(filePath: string): Promise<string> {
  return (await readFile(filePath, "utf8")).replaceAll("\r\n", "\n");
}

async function createFixture(osAdapter?: F13OsPathAdapter): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f13-"));
  const developerClone = path.join(root, "developer-clone");
  const worktreeRoot = path.join(root, "owned-worktrees");
  await mkdir(developerClone, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
  await git(developerClone, "init", "-b", "main");
  await git(developerClone, "config", "user.email", "f13@example.invalid");
  await git(developerClone, "config", "user.name", "F13 Test");
  await writeFile(path.join(developerClone, "tracked.txt"), "base\n", "utf8");
  await writeFile(
    path.join(developerClone, ".gitignore"),
    "ignored.txt\n",
    "utf8",
  );
  await git(developerClone, "add", ".");
  await git(developerClone, "commit", "-m", "base");
  const baseSha = await git(developerClone, "rev-parse", "HEAD");
  await git(developerClone, "checkout", "-b", "feature");
  await writeFile(
    path.join(developerClone, "tracked.txt"),
    "feature\n",
    "utf8",
  );
  await git(developerClone, "commit", "-am", "feature");
  const headSha = await git(developerClone, "rev-parse", "HEAD");
  await writeFile(
    path.join(developerClone, "tracked.txt"),
    "feature\ndirty developer edit\n",
    "utf8",
  );
  await writeFile(
    path.join(developerClone, "developer-only.txt"),
    "must remain\n",
    "utf8",
  );

  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => FIXED_TIME } },
  );
  const service = new F13WorktreeService({
    repositories: new F13PersistenceRepositories(store, {
      clock: { now: () => FIXED_TIME },
    }),
    defaultRoot: worktreeRoot,
    now: () => FIXED_TIME,
    os: osAdapter,
  });
  const fixture: Fixture = {
    root,
    store,
    service,
    developerClone,
    baseSha,
    headSha,
    async cleanup(): Promise<void> {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) await fixture.cleanup();
  }
});

function reviewRequest(fixture: Fixture, operationId = "operation-1") {
  return {
    operationId,
    idempotencyKey: `${operationId}-key`,
    correlationId: `${operationId}-correlation`,
    ownerType: "REVIEW_BUNDLE",
    ownerId: `${operationId}-owner`,
    operationKind: "REVIEW" as const,
    developerClonePath: fixture.developerClone,
    refs: {
      baseRepository: {
        serverId: "server-1",
        owner: "base-owner",
        name: "base-repo",
      },
      headRepository: {
        serverId: "server-1",
        owner: "head-owner",
        name: "head-repo",
      },
      baseBranch: "main",
      headBranch: "feature",
      prBaseSha: fixture.baseSha,
      prHeadSha: fixture.headSha,
    },
  };
}

describe("F13 operation-owned worktrees and change attribution", () => {
  it("prepares an exact detached worktree without touching a dirty developer clone and replays idempotently", async () => {
    const fixture = await createFixture();
    const beforeTracked = await readFile(
      path.join(fixture.developerClone, "tracked.txt"),
      "utf8",
    );
    const beforeUntracked = await readFile(
      path.join(fixture.developerClone, "developer-only.txt"),
      "utf8",
    );
    const request = reviewRequest(fixture);
    const first = await fixture.service.prepare(request);
    expect(first.ok).toBe(true);
    expect(first.worktree?.lifecycle).toBe("ACTIVE");
    expect(first.worktree?.currentHeadSha).toBe(fixture.headSha);
    expect(first.inspection?.proposedDiff?.files).toEqual([]);
    const replay = await fixture.service.prepare(request);
    expect(replay.ok).toBe(true);
    expect(replay.worktree?.canonicalPath).toBe(first.worktree?.canonicalPath);
    expect(await git(fixture.developerClone, "rev-parse", "HEAD")).toBe(
      fixture.headSha,
    );
    expect(
      await readFile(path.join(fixture.developerClone, "tracked.txt"), "utf8"),
    ).toBe(beforeTracked);
    expect(
      await readFile(
        path.join(fixture.developerClone, "developer-only.txt"),
        "utf8",
      ),
    ).toBe(beforeUntracked);
  });

  it("keeps proposed and context diffs separate and records before/after turn evidence", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture);
    const prepared = await fixture.service.prepare(request);
    expect(prepared.ok).toBe(true);
    const operationId = request.operationId;
    const before = await fixture.service.beginAiTurn({
      operationId,
      ownerId: request.ownerId,
      turnId: "turn-1",
    });
    expect(before.ok).toBe(true);
    const worktree = prepared.worktree?.canonicalPath;
    expect(worktree).toBeDefined();
    await writeFile(
      path.join(worktree!, "tracked.txt"),
      "feature\nai change\n",
      "utf8",
    );
    const after = await fixture.service.completeAiTurn({
      operationId,
      ownerId: request.ownerId,
      turnId: "turn-1",
      beforeSnapshotId: before.snapshot!.snapshotId,
    });
    expect(after.ok).toBe(true);
    expect(after.changeSummary?.modified).toContain("tracked.txt");
    expect(after.snapshot?.phase).toBe("AFTER_AI");
    const inspection = await fixture.service.inspectOperation(
      operationId,
      request.ownerId,
    );
    expect(inspection.proposedDiff?.baselineSha).toBe(fixture.headSha);
    expect(inspection.contextDiff?.baselineSha).toBe(fixture.baseSha);
    expect(inspection.proposedDiff?.diffHash).not.toBe(
      inspection.contextDiff?.diffHash,
    );
  });

  it("hands providers only the canonical operation path and actual Git evidence", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture);
    const prepared = await fixture.service.prepare(request);
    const canonicalPath = prepared.worktree!.canonicalPath;

    const readOnly = await fixture.service.getProviderWorktreeHandoff({
      operationId: request.operationId,
      ownerId: request.ownerId,
    });
    expect(readOnly.ok).toBe(true);
    expect(readOnly.handoff).toMatchObject({
      operationId: request.operationId,
      canonicalPath,
      access: "READ_ONLY",
      ownership: {
        kind: "OPERATION_OWNED",
        ownerId: request.ownerId,
      },
      permittedCapabilities: {
        readFiles: true,
        writeFiles: false,
        executeCommands: false,
        network: false,
        publication: false,
      },
    });
    expect(readOnly.handoff?.canonicalPath).not.toBe(fixture.developerClone);
    expect(readOnly.handoff?.actualState.currentHeadRevision).toBe(
      fixture.headSha,
    );

    const before = await fixture.service.beginAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "handoff-turn",
    });
    expect(before.worktree).toMatchObject({
      canonicalPath,
      access: "WORKTREE_WRITE",
      permittedCapabilities: { writeFiles: true },
    });
    await writeFile(path.join(canonicalPath, "actual.txt"), "actual\n", "utf8");
    const after = await fixture.service.completeAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "handoff-turn",
      beforeSnapshotId: before.snapshot!.snapshotId,
    });
    expect(after.changeSummary?.changed).toContain("actual.txt");
    expect(after.worktree?.actualState.files.map((file) => file.path)).toContain(
      "actual.txt",
    );

    const providerClaim = {
      changedPaths: ["provider-only.txt"],
      currentHeadRevision: "provider-claim-is-not-Git-state",
    };
    expect(after.changeSummary?.changed).not.toContain(
      providerClaim.changedPaths[0],
    );
    expect(after.worktree?.actualState.currentHeadRevision).not.toBe(
      providerClaim.currentHeadRevision,
    );
  });

  it("requires confirmation for Clear All and preserves ignored files", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture);
    const prepared = await fixture.service.prepare(request);
    const worktree = prepared.worktree!.canonicalPath;
    await writeFile(path.join(worktree, "tracked.txt"), "dirty\n", "utf8");
    await writeFile(
      path.join(worktree, "untracked.txt"),
      "remove me\n",
      "utf8",
    );
    await writeFile(path.join(worktree, "ignored.txt"), "keep me\n", "utf8");

    const blocked = await fixture.service.clearChanges({
      operationId: request.operationId,
      ownerId: request.ownerId,
      choice: "CLEAR_ALL",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason?.code).toBe("DESTRUCTIVE_CONFIRMATION_REQUIRED");
    expect(await readFile(path.join(worktree, "untracked.txt"), "utf8")).toBe(
      "remove me\n",
    );

    const cleared = await fixture.service.clearChanges({
      operationId: request.operationId,
      ownerId: request.ownerId,
      choice: "CLEAR_ALL",
      confirmed: true,
    });
    expect(cleared.ok).toBe(true);
    expect(cleared.worktree.lifecycle).toBe("CLEARED");
    expect(cleared.preserved).toContain("ignored.txt");
    await expect(
      readFile(path.join(worktree, "untracked.txt"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(worktree, "ignored.txt"), "utf8")).toBe(
      "keep me\n",
    );
    expect(await readNormalized(path.join(worktree, "tracked.txt"))).toBe(
      "feature\n",
    );
  });

  it("blocks destructive clearing after the operation HEAD moves", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture);
    const prepared = await fixture.service.prepare(request);
    const worktree = prepared.worktree!.canonicalPath;
    await git(worktree, "reset", "--hard", fixture.baseSha);

    const result = await fixture.service.clearChanges({
      operationId: request.operationId,
      ownerId: request.ownerId,
      choice: "CLEAR_ALL",
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason?.code).toBe("WORKTREE_HEAD_MOVED");
    expect(await git(worktree, "rev-parse", "HEAD")).toBe(fixture.baseSha);
  });

  it("changes diff evidence when an untracked file keeps its path but changes content", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture);
    const prepared = await fixture.service.prepare(request);
    const worktree = prepared.worktree!.canonicalPath;
    await writeFile(path.join(worktree, "generated.txt"), "one\n", "utf8");
    const first = await fixture.service.inspectOperation(
      request.operationId,
      request.ownerId,
    );
    await writeFile(path.join(worktree, "generated.txt"), "two\n", "utf8");
    const second = await fixture.service.inspectOperation(
      request.operationId,
      request.ownerId,
    );
    expect(first.proposedDiff?.diffHash).not.toBe(
      second.proposedDiff?.diffHash,
    );
    expect(first.proposedDiff?.untrackedEvidence?.[0]?.contentHash).not.toBe(
      second.proposedDiff?.untrackedEvidence?.[0]?.contentHash,
    );
  });

  it("clears only independent AI changes, but blocks same-line overlap without mutation", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture);
    const prepared = await fixture.service.prepare(request);
    const worktree = prepared.worktree!.canonicalPath;
    const before = await fixture.service.beginAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "turn-1",
    });
    await writeFile(
      path.join(worktree, "tracked.txt"),
      "feature\nai change\n",
      "utf8",
    );
    const after = await fixture.service.completeAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "turn-1",
      beforeSnapshotId: before.snapshot!.snapshotId,
    });
    await writeFile(path.join(worktree, "manual.txt"), "manual\n", "utf8");
    const cleared = await fixture.service.clearChanges({
      operationId: request.operationId,
      ownerId: request.ownerId,
      choice: "CLEAR_AI_ONLY",
      beforeSnapshotId: before.snapshot!.snapshotId,
      afterSnapshotId: after.snapshot!.snapshotId,
    });
    expect(cleared.ok).toBe(true);
    expect(await readNormalized(path.join(worktree, "tracked.txt"))).toBe(
      "feature\n",
    );
    expect(await readNormalized(path.join(worktree, "manual.txt"))).toBe(
      "manual\n",
    );

    const beforeOverlap = await fixture.service.beginAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "turn-2",
    });
    await writeFile(
      path.join(worktree, "tracked.txt"),
      "feature\nai change\n",
      "utf8",
    );
    const afterOverlap = await fixture.service.completeAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "turn-2",
      beforeSnapshotId: beforeOverlap.snapshot!.snapshotId,
    });
    await writeFile(
      path.join(worktree, "tracked.txt"),
      "feature\nai manual replacement\n",
      "utf8",
    );
    const blocked = await fixture.service.clearChanges({
      operationId: request.operationId,
      ownerId: request.ownerId,
      choice: "CLEAR_AI_ONLY",
      beforeSnapshotId: beforeOverlap.snapshot!.snapshotId,
      afterSnapshotId: afterOverlap.snapshot!.snapshotId,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason?.code).toBe("AI_MANUAL_OVERLAP");
    expect(await readNormalized(path.join(worktree, "tracked.txt"))).toBe(
      "feature\nai manual replacement\n",
    );
  });

  it("uses a distinct synchronization path and refuses unsafe open/reveal targets", async () => {
    const calls: string[] = [];
    const fixture = await createFixture({
      openDirectory: async (target) => {
        calls.push(`open-dir:${target}`);
        return { ok: true };
      },
      openFile: async (target) => {
        calls.push(`open-file:${target}`);
        return { ok: true };
      },
      revealFile: async (target) => {
        calls.push(`reveal:${target}`);
        return { ok: true };
      },
    });
    const review = await fixture.service.prepare(
      reviewRequest(fixture, "review-op"),
    );
    const syncRequest = {
      operationId: "sync-op",
      idempotencyKey: "sync-op-key",
      correlationId: "sync-op-correlation",
      ownerType: "SYNC_RESULT",
      ownerId: "sync-op-owner",
      operationKind: "SYNCHRONIZATION" as const,
      developerClonePath: fixture.developerClone,
      refs: {
        sourceRepository: {
          serverId: "server-1",
          owner: "base-owner",
          name: "base-repo",
        },
        destinationRepository: {
          serverId: "server-1",
          owner: "head-owner",
          name: "head-repo",
        },
        sourceBranch: "main",
        destinationBranch: "feature",
        syncSourceSha: fixture.baseSha,
        prHeadSha: fixture.headSha,
      },
    };
    const sync = await fixture.service.prepareSynchronization(syncRequest);
    expect(sync.ok).toBe(true);
    expect(sync.worktree?.refs).toMatchObject({
      syncMergeBaseSha: fixture.baseSha,
    });
    expect(sync.worktree?.canonicalPath).not.toBe(
      review.worktree?.canonicalPath,
    );
    const escape = await fixture.service.openFile({
      operationId: "sync-op",
      relativePath: "../developer-clone/tracked.txt",
    });
    expect(escape.ok).toBe(false);
    expect(escape.reason?.code).toBe("PATH_ESCAPE_REJECTED");
    const opened = await fixture.service.openWorktree({
      operationId: "sync-op",
    });
    expect(opened.ok).toBe(true);
    expect(calls.some((call) => call.startsWith("open-dir:"))).toBe(true);
  });

  it("reads durable state after service recreation and blocks released mutation", async () => {
    const fixture = await createFixture();
    const request = reviewRequest(fixture, "restart-op");
    const prepared = await fixture.service.prepare(request);
    expect(prepared.ok).toBe(true);

    const restarted = new F13WorktreeService({
      repositories: new F13PersistenceRepositories(fixture.store, {
        clock: { now: () => FIXED_TIME },
      }),
      defaultRoot: path.join(fixture.root, "owned-worktrees"),
      now: () => FIXED_TIME,
    });
    await restarted.reconcileStartup();
    expect(restarted.getWorktree(request.operationId)?.canonicalPath).toBe(
      prepared.worktree?.canonicalPath,
    );
    expect(
      await restarted.releaseWorktree({
        operationId: request.operationId,
        ownerId: request.ownerId,
      }),
    ).toMatchObject({ ok: true });
    const turn = await restarted.beginAiTurn({
      operationId: request.operationId,
      ownerId: request.ownerId,
      turnId: "released-turn",
    });
    expect(turn.ok).toBe(false);
    expect(turn.reason?.code).toBe("WORKTREE_MUTATION_NOT_ALLOWED");
  });
});
