import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SetupScreen,
  createSetupReader,
  setupLanding,
  type SetupReadState,
} from "../src/renderer/SetupScreen";
import type { SetupReadinessProjection } from "../src/shared/setup-readiness";
import type { IpcResponse } from "../src/shared/ipc";

const checks: SetupReadinessProjection["checks"] = [
  {
    id: "local-prerequisites",
    status: "complete",
    description: "Local tools and storage are ready.",
    remediation: "local",
  },
  {
    id: "github-access",
    status: "complete",
    description: "One verified server is available.",
    remediation: "github",
  },
  {
    id: "ai-access",
    status: "complete",
    description:
      "Configured locally; service access is checked when work starts",
    remediation: "ai",
  },
  {
    id: "ai-task-configuration",
    status: "complete",
    description: "Four independent profiles are available.",
    remediation: "tasks",
  },
  {
    id: "working-policy",
    status: "complete",
    description: "Policy is compatible.",
    remediation: "policy",
  },
];
const ready = (revision = 1): SetupReadinessProjection => ({
  schemaVersion: 1,
  revision,
  ready: true,
  completedCount: 5,
  checks,
});
const response = (projection: SetupReadinessProjection): IpcResponse => ({
  schemaVersion: 1,
  requestId: "setup-test",
  ok: true,
  value: { kind: "setup-readiness", projection },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("initial and navigation reads cannot request a bootstrap retry", async () => {
  const read = vi.fn(async () => response(ready(1)));
  const retry = vi.fn(async () => response(ready(2)));
  const reader = createSetupReader(read, vi.fn(), 10000, retry);
  await reader.read();
  expect(read).toHaveBeenCalledTimes(1);
  expect(retry).not.toHaveBeenCalled();
  await reader.retry();
  expect(read).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
  reader.dispose();
});
const render = (
  readiness?: SetupReadinessProjection,
  loading = false,
  error?: string,
) =>
  renderToStaticMarkup(
    createElement(SetupScreen, {
      readiness,
      loading,
      error,
      onRetry: () => undefined,
      onRemediate: () => undefined,
      onOpenInbox: () => undefined,
      onOpenDiagnostics: () => undefined,
    }),
  );
afterEach(() => vi.useRealTimers());

describe("Issue 1 renderer setup readiness", () => {
  it.each(checks)(
    "gives an actionable next step for $id independently",
    (check) => {
      const incomplete = {
        ...ready(),
        ready: false,
        completedCount: 4,
        checks: checks.map((item) =>
          item.id === check.id
            ? { ...item, status: "incomplete" as const }
            : item,
        ),
      };
      const markup = render(incomplete);
      expect(markup).toContain("4 of 5 checks complete; 1 remaining.");
      expect(markup).toContain("incomplete");
      expect(markup).toContain('disabled="">Open PR inbox');
      expect(markup).toContain("Optional:");
      expect(markup).not.toContain("Skip");
      if (check.id === "local-prerequisites") {
        expect(markup).toContain("Retry local prerequisites");
        expect(markup).toContain("Open diagnostics and recovery");
      }
      if (check.id === "ai-access")
        expect(markup).toContain(
          "configure OPENAI_API_KEY in the approved runtime environment",
        );
    },
  );

  it("labels local AI preflight accurately and enables inbox without any PR", () => {
    const markup = render(ready());
    expect(markup).toContain(
      "Configured locally; service access is checked when work starts",
    );
    expect(markup).toContain("5 of 5 checks complete; 0 remaining.");
    expect(markup).not.toContain('disabled="">Open PR inbox');
  });

  it("renders bounded loading and read failure with accessible Retry and disabled inbox", () => {
    expect(render(undefined, true)).toContain('aria-busy="true"');
    expect(render(undefined, true)).toContain("Checking setup…");
    const markup = render(ready(), false, "Setup read failed");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Retry setup checks");
    expect(markup).toContain('disabled="">Open PR inbox');
  });

  it("defaults each new HOME to recomputed readiness while preserving explicit review, activity and settings destinations", () => {
    expect(setupLanding("home", undefined)).toBe("setup");
    expect(setupLanding("home", ready())).toBe("inbox");
    expect(setupLanding("home", { ...ready(), ready: false })).toBe("setup");
    for (const destination of [
      "target",
      "activity",
      "settings",
      "diagnostics",
      "setup",
    ])
      expect(setupLanding(destination, { ...ready(), ready: false })).toBe(
        destination,
      );
  });

  it("rejects stale reads and stale invalidations after a newer update", async () => {
    const pending = deferred<IpcResponse>();
    const states: SetupReadState[] = [];
    const reader = createSetupReader(
      () => pending.promise,
      (state) => states.push(state),
    );
    const read = reader.retry();
    reader.updated(ready(4));
    pending.resolve(response({ ...ready(2), ready: false }));
    await read;
    reader.updated({ ...ready(3), ready: false });
    expect(states.at(-1)?.readiness).toEqual(ready(4));
    expect(states.at(-1)?.loading).toBe(false);
    reader.dispose();
  });

  it("keeps the newest retry result when reads finish out of order", async () => {
    const first = deferred<IpcResponse>();
    const second = deferred<IpcResponse>();
    const states: SetupReadState[] = [];
    const port = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const reader = createSetupReader(port, (state) => states.push(state));
    const earlier = reader.retry();
    const later = reader.retry();
    second.resolve(response(ready(3)));
    await later;
    first.resolve(response({ ...ready(1), ready: false }));
    await earlier;
    expect(states.at(-1)?.readiness).toEqual(ready(3));
    reader.dispose();
  });

  it("keeps failed reads incomplete and clears errors on an authoritative update", async () => {
    const states: SetupReadState[] = [];
    const reader = createSetupReader(
      async () => {
        throw new Error("Not copied to renderer");
      },
      (state) => states.push(state),
    );
    await reader.retry();
    expect(states.at(-1)?.readiness).toBeUndefined();
    expect(states.at(-1)?.error).not.toContain("Not copied");
    reader.updated({ ...ready(2), ready: false, completedCount: 4 });
    expect(states.at(-1)?.error).toBeUndefined();
    expect(states.at(-1)?.readiness?.ready).toBe(false);
    reader.dispose();
  });

  it("times out the bridge read, retries safely, and ignores its late response", async () => {
    vi.useFakeTimers();
    const old = deferred<IpcResponse>();
    const states: SetupReadState[] = [];
    const port = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response(ready(8)));
    const reader = createSetupReader(port, (state) => states.push(state), 25);
    const first = reader.retry();
    await vi.advanceTimersByTimeAsync(25);
    await first;
    expect(states.at(-1)?.error).toContain("Retry");
    await reader.retry();
    old.resolve(response({ ...ready(1), ready: false }));
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ readiness: ready(8), loading: false });
    expect(port).toHaveBeenCalledTimes(2);
    reader.dispose();
  });

  it("does not restore renderer memory after close/reopen or apply reads after disposal", async () => {
    const pending = deferred<IpcResponse>();
    const changed = vi.fn();
    const reader = createSetupReader(() => pending.promise, changed);
    const first = reader.retry();
    reader.dispose();
    pending.resolve(response(ready()));
    await first;
    expect(changed).toHaveBeenCalledTimes(1);
    const reopened: SetupReadState[] = [];
    const next = createSetupReader(
      async () => response({ ...ready(2), ready: false, completedCount: 4 }),
      (state) => reopened.push(state),
    );
    await next.retry();
    expect(reopened[0]?.readiness).toBeUndefined();
    expect(reopened.at(-1)?.readiness?.ready).toBe(false);
    next.dispose();
  });
});
