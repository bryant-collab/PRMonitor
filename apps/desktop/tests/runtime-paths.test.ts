import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import {
  resolveRuntimePaths,
  RUNTIME_OWNER_FILE,
} from "../src/main/runtime-paths";

it("fails closed for missing/unsafe automation roots without opening a customer-like sentinel", async () => {
  const temporaryRoot = os.tmpdir();
  const root = await mkdtemp(
    path.join(temporaryRoot, "prmonitor-runtime-paths-"),
  );
  try {
    const customerRoot = path.join(root, "sentinel-customer");
    await mkdir(customerRoot);
    await writeFile(
      path.join(customerRoot, "sentinel"),
      "must remain unchanged",
    );
    const input = {
      packaged: true,
      customerRoot,
      appData: root,
      temporaryRoot,
      environment: { PRMONITOR_SMOKE: "1" },
    };
    expect(() => resolveRuntimePaths(input)).toThrow("PATHS_MISSING");
    const environment = {
      PRMONITOR_SMOKE: "1",
      PRMONITOR_ISOLATED_ROOT: root,
      PRMONITOR_USER_DATA_DIR: path.join(root, "data"),
      PRMONITOR_CACHE_DIR: path.join(root, "cache"),
      PRMONITOR_WORKTREE_DIR: path.join(root, "worktrees"),
    };
    await writeFile(
      path.join(root, RUNTIME_OWNER_FILE),
      JSON.stringify({ owner: "prmonitor-runtime-fixture", root }),
    );
    expect(() => resolveRuntimePaths({ ...input, environment })).toThrow(
      "ROOT_UNSAFE",
    );
    const isolated = await mkdtemp(
      path.join(temporaryRoot, "prmonitor-runtime-owner-"),
    );
    try {
      await writeFile(
        path.join(isolated, RUNTIME_OWNER_FILE),
        JSON.stringify({ owner: "prmonitor-runtime-fixture", root: isolated }),
      );
      const paths = {
        ...environment,
        PRMONITOR_ISOLATED_ROOT: isolated,
        PRMONITOR_USER_DATA_DIR: path.join(isolated, "data"),
        PRMONITOR_CACHE_DIR: path.join(isolated, "cache"),
        PRMONITOR_WORKTREE_DIR: path.join(isolated, "worktrees"),
      };
      expect(resolveRuntimePaths({ ...input, environment: paths }).mode).toBe(
        "isolated",
      );
      expect(() =>
        resolveRuntimePaths({
          ...input,
          environment: { ...paths, PRMONITOR_USER_DATA_DIR: customerRoot },
        }),
      ).toThrow("OUTSIDE_OWNER");
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
    expect(await readFile(path.join(customerRoot, "sentinel"), "utf8")).toBe(
      "must remain unchanged",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("separates manual development and requires an explicit production-profile opt-in", () => {
  const input = {
    environment: {},
    packaged: false,
    customerRoot: path.join(os.tmpdir(), "customer-data"),
    appData: os.tmpdir(),
    temporaryRoot: os.tmpdir(),
  };
  expect(resolveRuntimePaths(input).userData).toBe(
    path.join(os.tmpdir(), "PRMonitor Development"),
  );
  expect(
    resolveRuntimePaths({
      ...input,
      environment: { PRMONITOR_USE_PRODUCTION_PROFILE: "1" },
    }).userData,
  ).toBe(input.customerRoot);
  expect(resolveRuntimePaths({ ...input, packaged: true }).userData).toBe(
    input.customerRoot,
  );
  expect(() =>
    resolveRuntimePaths({ ...input, environment: { NODE_ENV: "test" } }),
  ).toThrow("PATHS_MISSING");
  expect(() =>
    resolveRuntimePaths({
      ...input,
      environment: { PRMONITOR_USER_DATA_DIR: input.customerRoot },
    }),
  ).toThrow("REQUIRES_ISOLATION");
});
