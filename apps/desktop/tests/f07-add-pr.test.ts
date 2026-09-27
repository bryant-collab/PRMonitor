import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createF07PersistenceRepositories,
  createPersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import { ManagedPrService } from "../src/main/managed-pr-service";
import {
  LocalGitInspector,
  type ReadOnlyGitCommandRunner,
} from "../src/main/local-git-inspector";
import {
  createRepositoryIdentity,
  remoteServerIdentity,
  type GithubRestResult,
  type GithubPullRequestMetadata,
} from "../src/shared/github-rest";
import { normalizeGithubServerUrl } from "../src/shared/github-server";
import type { GithubServerProfileRecord } from "../src/main/persistence/repositories";
import type { ManagedPrRemoteSnapshot } from "../src/shared/managed-pr";

const FIXED_TIME = "2026-09-21T12:00:00.000Z";
const fixtures: Array<{
  readonly root: string;
  readonly store: PersistenceStore;
}> = [];

async function createFixture(): Promise<{
  readonly root: string;
  readonly store: PersistenceStore;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f07-"));
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => FIXED_TIME } },
  );
  const fixture = { root, store };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture === undefined) continue;
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function profile(): GithubServerProfileRecord {
  const identity = normalizeGithubServerUrl("https://github.com");
  if (!identity.ok) throw new Error("profile fixture failed");
  return {
    id: "profile-record",
    schemaVersion: 1,
    version: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    payload: {},
    payloadHash: "profile-hash",
    serverId: "server-1",
    host: identity.value.host,
    apiBaseUrl: identity.value.apiBaseUrl,
    kind: identity.value.kind,
    webOrigin: identity.value.webOrigin,
    displayName: "GitHub.com",
    auth: {
      serverId: "server-1",
      status: "VERIFIED",
      storeState: "AVAILABLE",
      activeRef: "prmonitor.github.v1.0123456789abcdef",
      activeRevision: 1,
      version: 1,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    },
  };
}

function metadata(): GithubPullRequestMetadata {
  const normalized = normalizeGithubServerUrl("https://github.com");
  if (!normalized.ok) throw new Error("server fixture failed");
  const server = remoteServerIdentity(normalized.value);
  const base = createRepositoryIdentity({
    server,
    owner: "owner",
    name: "base",
  });
  const head = createRepositoryIdentity({
    server,
    owner: "contributor",
    name: "fork",
  });
  const identity = {
    schemaVersion: 1 as const,
    server,
    repository: base,
    number: 7,
    key: `${base.key}#7`,
  };
  return {
    identity,
    number: 7,
    state: "OPEN",
    merged: false,
    title: "A safe pull request",
    baseRepository: base,
    headRepository: head,
    baseBranch: "main",
    headBranch: "feature",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    defaultBranch: "trunk",
  };
}

function updatedResult(value: GithubPullRequestMetadata) {
  return {
    ok: true as const,
    outcome: "UPDATED" as const,
    value,
    metadata: {
      schemaVersion: 1 as const,
      correlationId: "f07-test",
      resource: "pull_request" as const,
      scopeKey: value.identity.key,
      status: 200,
    },
  };
}

function failedResult(
  value: GithubPullRequestMetadata,
): GithubRestResult<GithubPullRequestMetadata> {
  return {
    ok: false,
    outcome: "FAILED",
    reason: {
      code: "NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "The pull request was not found.",
      nextAction: "FIX_INPUT",
      correlationId: "f07-test",
    },
    metadata: {
      schemaVersion: 1,
      correlationId: "f07-test",
      resource: "pull_request",
      scopeKey: value.identity.key,
    },
  };
}

function remoteSnapshot(): ManagedPrRemoteSnapshot {
  const value = metadata();
  return {
    schemaVersion: 1,
    canonicalUrl: "https://github.com/owner/base/pull/7",
    pullRequestKey: value.identity.key,
    serverId: "server-1",
    server: value.identity.server,
    owner: "owner",
    repositoryName: "base",
    number: 7,
    state: value.state,
    merged: false,
    title: value.title,
    baseRepository: value.baseRepository,
    headRepository: value.headRepository,
    baseBranch: value.baseBranch,
    headBranch: value.headBranch,
    baseSha: value.baseSha,
    headSha: value.headSha,
    defaultBranch: value.defaultBranch,
  };
}

describe("F07 add and manage a pull request", () => {
  it("commits one remote identity and keeps multiline configuration revision history immutable", async () => {
    const fixture = await createFixture();
    const base = createPersistenceRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    base.putGithubServer({
      serverId: "server-1",
      host: "github.com",
      apiBaseUrl: "https://api.github.com",
    });
    const repositories = createF07PersistenceRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    const begun = repositories.beginAddAttempt({
      attemptId: "add-pr-test",
      correlationId: "f07-add-test",
      idempotencyKey: "f07-add-test",
      canonicalPrKey: remoteSnapshot().pullRequestKey,
      serverId: "server-1",
      profileVersion: 1,
      normalizedUrl: "https://github.com/owner/base/pull/7",
      parsedInput: { owner: "owner", repositoryName: "base", number: 7 },
      context: "line one\nline two",
      syncSourceBranchOverride: null,
    });
    expect(begun.shouldFetch).toBe(true);
    const managed = repositories.commitManagedPr({
      attemptId: begun.attempt.id,
      managedPrId: "managed-pr-test",
      remote: remoteSnapshot(),
      primaryState: "WATCHING",
      context: "line one\nline two",
      syncSourceBranchOverride: null,
    });
    expect(managed.localSetupStatus).toBe("LOCAL_CLONE_REQUIRED");
    expect(managed.configuration.context).toBe("line one\nline two");
    const updated = repositories.saveConfiguration({
      managedPrId: managed.id,
      expectedVersion: managed.version,
      context: "new context\nwith a second line",
      syncSourceBranchOverride: "integration",
    });
    expect(updated.configuration.revision).toBe(2);
    expect(updated.configuration.context).toBe(
      "new context\nwith a second line",
    );
    expect(
      repositories.getManagedPr("managed-pr-test")?.configuration.revision,
    ).toBe(2);
    const restored = repositories.saveConfiguration({
      managedPrId: managed.id,
      expectedVersion: updated.version,
      context: "line one\nline two",
      syncSourceBranchOverride: null,
    });
    expect(restored.configuration.revision).toBe(3);
    expect(restored.configuration.context).toBe("line one\nline two");
    expect(
      fixture.store.read<{ readonly context_text: string }>(
        "SELECT context_text FROM f07_pr_configuration_revisions WHERE managed_pr_id = ? AND revision = 2",
        managed.id,
      )?.context_text,
    ).toBe("new context\nwith a second line");
    expect(() =>
      repositories.saveConfiguration({
        managedPrId: managed.id,
        expectedVersion: managed.version,
        context: "stale",
        syncSourceBranchOverride: "main",
      }),
    ).toThrow();
    expect(
      repositories.beginAddAttempt({
        attemptId: "add-pr-test",
        correlationId: "f07-add-test",
        idempotencyKey: "f07-add-test",
        canonicalPrKey: remoteSnapshot().pullRequestKey,
        serverId: "server-1",
        profileVersion: 1,
        normalizedUrl: "https://github.com/owner/base/pull/7",
        parsedInput: { owner: "owner", repositoryName: "base", number: 7 },
        context: "ignored",
        syncSourceBranchOverride: "main",
      }).shouldFetch,
    ).toBe(false);
  });

  it("persists the add intent before F06 and does not duplicate a successful replay", async () => {
    const fixture = await createFixture();
    const base = createPersistenceRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    base.putGithubServer({
      serverId: "server-1",
      host: "github.com",
      apiBaseUrl: "https://api.github.com",
    });
    let fetches = 0;
    const service = new ManagedPrService({
      repositories: createF07PersistenceRepositories(fixture.store, {
        clock: { now: () => FIXED_TIME },
      }),
      profileForServerId: (serverId) =>
        serverId === "server-1" ? profile() : undefined,
      getPullRequest: async () => {
        fetches += 1;
        return updatedResult(metadata());
      },
    });
    const first = await service.add({
      serverId: "server-1",
      url: "https://github.com/owner/base/pull/7",
      context: "preserve\nlines",
    });
    expect(first.status).toBe("SUCCEEDED");
    expect(first.managedPr?.headRepository.owner).toBe("contributor");
    expect(first.managedPr?.defaultBranch).toBe("trunk");
    const second = await service.add({
      serverId: "server-1",
      url: "https://github.com/owner/base/pull/7",
    });
    expect(second.status).toBe("SUCCEEDED");
    expect(fetches).toBe(1);
    expect((await service.list()).managedPrs).toHaveLength(1);
    expect((await service.list()).attempts[0]?.correlationId).toMatch(
      /^f07-add-/u,
    );
    expect("parsedInput" in (await service.list()).attempts[0]!).toBe(false);
  });

  it("rejects malformed input before F06 and retains cancelled or failed attempts for recovery", async () => {
    const fixture = await createFixture();
    const base = createPersistenceRepositories(fixture.store, {
      clock: { now: () => FIXED_TIME },
    });
    base.putGithubServer({
      serverId: "server-1",
      host: "github.com",
      apiBaseUrl: "https://api.github.com",
    });
    let fetches = 0;
    let failFirst = true;
    const service = new ManagedPrService({
      repositories: createF07PersistenceRepositories(fixture.store, {
        clock: { now: () => FIXED_TIME },
      }),
      profileForServerId: (serverId) =>
        serverId === "server-1" ? profile() : undefined,
      getPullRequest: async ({ signal }) => {
        fetches += 1;
        if (signal?.aborted) throw new Error("cancelled by test");
        if (failFirst) {
          failFirst = false;
          return failedResult(metadata());
        }
        return updatedResult(metadata());
      },
    });

    const invalid = await service.add({
      serverId: "server-1",
      url: "not-a-pull-request-url",
    });
    expect(invalid.status).toBe("FAILED");
    expect(fetches).toBe(0);
    expect(service.list().attempts).toHaveLength(0);

    const failed = await service.add({
      serverId: "server-1",
      url: "https://github.com/owner/base/pull/7",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.attempt?.status).toBe("FAILED");
    expect(service.list().managedPrs).toHaveLength(0);
    const retried = await service.retryAdd(failed.attempt!.id);
    expect(retried.kind).toBe("RETRY_ADD_PR");
    expect(retried.status).toBe("SUCCEEDED");
    expect(fetches).toBe(2);
    expect(service.list().managedPrs).toHaveLength(1);

    const cancellationFixture = await createFixture();
    const cancellationBase = createPersistenceRepositories(
      cancellationFixture.store,
      { clock: { now: () => FIXED_TIME } },
    );
    cancellationBase.putGithubServer({
      serverId: "server-1",
      host: "github.com",
      apiBaseUrl: "https://api.github.com",
    });
    const cancellation = new AbortController();
    cancellation.abort();
    const cancelledService = new ManagedPrService({
      repositories: createF07PersistenceRepositories(
        cancellationFixture.store,
        { clock: { now: () => FIXED_TIME } },
      ),
      profileForServerId: (serverId) =>
        serverId === "server-1" ? profile() : undefined,
      getPullRequest: async ({ signal }) => {
        if (signal?.aborted) throw new Error("cancelled by test");
        return updatedResult(metadata());
      },
    });
    const cancelled = await cancelledService.add(
      { serverId: "server-1", url: "https://github.com/owner/base/pull/8" },
      cancellation.signal,
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.attempt?.status).toBe("CANCELLED");
    expect(cancelledService.list().managedPrs).toHaveLength(0);
  });

  it("validates a clone read-only and preserves the dirty status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f07-git-"));
    const calls: string[][] = [];
    const runner: ReadOnlyGitCommandRunner = {
      run: async (args) => {
        calls.push([...args]);
        const command = args.join(" ");
        if (command.includes("--show-toplevel"))
          return { stdout: root, stderr: "" };
        if (command.includes("--is-bare-repository"))
          return { stdout: "false\n", stderr: "" };
        if (command.endsWith(" remote"))
          return { stdout: "origin\n", stderr: "" };
        if (command.includes("remote get-url"))
          return { stdout: "https://github.com/owner/base.git\n", stderr: "" };
        if (command.includes("status"))
          return { stdout: " M src/file.ts\n", stderr: "" };
        throw new Error(`unexpected command ${command}`);
      },
    };
    try {
      const normalized = normalizeGithubServerUrl("https://github.com");
      if (!normalized.ok) throw new Error("server fixture failed");
      const server = remoteServerIdentity(normalized.value);
      const expectedRepository = createRepositoryIdentity({
        server,
        owner: "owner",
        name: "base",
      });
      const inspected = await new LocalGitInspector({
        runner,
        now: () => FIXED_TIME,
      }).inspect({ path: root, server, expectedRepository });
      expect(inspected.ok).toBe(true);
      if (inspected.ok) {
        expect(inspected.status).toBe("DIRTY");
        expect(inspected.cleanState).toBe("DIRTY");
      }
      expect(
        calls.every(
          (call) =>
            ![
              "fetch",
              "checkout",
              "reset",
              "clean",
              "pull",
              "worktree",
            ].includes(call[call.length - 1] ?? ""),
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
