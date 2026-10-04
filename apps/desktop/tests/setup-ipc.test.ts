import { describe, expect, it, vi } from "vitest";
import type { PrMonitorPreloadApi } from "../src/shared/ipc";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: electron,
}));
import { IpcRouter, type IpcServices } from "../src/main/ipc-router";
import {
  parseIpcRequest,
  parseIpcResponse,
  parseIpcSetupReadinessUpdatedEvent,
} from "../src/shared/ipc";
import {
  SETUP_CHECK_IDS,
  type SetupReadiness,
} from "../src/shared/setup-readiness";

const projection: SetupReadiness = {
  schemaVersion: 1,
  revision: 0,
  ready: false,
  completedCount: 0,
  checks: SETUP_CHECK_IDS.map((id) => ({
    id,
    status: "incomplete",
    description: "Configure access",
    remediation: "local",
  })),
};
const request = (type: string, payload = {}) => ({
  schemaVersion: 1,
  requestId: "setup-test",
  type,
  payload,
});
const event = (value: unknown) => ({
  schemaVersion: 1,
  type: "setup-readiness-updated",
  projection: value,
});

function router(
  readSetupReadiness?: () => Promise<SetupReadiness>,
  retrySetupReadiness?: () => Promise<SetupReadiness>,
) {
  const shutdown = vi.fn();
  const services = {
    readCurrentState: vi.fn(),
    getLifecycleStatus: vi.fn(),
    requestShutdown: shutdown,
    ...(readSetupReadiness === undefined ? {} : { readSetupReadiness }),
    ...(retrySetupReadiness === undefined ? {} : { retrySetupReadiness }),
  } as unknown as IpcServices;
  return { router: new IpcRouter({ handle: vi.fn() }, services), shutdown };
}

describe("setup IPC boundary", () => {
  it("dispatches retry only on an explicit validated retry request", async () => {
    const read = vi.fn(async () => projection);
    const retry = vi.fn(async () => projection);
    const { router: subject } = router(read, retry);
    const sender = { id: 3, send: vi.fn() };
    await subject.handle(
      request("renderer.ready", { sessionId: "setup-session" }),
      sender,
    );
    await subject.handle(request("setup.read"), sender);
    expect(retry).not.toHaveBeenCalled();
    const invalid = await subject.handle(
      request("setup.retry", { resetData: true }),
      sender,
    );
    expect(invalid.ok).toBe(false);
    expect(retry).not.toHaveBeenCalled();
    const result = await subject.handle(request("setup.retry"), sender);
    expect(result.ok && result.value).toEqual({
      kind: "setup-readiness",
      projection,
    });
    expect(retry).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    const missing = router(read).router;
    await missing.handle(
      request("renderer.ready", { sessionId: "setup-session" }),
      sender,
    );
    const unavailable = await missing.handle(request("setup.retry"), sender);
    expect(!unavailable.ok && unavailable.error.code).toBe("NOT_READY");
  });
  it("preload filters invalid responses and events and unsubscribes the exact handler", async () => {
    await import("../src/preload/index");
    const api = electron.exposeInMainWorld.mock
      .calls[0]?.[1] as PrMonitorPreloadApi;
    const response = {
      schemaVersion: 1,
      requestId: "setup-test",
      ok: true,
      value: { kind: "setup-readiness", projection },
    };
    electron.invoke.mockResolvedValueOnce(response);
    expect(await api.readSetupReadiness()).toEqual(response);
    expect(electron.invoke.mock.calls[0]?.[1]).toMatchObject({
      type: "setup.read",
      payload: {},
    });
    electron.invoke.mockResolvedValueOnce({
      ...response,
      value: {
        kind: "setup-readiness",
        projection: { ...projection, revision: -1 },
      },
    });
    expect((await api.readSetupReadiness()).ok).toBe(false);
    const listener = vi.fn();
    const unsubscribe = api.onSetupReadinessUpdated(listener);
    const handler = electron.on.mock.calls[0]?.[1] as (
      sender: unknown,
      payload: unknown,
    ) => void;
    handler({}, event({ ...projection, ready: true }));
    expect(listener).not.toHaveBeenCalled();
    handler({}, event(projection));
    expect(listener).toHaveBeenCalledExactlyOnceWith(projection);
    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith(
      "prmonitor:ipc:v1:event",
      handler,
    );
  });
  it("accepts a read-only empty request and rejects extra payload", () => {
    expect(parseIpcRequest(request("setup.read")).ok).toBe(true);
    expect(parseIpcRequest(request("setup.read", { refresh: true })).ok).toBe(
      false,
    );
  });

  it.each([
    { ...projection, revision: -1 },
    { ...projection, revision: 0.5 },
    { ...projection, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...projection, checks: [...projection.checks, projection.checks[0]] },
    {
      ...projection,
      checks: projection.checks.map((check) => ({
        ...check,
        status: "unknown",
      })),
    },
    { ...projection, ready: true },
    { ...projection, completedCount: 1 },
    { ...projection, token: "secret" },
  ])("rejects malformed projections in responses and events", (invalid) => {
    expect(parseIpcSetupReadinessUpdatedEvent(event(invalid))).toBe(false);
    expect(
      parseIpcResponse({
        schemaVersion: 1,
        requestId: "setup-test",
        ok: true,
        value: { kind: "setup-readiness", projection: invalid },
      }),
    ).toBe(false);
  });

  it("dispatches only the readiness reader after handshake and publishes validated events", async () => {
    const read = vi.fn(async () => projection);
    const { router: subject, shutdown } = router(read);
    const sender = { id: 1, send: vi.fn() };
    expect((await subject.handle(request("setup.read"), sender)).ok).toBe(
      false,
    );
    expect(read).not.toHaveBeenCalled();
    await subject.handle(
      request("renderer.ready", { sessionId: "setup-session" }),
      sender,
    );
    const result = await subject.handle(request("setup.read"), sender);
    expect(result.ok && result.value).toEqual({
      kind: "setup-readiness",
      projection,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
    expect(subject.publishSetupReadiness(projection)).toBe(1);
    expect(sender.send.mock.calls[0]?.[1]).toEqual(event(projection));
    expect(subject.publishSetupReadiness({ ...projection, revision: -1 })).toBe(
      0,
    );
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it("fails unavailable readers and blocks malformed service results", async () => {
    for (const read of [
      undefined,
      async () => ({ ...projection, ready: true }),
    ]) {
      const { router: subject } = router(read);
      const sender = { id: 2, send: vi.fn() };
      await subject.handle(
        request("renderer.ready", { sessionId: "setup-session" }),
        sender,
      );
      const result = await subject.handle(request("setup.read"), sender);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe(
        read === undefined ? "NOT_READY" : "HANDLER_FAILED",
      );
    }
  });
});
