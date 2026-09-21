import { describe, expect, it } from "vitest";
import {
  acceptManagedPrInboxSnapshot,
  isManagedPrInboxReadModel,
  projectManagedPrInbox,
  type ManagedPrInboxReadModel,
} from "../src/shared/inbox";
import type { ManagedPrReadModel } from "../src/shared/managed-pr";
import {
  IPC_CHANNELS,
  parseIpcInboxUpdateEvent,
  parseIpcRequest,
  parseIpcResponse,
} from "../src/shared/ipc";
import {
  IpcRouter,
  type IpcMainLike,
  type IpcSenderLike,
} from "../src/main/ipc-router";
import type { LifecycleStatus } from "../src/shared/ipc";

const server = {
  kind: "GITHUB_COM" as const,
  webOrigin: "https://github.com",
  apiBaseUrl: "https://api.github.com",
  host: "github.com",
  serverKey: "github.com",
};

function repository(owner: string, name: string) {
  return {
    schemaVersion: 1 as const,
    server,
    owner,
    name,
    key: `github:github.com/${owner}/${name}`,
    available: true as const,
  };
}

function managedPr(
  id: string,
  primaryState: ManagedPrReadModel["primaryState"],
  updatedAt: string,
  owner = "owner",
): ManagedPrReadModel {
  const base = repository(owner, "base");
  const head = repository("contributor", `${id}-fork`);
  return {
    schemaVersion: 1,
    id,
    canonicalUrl: `https://github.com/${owner}/base/pull/${id.length}`,
    pullRequestKey: `${base.key}#${id.length}`,
    serverId: "server-1",
    owner,
    repositoryName: "base",
    number: id.length,
    state: "OPEN",
    merged: false,
    title: `${id} title`,
    baseRepository: base,
    headRepository: head,
    prBaseBranch: "main",
    prHeadBranch: `feature/${id}`,
    prBaseSha: "a".repeat(40),
    prHeadSha: "b".repeat(40),
    primaryState,
    localSetupStatus: "LOCAL_CLONE_REQUIRED",
    configuration: {
      revisionId: `config-${id}`,
      revision: 1,
      context: null,
      syncSourceBranchOverride: null,
      contentHash: "a".repeat(64),
      source: "ADD_PR",
      createdAt: updatedAt,
    },
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

function snapshot(version: number): ManagedPrInboxReadModel {
  return projectManagedPrInbox({
    managedPrs: [managedPr("pr-watch", "WATCHING", "2026-09-20T00:00:00.000Z")],
    version,
    generatedAt: "2026-09-21T00:00:00.000Z",
  });
}

describe("F08 deterministic inbox projection", () => {
  it("groups all primary states and applies the documented stable order", () => {
    const result = projectManagedPrInbox({
      managedPrs: [
        managedPr("ready-old", "READY_FOR_REVIEW", "2026-09-19T00:00:00.000Z"),
        managedPr("attention", "NEEDS_ATTENTION", "2026-09-18T00:00:00.000Z"),
        managedPr("ready-new", "READY_FOR_REVIEW", "2026-09-20T00:00:00.000Z"),
        managedPr("working", "WORKING", "2026-09-20T00:00:00.000Z"),
        managedPr("watching", "WATCHING", "2026-09-20T00:00:00.000Z"),
      ],
      version: 1,
      generatedAt: "2026-09-21T00:00:00.000Z",
    });

    expect(result.counts).toEqual({
      total: 5,
      actionNeeded: 3,
      working: 1,
      watching: 1,
    });
    expect(result.groups.map((group) => [group.id, group.cardIds])).toEqual([
      ["ACTION_NEEDED", ["attention", "ready-new", "ready-old"]],
      ["WORKING", ["working"]],
      ["WATCHING", ["watching"]],
    ]);
    expect(
      result.cards.every((card) => card.reference.endsWith(`#${card.number}`)),
    ).toBe(true);
    expect(
      result.cards.find((card) => card.id === "attention")?.reason.nextAction,
    ).toBe("OPEN_DETAILS");
  });

  it("is deterministic and keeps synchronization independent from primary grouping", () => {
    const managedPrs = [
      managedPr("same-time", "READY_FOR_REVIEW", "2026-09-20T00:00:00.000Z"),
    ];
    const input = {
      managedPrs,
      synchronizationResults: [
        {
          id: "sync-1",
          managedPrId: "same-time",
          status: "MERGING",
          version: 1,
          updatedAt: "2026-09-20T00:00:00.000Z",
        },
      ],
      version: 4,
      generatedAt: "2026-09-21T00:00:00.000Z",
    } as const;
    const first = projectManagedPrInbox(input);
    const second = projectManagedPrInbox(input);
    expect(second).toEqual(first);
    expect(first.groups[0]?.id).toBe("ACTION_NEEDED");
    expect(first.cards[0]?.synchronization?.status).toBe("MERGING");

    const changedOverlay = projectManagedPrInbox({
      ...input,
      synchronizationResults: [
        { ...input.synchronizationResults[0], status: "STALE", version: 2 },
      ],
    });
    expect(changedOverlay.groups[0]?.cardIds).toEqual(first.groups[0]?.cardIds);
    expect(changedOverlay.cards[0]?.primaryState).toBe(
      first.cards[0]?.primaryState,
    );
    expect(changedOverlay.cards[0]?.reason).toEqual(first.cards[0]?.reason);
  });

  it("ignores unsupported overlays, rejects unsafe identities, and rejects stale snapshots", () => {
    const unsupported = projectManagedPrInbox({
      managedPrs: [managedPr("safe", "WATCHING", "2026-09-20T00:00:00.000Z")],
      synchronizationResults: [
        {
          id: "sync-1",
          managedPrId: "safe",
          status: "UNKNOWN",
          version: 1,
          updatedAt: "2026-09-20T00:00:00.000Z",
        },
      ],
      version: 1,
      generatedAt: "2026-09-21T00:00:00.000Z",
    });
    expect(unsupported.cards[0]?.synchronization).toBeUndefined();
    expect(() =>
      projectManagedPrInbox({
        managedPrs: [
          {
            ...managedPr("unsafe", "WATCHING", "2026-09-20T00:00:00.000Z"),
            title: "api-key=secret",
          },
        ],
        version: 1,
        generatedAt: "2026-09-21T00:00:00.000Z",
      }),
    ).toThrow("unsafe display text");

    const current = snapshot(2);
    expect(acceptManagedPrInboxSnapshot(current, snapshot(1))).toBe(current);
    expect(acceptManagedPrInboxSnapshot(current, current)).toBe(current);
    expect(isManagedPrInboxReadModel(current)).toBe(true);
  });

  it("projects the standard 250-card fixture within the responsive budget", () => {
    const managedPrs = Array.from({ length: 250 }, (_, index) =>
      managedPr(
        `pr-${index + 1}`,
        index % 4 === 0 ? "READY_FOR_REVIEW" : "WATCHING",
        "2026-09-20T00:00:00.000Z",
      ),
    );
    const started = performance.now();
    const result = projectManagedPrInbox({
      managedPrs,
      version: 1,
      generatedAt: "2026-09-21T00:00:00.000Z",
    });
    expect(result.counts.total).toBe(250);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

class FakeSender implements IpcSenderLike {
  public readonly messages: unknown[] = [];
  public constructor(public readonly id: number) {}
  public send(_channel: string, payload: unknown): void {
    this.messages.push(payload);
  }
}

class FakeIpcMain implements IpcMainLike {
  public handle(
    _channel: string,
    _listener: (
      event: { readonly sender: IpcSenderLike },
      payload: unknown,
    ) => Promise<unknown>,
  ): void {}
}

const lifecycle: LifecycleStatus = {
  schemaVersion: 1,
  phase: "RUNNING",
  sessionId: "session-f08",
  correlationId: "f08-test",
  startedAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
  incompleteHandoff: false,
};

describe("F08 IPC read/subscription boundary", () => {
  it("allowlists inbox requests and delivers only validated versioned updates", async () => {
    const inbox = snapshot(1);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-inbox",
        type: "inbox.read",
        payload: {},
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-inbox-sub",
        type: "inbox.subscribe",
        payload: { token: "secret" },
      }).ok,
    ).toBe(false);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-nav",
        type: "inbox.navigate",
        payload: { managedPrId: "pr-1", destination: "settings" },
      }).ok,
    ).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-nav-bad",
        type: "inbox.navigate",
        payload: { managedPrId: "C:/worktree", destination: "details" },
      }).ok,
    ).toBe(false);

    const response = {
      schemaVersion: 1 as const,
      requestId: "request-inbox",
      ok: true as const,
      value: { kind: "managed-pr-inbox" as const, snapshot: inbox },
    };
    expect(parseIpcResponse(response)).toBe(true);
    expect(
      parseIpcInboxUpdateEvent({
        schemaVersion: 1,
        type: "inbox-update",
        snapshot: inbox,
      }),
    ).toBe(true);
    expect(
      parseIpcInboxUpdateEvent({
        schemaVersion: 1,
        type: "inbox-update",
        snapshot: {
          ...inbox,
          cards: [
            {
              ...inbox.cards[0],
              reason: { ...inbox.cards[0]!.reason, what: "prompt=token" },
            },
          ],
        },
      }),
    ).toBe(false);

    const sender = new FakeSender(8);
    const router = new IpcRouter(new FakeIpcMain(), {
      readCurrentState: () => ({
        schemaVersion: 1,
        applicationTitle: "PRMonitor",
        lifecycle,
        persistence: { status: "healthy", schemaVersion: 5 },
      }),
      getLifecycleStatus: () => lifecycle,
      requestShutdown: async () => ({ ok: true, status: lifecycle }),
      readInbox: () => inbox,
      navigateManagedPr: (managedPrId, destination) => ({
        schemaVersion: 1,
        kind: destination === "settings" ? "MANAGED_PR_SETTINGS" : "MANAGED_PR",
        id: managedPrId,
        requestId: "route-f08",
      }),
    });
    await router.handle(
      {
        schemaVersion: 1,
        requestId: "request-ready",
        type: "renderer.ready",
        payload: { sessionId: "renderer-f08" },
      },
      sender,
    );
    const subscribed = await router.handle(
      {
        schemaVersion: 1,
        requestId: "request-subscribe",
        type: "inbox.subscribe",
        payload: {},
      },
      sender,
    );
    expect(subscribed).toMatchObject({
      ok: true,
      value: { kind: "managed-pr-inbox" },
    });
    expect(router.publishInbox(inbox)).toBe(1);
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toMatchObject({
      type: "inbox-update",
      snapshot: inbox,
    });
    expect(IPC_CHANNELS.event).toContain("prmonitor:ipc:v1:event");
  });
});
