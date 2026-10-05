import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  initialShellRoute,
  routeOpenTarget,
  routeAfterPrRemoval,
  savedWorkTarget,
} from "../src/renderer/shell-routing";
import {
  createPrDetailReader,
  type PrDetailReadState,
} from "../src/renderer/pr-detail-reader";
import { PrDetail } from "../src/renderer/PrDetail";
import { ManagedPrInbox } from "../src/renderer/ManagedPrInbox";
import { projectManagedPrInbox } from "../src/shared/inbox";
import { projectManagedPrWork } from "../src/main/managed-pr-work";
import {
  parseIpcRequest,
  parseIpcResponse,
  type IpcResponse,
  type IpcResponseValue,
} from "../src/shared/ipc";
import { customerExplanation } from "../src/renderer/customer-copy";
import { managedPrFixture } from "./support/managed-pr-fixture";
import { ManagedPrInboxService } from "../src/main/managed-pr-inbox-service";
import {
  createF24SelectionSession,
  applyF24SelectionCommand,
} from "../src/shared/f24-synchronization";

const time = "2026-10-05T00:00:00.000Z";
const response = (value: IpcResponseValue): IpcResponse => ({
  schemaVersion: 1,
  requestId: "read-shell",
  ok: true,
  value,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const pr = (id: string) => managedPrFixture(id, "READY_FOR_REVIEW", time);

it("reopening the same saved target requests a fresh read without changing its identity", () => {
  const target = savedWorkTarget("SYNCHRONIZATION_RESULT", "result-a");
  const first = routeOpenTarget(initialShellRoute, target);
  const reopened = routeOpenTarget(first, target);
  expect(reopened.synchronizationResultId).toBe("result-a");
  expect(reopened.activation).toBe(first.activation + 1);
});

it("unchanged authoritative Inbox reads preserve the revision required by branch-sync guards", () => {
  let records = [pr("pr-a"), pr("pr-b")],
    tick = 0;
  const service = new ManagedPrInboxService({
    managedPrs: {
      listManagedPrs: () => records,
      getManagedPr: (id) => records.find((record) => record.id === id),
    },
    persistence: { listSynchronizationResults: () => [] },
    now: () => `2026-10-05T00:00:0${tick++}.000Z`,
  });
  const visible = service.read();
  const session = createF24SelectionSession({
    projection: service.read(),
    now: time,
  });
  expect(service.read().version).toBe(visible.version);
  const selected = applyF24SelectionCommand(
    session,
    service.read(),
    {
      command: "TOGGLE",
      managedPrId: "pr-a",
      projectionRevision: visible.version,
    },
    time,
  );
  expect(selected.selectedManagedPrIds).toEqual(["pr-a"]);
  records = [...records, { ...pr("pr-c"), title: "A new actual PR" }];
  expect(() =>
    applyF24SelectionCommand(
      selected,
      service.read(),
      {
        command: "TOGGLE",
        managedPrId: "pr-b",
        projectionRevision: visible.version,
      },
      time,
    ),
  ).toThrow("F24_SELECTION_PROJECTION_STALE");
});

it("routes all six target kinds without starting work; HOME retains inspection and saved-target state", () => {
  let route = routeOpenTarget(
    initialShellRoute,
    savedWorkTarget("MANAGED_PR", "pr-a"),
  );
  expect(route).toMatchObject({
    destination: "inbox",
    selectedManagedPrId: "pr-a",
    detailTab: "overview",
  });
  route = routeOpenTarget(
    route,
    savedWorkTarget("MANAGED_PR_SETTINGS", "pr-b"),
  );
  expect(route).toMatchObject({
    destination: "inbox",
    selectedManagedPrId: "pr-b",
    detailTab: "settings",
  });
  route = routeOpenTarget(route, savedWorkTarget("REVIEW_BUNDLE", "bundle-a"));
  route = routeOpenTarget(
    route,
    savedWorkTarget("SYNCHRONIZATION_RESULT", "result-a"),
  );
  route = routeOpenTarget(
    route,
    savedWorkTarget("SYNCHRONIZATION_BATCH", "batch-b"),
  );
  expect(route.synchronizationResultId).toBeUndefined();
  expect(route.synchronizationBatchId).toBe("batch-b");
  route = routeOpenTarget(
    route,
    savedWorkTarget("SYNCHRONIZATION_RESULT", "result-b"),
  );
  expect(route.synchronizationBatchId).toBeUndefined();
  expect(route.synchronizationResultId).toBe("result-b");
  const home = routeOpenTarget(route, {
    schemaVersion: 1,
    kind: "HOME",
    requestId: "home-shell",
  });
  expect(home).toMatchObject({
    destination: "home",
    selectedManagedPrId: "pr-b",
    reviewBundleId: "bundle-a",
    target: route.target,
  });
  expect(routeAfterPrRemoval(home, ["pr-b"])).toBe(home);
  expect(routeAfterPrRemoval(home, []).selectedManagedPrId).toBeUndefined();
  expect(() => savedWorkTarget("REVIEW_BUNDLE", "C:/some/path")).toThrow(
    "SAVED_TARGET_INVALID",
  );
});

it("a delayed PR reply cannot replace a later selection; missing IDs never fall back to another PR", async () => {
  const delayed = deferred<IpcResponse>();
  const states: PrDetailReadState[] = [];
  const reader = createPrDetailReader(
    {
      details: async (id) =>
        id === "pr-a"
          ? delayed.promise
          : response({
              kind: "managed-pr-details",
              managedPr: id === "missing" ? null : pr(id),
            }),
      candidates: async () => undefined,
      work: async (id) =>
        response({
          kind: "managed-pr-work",
          work: { managedPrId: id, reviews: [], synchronization: [] },
        }),
    },
    (state) => states.push(state),
  );
  const first = reader.load("pr-a");
  await reader.load("pr-b");
  expect(states.at(-1)?.details?.id).toBe("pr-b");
  delayed.resolve(
    response({ kind: "managed-pr-details", managedPr: pr("pr-a") }),
  );
  await first;
  expect(states.at(-1)?.details?.id).toBe("pr-b");
  await reader.load("missing");
  expect(states.at(-1)?.details).toBeUndefined();
  expect(states.at(-1)?.error).toContain("unavailable");
  reader.dispose();
  await reader.load("pr-a");
  expect(states.at(-1)?.selectedId).toBe("missing");
});

it("a bounded read failure keeps no unrelated details and does not expose internal error prose", async () => {
  const states: PrDetailReadState[] = [];
  const reader = createPrDetailReader(
    {
      details: () => new Promise(() => undefined),
      candidates: async () => undefined,
      work: async () => undefined,
    },
    (state) => states.push(state),
    5,
  );
  await reader.load("pr-a");
  expect(states.at(-1)).toMatchObject({ selectedId: "pr-a", loading: false });
  expect(states.at(-1)?.details).toBeUndefined();
  expect(states.at(-1)?.error).toContain("Retry details");
  reader.dispose();
});

it("saved-work pages retain every owned record and do not expose another PR's targets", () => {
  const reviews = Array.from({ length: 105 }, (_, index) => ({
    managedPrId: "pr-a",
    bundleId: `bundle-${String(index).padStart(3, "0")}`,
    updatedAt: time,
  }));
  const mixed = [
    ...reviews,
    { managedPrId: "other-pr", bundleId: "other-review", updatedAt: time },
  ];
  const batches = [
    {
      batchId: "batch-a",
      rows: [
        { managedPrId: "pr-a", operationId: "sync-a" },
        { managedPrId: "other-pr", operationId: "sync-other" },
      ],
    },
  ];
  const pages = [0, 50, 100].map((offset) =>
    projectManagedPrWork("pr-a", mixed, batches, offset),
  );
  expect(
    pages.flatMap((page) => page.reviews).map((item) => item.bundleId),
  ).toEqual(reviews.map((item) => item.bundleId));
  expect(pages[0]?.synchronization).toEqual([
    { batchId: "batch-a", resultId: "sync-a" },
  ]);
  expect(pages[2]?.nextOffset).toBeUndefined();
  const request = {
    schemaVersion: 1,
    requestId: "work-page",
    type: "managed-pr.work.read",
    payload: { managedPrId: "pr-a", offset: 50 },
  };
  expect(parseIpcRequest(request).ok).toBe(true);
  expect(
    parseIpcRequest({ ...request, payload: { ...request.payload, offset: -1 } })
      .ok,
  ).toBe(false);
  expect(
    parseIpcRequest({
      ...request,
      payload: { ...request.payload, unexpected: true },
    }).ok,
  ).toBe(false);
  expect(
    parseIpcResponse(response({ kind: "managed-pr-work", work: pages[0]! })),
  ).toBe(true);
  expect(mixed).toHaveLength(106);
  expect(mixed[0]?.bundleId).toBe("bundle-000");
});

it("Inbox inspection and synchronization selection have distinct controls; selected tabs render only their content", () => {
  const model = pr("pr-a"),
    snapshot = projectManagedPrInbox({
      managedPrs: [model],
      version: 1,
      generatedAt: time,
    });
  const markup = renderToStaticMarkup(
    createElement(ManagedPrInbox, {
      snapshot,
      loading: false,
      error: undefined,
      lastKnown: false,
      onRetry: () => undefined,
      onNavigate: () => undefined,
      onAddPr: () => undefined,
      selection: undefined,
      confirmation: undefined,
      preparationIntent: undefined,
      selectionBusy: false,
      confirmingPreparation: false,
      onSelectionCommand: () => undefined,
      onOpenSynchronization: () => undefined,
      onConfirmPreparation: () => undefined,
      selectedManagedPrId: "pr-a",
    }),
  );
  expect(markup).toContain('type="checkbox"');
  expect(markup).toContain("for synchronization");
  expect(markup).toContain('class="inbox-inspect"');
  expect(markup).toContain('aria-pressed="true"');
  const detailProps = {
    card: snapshot.cards[0]!,
    details: model,
    work: { managedPrId: "pr-a", reviews: [], synchronization: [] },
    error: "",
    onTab: () => undefined,
    onBack: () => undefined,
    onOpen: () => undefined,
    onRetry: () => undefined,
    settings: createElement("form", { "aria-label": "Configuration form" }),
  };
  const overview = renderToStaticMarkup(
    createElement(PrDetail, { ...detailProps, tab: "overview" }),
  );
  expect(overview).toContain("Base branch");
  expect(overview).not.toContain("Configuration form");
  expect(overview).not.toContain('class="activity-viewer"');
  const settings = renderToStaticMarkup(
    createElement(PrDetail, { ...detailProps, tab: "settings" }),
  );
  expect(settings).toContain("Configuration form");
  expect(settings).not.toContain("Base branch");
  expect(
    renderToStaticMarkup(
      createElement(PrDetail, {
        ...detailProps,
        card: undefined,
        tab: "overview",
      }),
    ),
  ).toContain("Select a pull request to see its details");
  expect(
    customerExplanation(
      "F22 owning records remain authoritative",
      "Inspect saved work.",
    ),
  ).toBe("Inspect saved work.");
});
