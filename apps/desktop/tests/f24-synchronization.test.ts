import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GithubReadClient } from "../src/main/github-rest-client";
import {
  F24SynchronizationError,
  F24SynchronizationService,
  type F24PersistencePort,
} from "../src/main/f24-synchronization-service";
import {
  F24PersistenceRepositories,
  initializePersistence,
  PERSISTENCE_SCHEMA_VERSION,
  type PersistenceStore,
} from "../src/main/persistence";
import {
  applyF24SelectionCommand,
  createF24SelectionSession,
  isF24PreparationIntent,
  resolveF24EffectiveSource,
  type F24HandoffRecord,
  type F24PreparationHandoffResult,
  type F24PreparationIntent,
  type F24PreparationIntentSnapshot,
} from "../src/shared/f24-synchronization";
import type {
  GithubBranchRef,
  GithubPullRequestStateSnapshot,
  GithubRestResult,
} from "../src/shared/github-rest";
import type { ManagedPrReadModel } from "../src/shared/managed-pr";
import {
  projectManagedPrInbox,
  type ManagedPrInboxReadModel,
} from "../src/shared/inbox";
import { parseIpcRequest, parseIpcResponse } from "../src/shared/ipc";

const NOW = "2026-09-27T12:00:00.000Z";

const server = {
  kind: "GITHUB_COM" as const,
  webOrigin: "github.example.invalid",
  apiBaseUrl: "github.example.invalid/api",
  host: "github.example.invalid",
  serverKey: "github.example.invalid",
};

function repository(owner: string, name: string) {
  return {
    schemaVersion: 1 as const,
    server,
    owner,
    name,
    key: `github:${server.serverKey}/${owner}/${name}`,
    available: true as const,
  };
}

function managedPr(
  id: string,
  state: "OPEN" | "CLOSED" = "OPEN",
): ManagedPrReadModel {
  const baseRepository = repository("source-owner", "source-repository");
  const headRepository = repository("fork-owner", `${id}-fork`);
  const updatedAt = NOW;
  return {
    schemaVersion: 1,
    id,
    canonicalUrl: `pr-reference-${id}`,
    pullRequestKey: `${baseRepository.key}#${id.length}`,
    serverId: "server-1",
    owner: baseRepository.owner,
    repositoryName: baseRepository.name,
    number: id.length,
    state,
    merged: false,
    title: `${id} title`,
    baseRepository,
    headRepository,
    prBaseBranch: "main",
    prHeadBranch: `feature-${id}`,
    prBaseSha: "a".repeat(40),
    prHeadSha: "b".repeat(40),
    primaryState: "WATCHING",
    localSetupStatus: "LOCAL_CLONE_REQUIRED",
    configuration: {
      revisionId: `configuration-${id}`,
      revision: 1,
      context: null,
      syncSourceBranchOverride: null,
      contentHash: "c".repeat(64),
      source: "ADD_PR",
      createdAt: updatedAt,
    },
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

function inbox(
  managedPrs: readonly ManagedPrReadModel[],
  version = 1,
): ManagedPrInboxReadModel {
  return projectManagedPrInbox({
    managedPrs,
    version,
    generatedAt: NOW,
  });
}

function updated<T>(
  value: T,
  correlationId: string,
  resource: "pull_request" | "branch_ref",
): GithubRestResult<T> {
  return {
    ok: true,
    outcome: "UPDATED",
    value,
    metadata: {
      schemaVersion: 1,
      correlationId,
      resource,
      scopeKey: "test-scope",
      status: 200,
    },
  };
}

function clientFor(
  managedPrs: ReadonlyMap<string, ManagedPrReadModel>,
  remoteHeadShas: ReadonlyMap<string, string> = new Map(),
): GithubReadClient {
  const client = {
    getPullRequestState: async (input: {
      readonly identity: GithubPullRequestStateSnapshot["identity"];
      readonly correlationId: string;
    }) => {
      const managed = [...managedPrs.values()].find(
        (candidate) => candidate.pullRequestKey === input.identity.key,
      );
      const candidate = managed ?? [...managedPrs.values()][0]!;
      const headSha = remoteHeadShas.get(candidate.id) ?? candidate.prHeadSha;
      return updated<GithubPullRequestStateSnapshot>(
        {
          identity: input.identity,
          state: candidate.state,
          merged: candidate.merged,
          headSha,
          baseSha: candidate.prBaseSha,
        },
        input.correlationId,
        "pull_request",
      );
    },
    getBranchRef: async (input: {
      readonly ref: GithubBranchRef["identity"];
      readonly correlationId: string;
    }) => {
      const managed = [...managedPrs.values()].find(
        (candidate) =>
          candidate.baseRepository.key === input.ref.repository.key ||
          candidate.headRepository.key === input.ref.repository.key,
      );
      const sha =
        input.ref.repository.key === managed?.baseRepository.key
          ? managed.prBaseSha
          : (remoteHeadShas.get(managed?.id ?? "") ??
            managed?.prHeadSha ??
            "b".repeat(40));
      return updated<GithubBranchRef>(
        { identity: input.ref, sha },
        input.correlationId,
        "branch_ref",
      );
    },
  } as unknown as GithubReadClient;
  return client;
}

class MemoryPersistence implements F24PersistencePort {
  public intent: F24PreparationIntent | undefined;

  public persistIntent(input: {
    readonly snapshot: F24PreparationIntentSnapshot;
    readonly handoff: F24HandoffRecord;
  }): F24PreparationIntent {
    if (this.intent !== undefined) return this.intent;
    const intent: F24PreparationIntent = {
      schemaVersion: 1,
      kind: "synchronization-preparation-intent",
      snapshot: input.snapshot,
      handoff: input.handoff,
      version: 1,
      updatedAt: input.handoff.updatedAt,
    };
    if (!isF24PreparationIntent(intent)) throw new Error("INVALID_INTENT");
    this.intent = intent;
    return intent;
  }

  public getPreparationIntent(
    intentId: string,
  ): F24PreparationIntent | undefined {
    return this.intent?.snapshot.intentId === intentId
      ? this.intent
      : undefined;
  }

  public getPreparationIntentByIdempotencyKey(
    idempotencyKey: string,
  ): F24PreparationIntent | undefined {
    return this.intent?.snapshot.idempotencyKey === idempotencyKey
      ? this.intent
      : undefined;
  }

  public listPreparationIntents(): readonly F24PreparationIntent[] {
    return this.intent === undefined ? [] : [this.intent];
  }

  public updateHandoff(input: {
    readonly intentId: string;
    readonly status: F24PreparationIntent["handoff"]["status"];
    readonly authorizationId?: string;
    readonly reason?: F24PreparationIntent["handoff"]["reason"];
    readonly expectedVersion?: number;
  }): F24PreparationIntent {
    if (
      this.intent === undefined ||
      this.intent.snapshot.intentId !== input.intentId
    )
      throw new Error("INTENT_NOT_FOUND");
    if (
      input.expectedVersion !== undefined &&
      this.intent.version !== input.expectedVersion
    )
      throw new Error("VERSION_CONFLICT");
    this.intent = {
      ...this.intent,
      handoff: {
        ...this.intent.handoff,
        status: input.status,
        ...(input.authorizationId === undefined
          ? {}
          : { authorizationId: input.authorizationId }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        updatedAt: NOW,
      },
      version: this.intent.version + 1,
      updatedAt: NOW,
    };
    return this.intent;
  }
}

function serviceFor(input: {
  readonly managedPrs: readonly ManagedPrReadModel[];
  readonly projectionVersion?: number;
  readonly persistence?: MemoryPersistence;
  readonly handoff?: (
    authorization: unknown,
  ) => Promise<F24PreparationHandoffResult>;
}) {
  const byPullRequestKey = new Map(
    input.managedPrs.map((candidate) => [candidate.pullRequestKey, candidate]),
  );
  const persistence = input.persistence ?? new MemoryPersistence();
  const projection = inbox(input.managedPrs, input.projectionVersion ?? 1);
  const remoteHeadShas = new Map<string, string>();
  const service = new F24SynchronizationService({
    inbox: { read: () => projection },
    managedPrs: {
      getManagedPr: (managedPrId) =>
        input.managedPrs.find((candidate) => candidate.id === managedPrId),
    },
    github: {
      getReadClient: () => clientFor(byPullRequestKey, remoteHeadShas),
    },
    f13: {
      check: (readinessInput) => ({
        ok: true,
        rootRevision: readinessInput.rootRevision ?? 1,
        evidenceRevision: `evidence-${readinessInput.managedPrId}`,
      }),
    },
    f16: {
      readReference: () => ({
        schemaVersion: 1,
        settingsRevision: 3,
        boundsRevision: "f16-test-v1",
        worktreeRootRevision: 2,
      }),
    },
    persistence,
    ...(input.handoff === undefined
      ? {}
      : { handoff: { accept: input.handoff } }),
    now: () => NOW,
  });
  return { service, projection, persistence, remoteHeadShas };
}

describe("F24 synchronization selection and resolution", () => {
  it("uses a non-empty override as the source and validates the IPC envelope", () => {
    expect(
      resolveF24EffectiveSource({
        syncSourceBranchOverride: "release",
        prBaseBranch: "main",
      }),
    ).toEqual({ ok: true, branch: "release", provenance: "OVERRIDE" });
    expect(
      resolveF24EffectiveSource({
        syncSourceBranchOverride: "",
        prBaseBranch: "",
      }).ok,
    ).toBe(false);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-f24-selection",
        type: "synchronization.selection.command",
        payload: {
          command: "SELECT_ALL",
          projectionRevision: 1,
        },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-f24-selection-unsafe",
        type: "synchronization.selection.command",
        payload: {
          command: "SELECT_ALL",
          projectionRevision: 1,
          token: "unexpected",
        },
      }).ok,
    ).toBe(false);
    const selection = createF24SelectionSession({
      projection: inbox([managedPr("pr-one")]),
      now: NOW,
    });
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "response-f24-selection",
        ok: true,
        value: { kind: "synchronization-selection", selection },
      }),
    ).toBe(true);
  });

  it("selects all identities, rejects stale commands, and keeps selection side-effect free", () => {
    const managedPrs = [managedPr("pr-one"), managedPr("pr-two")];
    const projection = inbox(managedPrs);
    const session = createF24SelectionSession({ projection, now: NOW });
    const selected = applyF24SelectionCommand(
      session,
      projection,
      { command: "SELECT_ALL", projectionRevision: projection.version },
      NOW,
    );
    expect(selected.selectedManagedPrIds).toEqual(["pr-one", "pr-two"]);
    expect(selected.actionLabel).toBe("Synchronize PR Branches");
    expect(() =>
      applyF24SelectionCommand(
        selected,
        projection,
        { command: "CLEAR", projectionRevision: projection.version + 1 },
        NOW,
      ),
    ).toThrow("F24_SELECTION_PROJECTION_STALE");
  });

  it("resolves explicit fork source and destination identities with independent current refs", async () => {
    const { service } = serviceFor({ managedPrs: [managedPr("pr-one")] });
    const projection = inbox([managedPr("pr-one")]);
    service.applySelection({
      command: "TOGGLE",
      projectionRevision: projection.version,
      managedPrId: "pr-one",
    });
    const confirmation = await service.openSynchronization();
    const row = confirmation.rows[0]!;
    expect(row.eligibility).toBe("ELIGIBLE");
    expect(row.sourceRepository.key).toContain(
      "source-owner/source-repository",
    );
    expect(row.destinationRepository.key).toContain("fork-owner/pr-one-fork");
    expect(row.syncSourceBranch).toBe("main");
    expect(row.prHeadBranch).toBe("feature-pr-one");
    expect(row.syncSourceSha).toBe("a".repeat(40));
    expect(row.prHeadSha).toBe("b".repeat(40));
    expect(row.sourceProvenance).toBe("PR_BASE_BRANCH");
    expect(row.f13Readiness?.ready).toBe(true);
  });

  it("retains mixed eligibility and never creates an empty preparation", async () => {
    const managedPrs = [managedPr("pr-open"), managedPr("pr-closed", "CLOSED")];
    const { service } = serviceFor({ managedPrs });
    const projection = inbox(managedPrs);
    service.applySelection({
      command: "SELECT_ALL",
      projectionRevision: projection.version,
    });
    const confirmation = await service.openSynchronization();
    expect(confirmation.selectedCount).toBe(2);
    expect(confirmation.eligibleCount).toBe(1);
    expect(confirmation.ineligibleCount).toBe(1);
    expect(confirmation.rows.map((row) => row.eligibility)).toEqual([
      "ELIGIBLE",
      "INELIGIBLE",
    ]);
    expect(confirmation.confirmEnabled).toBe(true);

    const closedOnly = serviceFor({
      managedPrs: [managedPr("pr-closed", "CLOSED")],
    });
    const closedProjection = inbox([managedPr("pr-closed", "CLOSED")]);
    closedOnly.service.applySelection({
      command: "TOGGLE",
      projectionRevision: closedProjection.version,
      managedPrId: "pr-closed",
    });
    const closedConfirmation = await closedOnly.service.openSynchronization();
    expect(closedConfirmation.confirmEnabled).toBe(false);
    await expect(
      closedOnly.service.confirmPreparation({
        resolutionRevision: closedConfirmation.resolutionRevision,
        actor: "USER",
      }),
    ).rejects.toMatchObject({ code: "F24_NO_ELIGIBLE_PR" });
    expect(closedOnly.persistence.intent).toBeUndefined();
  });

  it("persists before the typed handoff and does not grant publication capabilities", async () => {
    const persistence = new MemoryPersistence();
    const order: string[] = [];
    const prepared = serviceFor({
      managedPrs: [managedPr("pr-one")],
      persistence,
      handoff: async (authorization) => {
        order.push("handoff");
        const value = authorization as {
          readonly preparationOnly: boolean;
          readonly capabilities: {
            readonly commit: boolean;
            readonly push: boolean;
            readonly githubWrite: boolean;
            readonly aiProvider: boolean;
            readonly publication: boolean;
          };
        };
        expect(value.preparationOnly).toBe(true);
        expect(value.capabilities.commit).toBe(false);
        expect(value.capabilities.push).toBe(false);
        expect(value.capabilities.githubWrite).toBe(false);
        expect(value.capabilities.aiProvider).toBe(false);
        expect(value.capabilities.publication).toBe(false);
        return { status: "ACKNOWLEDGED" };
      },
    });
    const { service } = prepared;
    const projection = inbox([managedPr("pr-one")]);
    service.applySelection({
      command: "TOGGLE",
      projectionRevision: projection.version,
      managedPrId: "pr-one",
    });
    const confirmation = await service.openSynchronization();
    const originalPersist = persistence.persistIntent.bind(persistence);
    persistence.persistIntent = (input) => {
      order.push("persist");
      return originalPersist(input);
    };
    const intent = await service.confirmPreparation({
      resolutionRevision: confirmation.resolutionRevision,
      actor: "USER",
    });
    expect(order).toEqual(["persist", "handoff"]);
    expect(intent.handoff.status).toBe("ACKNOWLEDGED");
    expect(intent.snapshot.eligibleRows).toHaveLength(1);
    expect(intent.snapshot.ineligibleRows).toHaveLength(0);
    prepared.remoteHeadShas.set("pr-one", "d".repeat(40));
    await expect(
      service.confirmPreparation({
        resolutionRevision: confirmation.resolutionRevision,
        actor: "USER",
      }),
    ).resolves.toEqual(intent);
    expect(order).toEqual(["persist", "handoff"]);
  });

  it("rejects a confirmation when the visible summary is replaced by remote movement", async () => {
    const managed = managedPr("pr-one");
    const first = serviceFor({ managedPrs: [managed] });
    const { service } = first;
    const projection = inbox([managed]);
    service.applySelection({
      command: "TOGGLE",
      projectionRevision: projection.version,
      managedPrId: "pr-one",
    });
    const confirmation = await service.openSynchronization();
    first.remoteHeadShas.set("pr-one", "d".repeat(40));
    await expect(
      service.confirmPreparation({
        resolutionRevision: confirmation.resolutionRevision,
        actor: "USER",
      }),
    ).rejects.toBeInstanceOf(F24SynchronizationError);
  });

  it("round-trips the committed intent through the F03 repository and replays idempotently", async () => {
    const { service, persistence } = serviceFor({
      managedPrs: [managedPr("pr-one")],
    });
    const projection = inbox([managedPr("pr-one")]);
    service.applySelection({
      command: "TOGGLE",
      projectionRevision: projection.version,
      managedPrId: "pr-one",
    });
    const confirmation = await service.openSynchronization();
    const intent = await service.confirmPreparation({
      resolutionRevision: confirmation.resolutionRevision,
      actor: "USER",
    });
    expect(persistence.intent).toBeDefined();

    const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f24-"));
    let store: PersistenceStore | undefined;
    try {
      store = await initializePersistence(
        {
          databasePath: path.join(root, "database", "prmonitor.sqlite"),
          backupRoot: path.join(root, "backups"),
        },
        { clock: { now: () => NOW }, applicationBuild: "f24-test" },
      );
      expect(store.health.schemaVersion).toBe(PERSISTENCE_SCHEMA_VERSION);
      const repositories = new F24PersistenceRepositories(store, {
        clock: { now: () => NOW },
      });
      const first = repositories.persistIntent({
        snapshot: intent.snapshot,
        handoff: intent.handoff,
      });
      expect(first.snapshot.intentId).toBe(intent.snapshot.intentId);
      expect(
        repositories.getPreparationIntent(intent.snapshot.intentId),
      ).toEqual(first);
      expect(
        repositories.persistIntent({
          snapshot: intent.snapshot,
          handoff: intent.handoff,
        }),
      ).toEqual(first);
    } finally {
      store?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
