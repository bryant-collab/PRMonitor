import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFeedbackResourceScope,
  createRepositoryIdentity,
  remoteServerIdentity,
  type GithubFeedbackCollection,
  type GithubFeedbackRecord,
  type GithubPullRequestMetadata,
  type GithubRestResult,
} from "../src/shared/github-rest";
import { normalizeGithubServerUrl } from "../src/shared/github-server";
import type { ManagedPrRemoteSnapshot } from "../src/shared/managed-pr";
import {
  createF07PersistenceRepositories,
  createPersistenceRepositories,
  F10PersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";
import type { GithubReadClient } from "../src/main/github-rest-client";
import type { ActivityWriter } from "../src/main/activity-service";
import {
  buildF10ObservedVersion,
  pollingScopesForManagedPr,
  PrWatcher,
} from "../src/main/pr-watcher";
import {
  DEFAULT_PR_POLL_INTERVAL_MS,
  MAX_PR_POLL_INTERVAL_MS,
  MIN_PR_POLL_INTERVAL_MS,
  type F10ResourceKind,
} from "../src/main/pr-polling-contracts";

const TIME = "2026-09-21T12:00:00.000Z";
const fixtures: Array<{
  readonly root: string;
  readonly store: PersistenceStore;
}> = [];

async function fixture(): Promise<{
  readonly root: string;
  readonly store: PersistenceStore;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f10-"));
  const store = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => TIME }, applicationBuild: "f10-test" },
  );
  const value = { root, store };
  fixtures.push(value);
  return value;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const value = fixtures.pop();
    if (value === undefined) continue;
    value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

function remoteMetadata(
  input: {
    readonly owner?: string;
    readonly repositoryName?: string;
    readonly number?: number;
  } = {},
): {
  readonly metadata: GithubPullRequestMetadata;
  readonly remote: ManagedPrRemoteSnapshot;
} {
  const normalized = normalizeGithubServerUrl("https://github.com");
  if (!normalized.ok) throw new Error("F10_SERVER_FIXTURE_FAILED");
  const server = remoteServerIdentity(normalized.value);
  const owner = input.owner ?? "owner";
  const repositoryName = input.repositoryName ?? "repo";
  const number = input.number ?? 42;
  const base = createRepositoryIdentity({
    server,
    owner,
    name: repositoryName,
  });
  const head = createRepositoryIdentity({
    server,
    owner,
    name: repositoryName,
  });
  const identity = {
    schemaVersion: 1 as const,
    server,
    repository: base,
    number,
    key: `${base.key}#${number}`,
  };
  const metadata: GithubPullRequestMetadata = {
    identity,
    number,
    state: "OPEN",
    merged: false,
    title: "F10 fixture",
    baseRepository: base,
    headRepository: head,
    baseBranch: "main",
    headBranch: "feature",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    defaultBranch: "main",
  };
  return {
    metadata,
    remote: {
      schemaVersion: 1,
      canonicalUrl: `https://github.com/${owner}/${repositoryName}/pull/${number}`,
      pullRequestKey: identity.key,
      serverId: "server-1",
      server,
      owner,
      repositoryName,
      number,
      state: "OPEN",
      merged: false,
      title: metadata.title,
      baseRepository: base,
      headRepository: head,
      baseBranch: metadata.baseBranch,
      headBranch: metadata.headBranch,
      baseSha: metadata.baseSha,
      headSha: metadata.headSha,
      defaultBranch: metadata.defaultBranch,
    },
  };
}

async function addManagedPr(
  store: PersistenceStore,
  input: {
    readonly id?: string;
    readonly owner?: string;
    readonly repositoryName?: string;
    readonly number?: number;
  } = {},
): Promise<{
  readonly id: string;
  readonly metadata: GithubPullRequestMetadata;
}> {
  const { metadata, remote } = remoteMetadata(input);
  const managedPrId = input.id ?? "managed-pr-f10";
  const suffix = managedPrId.replace(/[^A-Za-z0-9]/gu, "-");
  const base = createPersistenceRepositories(store, {
    clock: { now: () => TIME },
  });
  base.putGithubServer({
    serverId: "server-1",
    host: "github.com",
    apiBaseUrl: "https://api.github.com",
  });
  const repositories = createF07PersistenceRepositories(store, {
    clock: { now: () => TIME },
  });
  repositories.beginAddAttempt({
    attemptId: `f10-add-attempt-${suffix}`,
    correlationId: `f10-add-correlation-${suffix}`,
    idempotencyKey: `f10-add-key-${suffix}`,
    canonicalPrKey: metadata.identity.key,
    serverId: "server-1",
    profileVersion: 1,
    normalizedUrl: remote.canonicalUrl,
    parsedInput: { owner: "owner", repositoryName: "repo", number: 42 },
    context: null,
    syncSourceBranchOverride: null,
  });
  const managed = repositories.commitManagedPr({
    attemptId: `f10-add-attempt-${suffix}`,
    managedPrId,
    remote,
    primaryState: "WATCHING",
    context: null,
    syncSourceBranchOverride: null,
  });
  return { id: managed.id, metadata };
}

function feedback(
  metadata: GithubPullRequestMetadata,
  resource: Exclude<F10ResourceKind, "pull_request">,
  id: string,
  body: string | undefined,
  overrides: Partial<GithubFeedbackRecord> = {},
): GithubFeedbackRecord {
  const scope = createFeedbackResourceScope({
    pullRequest: metadata.identity,
    resource,
  });
  const source: GithubFeedbackRecord["source"] =
    resource === "review_comments"
      ? "REVIEW_COMMENT"
      : resource === "reviews"
        ? "REVIEW"
        : "ISSUE_COMMENT";
  const identity = {
    schemaVersion: 1 as const,
    source,
    resource: scope,
    remoteId: id,
    key: `${scope.key}:object:${id}`,
  };
  return {
    schemaVersion: 1,
    identity,
    source,
    pullRequest: metadata.identity,
    repository: metadata.baseRepository,
    author: { id: 7, login: "reviewer" },
    ...(body === undefined ? {} : { body }),
    state: resource === "reviews" ? "APPROVED" : undefined,
    createdAt: undefined,
    updatedAt: undefined,
    location:
      resource === "review_comments"
        ? { path: "src/app.ts", line: 12, side: "RIGHT" }
        : undefined,
    semanticInput: {
      source,
      remoteId: id,
      replyTo: resource === "review_comments" ? "root-1" : null,
      ...(overrides.semanticInput ?? {}),
    },
    ...overrides,
  };
}

function updated<T>(
  resource: "pull_request" | Exclude<F10ResourceKind, "pull_request">,
  scopeKey: string,
  value: T,
  conditional: string,
): GithubRestResult<T> {
  return {
    ok: true,
    outcome: "UPDATED",
    value,
    metadata: {
      schemaVersion: 1,
      correlationId: "f10-fake-client",
      resource,
      scopeKey,
      status: 200,
      conditional: { etag: conditional },
    },
  };
}

function notModified(
  resource: "pull_request" | Exclude<F10ResourceKind, "pull_request">,
  scopeKey: string,
  conditional: string,
): GithubRestResult<never> {
  return {
    ok: true,
    outcome: "NOT_MODIFIED",
    metadata: {
      schemaVersion: 1,
      correlationId: "f10-fake-client",
      resource,
      scopeKey,
      status: 304,
      conditional: { etag: conditional },
    },
  };
}

function failed(
  resource: "pull_request" | Exclude<F10ResourceKind, "pull_request">,
  scopeKey: string,
): GithubRestResult<never> {
  return {
    ok: false,
    outcome: "FAILED",
    reason: {
      code: "NETWORK_FAILED",
      category: "NETWORK",
      retryable: true,
      message: "The fixture network failed.",
      nextAction: "RETRY",
      correlationId: "f10-fake-client",
    },
    metadata: {
      schemaVersion: 1,
      correlationId: "f10-fake-client",
      resource,
      scopeKey,
    },
  };
}

class FakeReadClient {
  public readonly requests: Array<{
    readonly resource: F10ResourceKind;
    readonly conditional?: { readonly etag?: string };
    readonly page?: number;
    readonly perPage?: number;
    readonly maxPages?: number;
  }> = [];
  public metadataMode: "UPDATED" | "NOT_MODIFIED" = "UPDATED";
  public failResource: F10ResourceKind | undefined;
  public incompleteResource: F10ResourceKind | undefined;
  public delayMs = 0;
  public activeRequests = 0;
  public maxActiveRequests = 0;
  public readonly metadataByPullRequest = new Map<
    string,
    GithubPullRequestMetadata
  >();
  public readonly itemsByPullRequest = new Map<
    string,
    Map<
      Exclude<F10ResourceKind, "pull_request">,
      readonly GithubFeedbackRecord[]
    >
  >();
  public readonly items = new Map<
    Exclude<F10ResourceKind, "pull_request">,
    readonly GithubFeedbackRecord[]
  >();

  public constructor(private readonly metadata: GithubPullRequestMetadata) {}

  private async beginRequest(): Promise<void> {
    this.activeRequests += 1;
    this.maxActiveRequests = Math.max(
      this.maxActiveRequests,
      this.activeRequests,
    );
    if (this.delayMs > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
  }

  private endRequest(): void {
    this.activeRequests -= 1;
  }

  public async getPullRequest(input: {
    readonly identity: GithubPullRequestMetadata["identity"];
    readonly conditional?: { readonly etag?: string };
  }): Promise<GithubRestResult<GithubPullRequestMetadata>> {
    await this.beginRequest();
    this.requests.push({
      resource: "pull_request",
      conditional: input.conditional,
    });
    const metadata =
      this.metadataByPullRequest.get(input.identity.key) ?? this.metadata;
    try {
      return this.metadataMode === "NOT_MODIFIED"
        ? notModified("pull_request", input.identity.key, "pr-v1")
        : updated("pull_request", input.identity.key, metadata, "pr-v1");
    } finally {
      this.endRequest();
    }
  }

  public async getFeedbackCollection(input: {
    readonly scope: ReturnType<typeof createFeedbackResourceScope>;
    readonly conditional?: { readonly etag?: string };
    readonly page?: number;
    readonly perPage?: number;
    readonly maxPages?: number;
  }): Promise<GithubRestResult<GithubFeedbackCollection>> {
    await this.beginRequest();
    const resource = input.scope.resource as Exclude<
      F10ResourceKind,
      "pull_request"
    >;
    this.requests.push({
      resource,
      conditional: input.conditional,
      page: input.page,
      perPage: input.perPage,
      maxPages: input.maxPages,
    });
    try {
      if (this.failResource === resource)
        return failed(resource, input.scope.key);
      const itemsByPullRequest = this.itemsByPullRequest.get(
        input.scope.pullRequest.key,
      );
      const items =
        itemsByPullRequest === undefined
          ? (this.items.get(resource) ?? [])
          : (itemsByPullRequest.get(resource) ?? []);
      const value: GithubFeedbackCollection = {
        resource,
        scope: input.scope,
        items,
        checkpoint:
          this.incompleteResource === resource
            ? { page: 1, perPage: 100, nextPage: 2, complete: false }
            : { page: 1, perPage: 100, complete: true },
      };
      return updated(
        resource,
        input.scope.key,
        value,
        `${input.scope.resource}-v1`,
      );
    } finally {
      this.endRequest();
    }
  }
}

function asReadClient(value: FakeReadClient): GithubReadClient {
  return value as unknown as GithubReadClient;
}

function unavailableActivity(): ActivityWriter {
  return {
    append: () => ({ outcome: "unavailable", reasonCode: "F10_TEST_ACTIVITY" }),
    appendInTransaction: () => ({
      outcome: "unavailable",
      reasonCode: "F10_TEST_ACTIVITY",
    }),
  };
}

describe("F10 polling configuration and semantic observation", () => {
  it("uses the ten-minute default and rejects intervals outside the safe range", () => {
    const watcherConfig = new PrWatcher({
      managedPrs: { listManagedPrs: () => [] },
      persistence: {} as never,
      githubClientForServer: () => undefined,
    }).configuration;
    expect(watcherConfig.intervalMs).toBe(DEFAULT_PR_POLL_INTERVAL_MS);
    expect(
      () =>
        new PrWatcher({
          managedPrs: { listManagedPrs: () => [] },
          persistence: {} as never,
          githubClientForServer: () => undefined,
          polling: { intervalMs: MIN_PR_POLL_INTERVAL_MS - 1 },
        }),
    ).toThrow("F10_INVALID_POLL_INTERVAL");
    expect(
      () =>
        new PrWatcher({
          managedPrs: { listManagedPrs: () => [] },
          persistence: {} as never,
          githubClientForServer: () => undefined,
          polling: { intervalMs: MAX_PR_POLL_INTERVAL_MS + 1 },
        }),
    ).toThrow("F10_INVALID_POLL_INTERVAL");
  });

  it("includes scoped identity and changed semantic fields in immutable versions", async () => {
    const { metadata } = remoteMetadata();
    const first = feedback(
      metadata,
      "review_comments",
      "9",
      "line one\nline two",
    );
    const second = feedback(metadata, "review_comments", "9", "edited body");
    const firstVersion = buildF10ObservedVersion({
      managedPrId: "managed-pr-f10",
      feedback: first,
      observedAt: TIME,
    });
    const secondVersion = buildF10ObservedVersion({
      managedPrId: "managed-pr-f10",
      feedback: second,
      observedAt: TIME,
    });
    expect(firstVersion.sourceId).toContain(":resource:review_comments:");
    expect(firstVersion.eventVersionId).not.toBe(secondVersion.eventVersionId);
    expect(firstVersion.semanticHash).not.toBe(secondVersion.semanticHash);
    expect(
      buildF10ObservedVersion({
        managedPrId: "managed-pr-f10",
        feedback: first,
        observedAt: "2026-09-21T12:05:00.000Z",
      }).eventVersionId,
    ).toBe(firstVersion.eventVersionId);
  });
});

describe("F10 renderer-independent watcher", () => {
  it("polls all four resources independently, persists checkpoints, and is idempotent", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const client = new FakeReadClient(managed.metadata);
    client.items.set("review_comments", [
      feedback(managed.metadata, "review_comments", "9", "inline review"),
    ]);
    client.items.set("reviews", [
      feedback(managed.metadata, "reviews", "9", undefined),
    ]);
    client.items.set("issue_comments", [
      feedback(managed.metadata, "issue_comments", "9", "general comment"),
    ]);
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const watcher = new PrWatcher({
      managedPrs: {
        listManagedPrs: () =>
          createF07PersistenceRepositories(store, {
            clock: { now: () => TIME },
          }).listManagedPrs(),
      },
      persistence: repositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    });

    const first = await watcher.run();
    expect(first.status).toBe("COMPLETED");
    expect(first.resources).toHaveLength(4);
    expect(first.newVersionIds).toHaveLength(3);
    expect(new Set(client.requests.map((request) => request.resource))).toEqual(
      new Set(["pull_request", "review_comments", "reviews", "issue_comments"]),
    );
    expect(
      client.requests
        .filter((request) => request.resource !== "pull_request")
        .every(
          (request) =>
            request.page === 1 &&
            request.perPage === 100 &&
            request.maxPages === 100,
        ),
    ).toBe(true);
    expect(repositories.listEventVersions(managed.id)).toHaveLength(3);
    expect(repositories.getCurrentMetadata(managed.id)?.metadata.headSha).toBe(
      managed.metadata.headSha,
    );
    expect(
      repositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:review_comments`,
      )?.conditional?.etag,
    ).toBe("review_comments-v1");
    const f03 = createPersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const reviewCheckpoint = f03.getResourceCheckpointForManagedPr(
      managed.id,
      "review_comments",
      `${managed.metadata.identity.key}:resource:review_comments`,
    );
    expect(reviewCheckpoint?.observedVersion).toBe(1);
    const reviewVersion = repositories
      .listEventVersions(managed.id)
      .find((version) => version.sourceKind === "REVIEW_COMMENT");
    expect(reviewVersion?.resourceAttemptId).toBeDefined();
    expect(reviewVersion?.resourceCheckpointId).toBe(
      `${reviewCheckpoint?.checkpointId}:1`,
    );
    expect(reviewVersion?.resourceObservationId).toMatch(
      /^f10-observation-[0-9a-f]{32}$/u,
    );

    client.metadataMode = "NOT_MODIFIED";
    const beforeReplay = client.requests.length;
    const replay = await watcher.run();
    expect(replay.status).toBe("COMPLETED");
    expect(replay.newVersionIds).toHaveLength(0);
    expect(client.requests.length - beforeReplay).toBe(4);
    expect(
      client.requests
        .slice(beforeReplay)
        .map((request) => request.conditional?.etag),
    ).toEqual(
      expect.arrayContaining([
        "pr-v1",
        "review_comments-v1",
        "reviews-v1",
        "issue_comments-v1",
      ]),
    );
    expect(
      createF07PersistenceRepositories(store, {
        clock: { now: () => TIME },
      }).getManagedPr(managed.id)?.primaryState,
    ).toBe("WATCHING");
  });

  it("does not let PR metadata 304 suppress changed feedback and preserves the prior version", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const client = new FakeReadClient(managed.metadata);
    client.items.set("review_comments", [
      feedback(managed.metadata, "review_comments", "12", "before"),
    ]);
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const source = createF07PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const watcher = new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: repositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    });
    await watcher.run();
    client.metadataMode = "NOT_MODIFIED";
    client.items.set("review_comments", [
      feedback(managed.metadata, "review_comments", "12", "after"),
    ]);
    const changed = await watcher.run();
    expect(changed.status).toBe("COMPLETED");
    expect(changed.newVersionIds).toHaveLength(1);
    expect(repositories.listEventVersions(managed.id)).toHaveLength(2);
    expect(
      changed.resources.find((resource) => resource.resource === "pull_request")
        ?.status,
    ).toBe("NOT_MODIFIED");
    expect(
      changed.resources.find(
        (resource) => resource.resource === "review_comments",
      )?.newVersionCount,
    ).toBe(1);
  });

  it("keeps two managed pull-request scopes isolated in one renderer-free run", async () => {
    const { store } = await fixture();
    const firstManaged = await addManagedPr(store);
    const secondManaged = await addManagedPr(store, {
      id: "managed-pr-f10-second",
      owner: "other-owner",
      repositoryName: "other-repo",
      number: 43,
    });
    const client = new FakeReadClient(firstManaged.metadata);
    client.items.set("review_comments", [
      feedback(firstManaged.metadata, "review_comments", "21", "first PR"),
    ]);
    client.metadataByPullRequest.set(
      secondManaged.metadata.identity.key,
      secondManaged.metadata,
    );
    client.itemsByPullRequest.set(
      secondManaged.metadata.identity.key,
      new Map([
        [
          "reviews",
          [feedback(secondManaged.metadata, "reviews", "21", "second PR")],
        ],
      ]),
    );
    client.delayMs = 2;
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const source = createF07PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const watcher = new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: repositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
      polling: { maxConcurrentResources: 2 },
    });

    const result = await watcher.run();
    expect(result.status).toBe("COMPLETED");
    expect(result.resources).toHaveLength(8);
    expect(client.maxActiveRequests).toBeLessThanOrEqual(2);
    expect(client.maxActiveRequests).toBe(2);
    expect(repositories.listEventVersions(firstManaged.id)).toHaveLength(1);
    expect(repositories.listEventVersions(secondManaged.id)).toHaveLength(1);
    expect(
      repositories.getResourceCheckpoint(
        firstManaged.id,
        `${firstManaged.metadata.identity.key}:resource:review_comments`,
      ),
    ).toBeDefined();
    expect(
      repositories.getResourceCheckpoint(
        secondManaged.id,
        `${secondManaged.metadata.identity.key}:resource:reviews`,
      ),
    ).toBeDefined();
  });

  it("commits complete sibling resources while retaining a failed resource checkpoint", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const client = new FakeReadClient(managed.metadata);
    client.items.set("issue_comments", [
      feedback(managed.metadata, "issue_comments", "15", "will retry"),
    ]);
    client.failResource = "issue_comments";
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const source = createF07PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const watcher = new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: repositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    });
    const partial = await watcher.run();
    expect(partial.status).toBe("PARTIAL");
    expect(
      partial.resources.find(
        (resource) => resource.resource === "issue_comments",
      )?.status,
    ).toBe("FAILED");
    expect(
      repositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:issue_comments`,
      ),
    ).toBeUndefined();
    expect(
      repositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:reviews`,
      ),
    ).toBeDefined();

    client.failResource = undefined;
    const recovered = await watcher.run();
    expect(recovered.status).toBe("COMPLETED");
    expect(recovered.newVersionIds).toHaveLength(1);
  });

  it("does not authorize a checkpoint when the activity handoff fails", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const client = new FakeReadClient(managed.metadata);
    client.items.set("review_comments", [
      feedback(managed.metadata, "review_comments", "16", "activity gate"),
    ]);
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
      activity: unavailableActivity(),
    });
    const source = createF07PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const watcher = new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: repositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    });

    const result = await watcher.run();

    expect(result.status).toBe("INTERRUPTED");
    expect(result.activityDegraded).toBe(true);
    expect(repositories.listEventVersions(managed.id)).toHaveLength(0);
    expect(
      repositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:review_comments`,
      ),
    ).toBeUndefined();
  });

  it("rolls back a complete resource when persistence fails before commit", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const client = new FakeReadClient(managed.metadata);
    client.items.set("review_comments", [
      feedback(
        managed.metadata,
        "review_comments",
        "18",
        "retry after rollback",
      ),
    ]);
    const source = createF07PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const interruptedRepositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
      resourceTransactionOptions: {
        faultInjection: { failBeforeCommit: true },
      },
    });
    const interrupted = await new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: interruptedRepositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    }).run();
    expect(interrupted.status).toBe("INTERRUPTED");
    expect(interruptedRepositories.listEventVersions(managed.id)).toHaveLength(
      0,
    );
    expect(
      interruptedRepositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:review_comments`,
      ),
    ).toBeUndefined();

    const recoveredRepositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const recovered = await new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: recoveredRepositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    }).run();
    expect(recovered.status).toBe("COMPLETED");
    expect(recoveredRepositories.listEventVersions(managed.id)).toHaveLength(1);
  });

  it("keeps the prior checkpoint when F06 reports an incomplete page sequence", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const client = new FakeReadClient(managed.metadata);
    client.incompleteResource = "review_comments";
    client.items.set("review_comments", [
      feedback(managed.metadata, "review_comments", "17", "incomplete"),
    ]);
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const source = createF07PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const watcher = new PrWatcher({
      managedPrs: { listManagedPrs: () => source.listManagedPrs() },
      persistence: repositories,
      githubClientForServer: () => asReadClient(client),
      clock: { now: () => TIME },
    });

    const result = await watcher.run();

    expect(result.status).toBe("PARTIAL");
    expect(
      result.resources.find(
        (resource) => resource.resource === "review_comments",
      )?.reason?.code,
    ).toBe("PAGINATION_INCOMPLETE");
    expect(
      repositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:review_comments`,
      ),
    ).toBeUndefined();
    expect(
      repositories.getResourceCheckpoint(
        managed.id,
        `${managed.metadata.identity.key}:resource:reviews`,
      ),
    ).toBeDefined();
  });

  it("leaves no durable intent when cancelled before the poll starts", async () => {
    const { store } = await fixture();
    await addManagedPr(store);
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const controller = new AbortController();
    controller.abort();
    const watcher = new PrWatcher({
      managedPrs: {
        listManagedPrs: () =>
          createF07PersistenceRepositories(store, {
            clock: { now: () => TIME },
          }).listManagedPrs(),
      },
      persistence: repositories,
      githubClientForServer: () => undefined,
      clock: { now: () => TIME },
    });

    await expect(watcher.run(controller.signal)).rejects.toThrow(
      "F10_POLL_CANCELLED_BEFORE_INTENT",
    );
    expect(repositories.listPollRuns()).toHaveLength(0);
  });

  it("marks pre-existing intents interrupted on startup without advancing a checkpoint", async () => {
    const { store } = await fixture();
    const managed = await addManagedPr(store);
    const repositories = new F10PersistenceRepositories(store, {
      clock: { now: () => TIME },
    });
    const scopes = pollingScopesForManagedPr(
      createF07PersistenceRepositories(store, {
        clock: { now: () => TIME },
      }).getManagedPr(managed.id)!,
    );
    const begun = repositories.beginPollRun({
      pollRunId: "f10-recovery-run",
      correlationId: "f10-recovery-correlation",
      configuration: {
        intervalMs: DEFAULT_PR_POLL_INTERVAL_MS,
        maxConcurrentResources: 1,
        pageSize: 100,
        maxPages: 100,
      },
      scopes: scopes.slice(0, 1),
      startedAt: TIME,
    });
    expect(begun.attempts[0]?.status).toBe("PENDING");
    repositories.reconcileStartup(
      {
        code: "POLL_INTERRUPTED",
        message: "The process stopped during polling.",
        retryable: true,
        nextAction: "RETRY",
        correlationId: "f10-recovery-correlation",
      },
      TIME,
    );
    expect(repositories.getPollRun("f10-recovery-run")?.status).toBe(
      "INTERRUPTED",
    );
    expect(
      repositories.getPollRun("f10-recovery-run")?.attempts[0]?.status,
    ).toBe("INTERRUPTED");
    expect(
      repositories.getResourceCheckpoint(managed.id, scopes[0]!.resourceKey),
    ).toBeUndefined();
  });
});
