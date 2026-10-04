import { describe, expect, it, vi } from "vitest";
import {
  createSetupLocalPrerequisitesReader,
  type SetupLocalPrerequisitesOptions,
} from "../src/main/setup-local-prerequisites";

function fixture(): SetupLocalPrerequisitesOptions {
  return {
    platform: "win32",
    readWorktreeRoot: () => ({
      worktreeRoot: "C:/PRMonitor/worktrees",
      rootRevision: 2,
    }),
    resolveRoot: vi.fn(async () => ({
      ok: true,
      canonicalPath: "C:/PRMonitor/worktrees",
      configuredPath: "C:/PRMonitor/worktrees",
      rootRevision: 2,
    })),
    persistenceHealthy: () => true,
    protectedRoots: [
      "C:/PRMonitor/data/database.sqlite",
      "C:/PRMonitor/data/secure-credentials",
    ],
    developerClonePaths: () => ["C:/developer/clone"],
    environmentSource: {
      PATH: "C:/Git/bin",
      OPENAI_API_KEY: "fixture-only",
      GITHUB_TOKEN: "fixture-only",
      HOME: "C:/secret-home",
    },
    runGitVersion: vi.fn(async () => ({
      exitCode: 0,
      stdout: "git version 2.55.0.windows.1\n",
    })),
  };
}

describe("production local setup prerequisite reader", () => {
  it("checks Git version and existing F13 root without secret environment or mutations", async () => {
    const options = fixture();
    expect(await createSetupLocalPrerequisitesReader(options)()).toEqual({
      git: "ready",
      storage: "ready",
      worktreeRoot: "ready",
    });
    expect(options.resolveRoot).toHaveBeenCalledWith({
      worktreeRoot: "C:/PRMonitor/worktrees",
      rootRevision: 2,
      developerClonePaths: ["C:/developer/clone"],
    });
    expect(options.runGitVersion).toHaveBeenCalledWith({
      executable: "git",
      args: ["--version"],
      timeoutMs: 5000,
      env: {
        PATH: "C:/Git/bin",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
      },
    });
  });
  it.each([
    "C:/PRMonitor/data",
    "C:/PRMonitor/data/secure-credentials",
    "C:/PRMonitor/data/secure-credentials/worktrees",
    "C:/PRMonitor/data/database.sqlite",
  ])(
    "rejects protected root overlap %s before filesystem probing",
    async (worktreeRoot) => {
      const options = fixture();
      const result = await createSetupLocalPrerequisitesReader({
        ...options,
        readWorktreeRoot: () => ({ worktreeRoot, rootRevision: 2 }),
      })();
      expect(result.worktreeRoot).toBe("invalid");
      expect(options.resolveRoot).not.toHaveBeenCalled();
    },
  );
  it("checks the canonical default root against protected paths", async () => {
    const options = fixture();
    const result = await createSetupLocalPrerequisitesReader({
      ...options,
      readWorktreeRoot: () => ({ rootRevision: 0 }),
      resolveRoot: async () => ({
        ok: true,
        canonicalPath: "C:/PRMonitor/data",
        configuredPath: "C:/PRMonitor/data",
        rootRevision: 0,
      }),
    })();
    expect(result.worktreeRoot).toBe("invalid");
  });
  it.each([
    "C:/PRMonitor/../data",
    "//server/share/worktrees",
    "C:/PRMonitor/worktrees:secret",
  ])("rejects unsafe F29 path syntax %s", async (worktreeRoot) => {
    const options = fixture();
    expect(
      (
        await createSetupLocalPrerequisitesReader({
          ...options,
          readWorktreeRoot: () => ({ worktreeRoot, rootRevision: 1 }),
        })()
      ).worktreeRoot,
    ).toBe("invalid");
  });
  it("preserves F13 failure for unwritable and clone-overlapping roots", async () => {
    const options = fixture();
    const resolveRoot: SetupLocalPrerequisitesOptions["resolveRoot"] =
      async () => ({ ok: false, rootRevision: 1 });
    expect(
      (await createSetupLocalPrerequisitesReader({ ...options, resolveRoot })())
        .worktreeRoot,
    ).toBe("invalid");
  });
  it.each([
    { exitCode: 1, stdout: "git version 2.55.0" },
    { exitCode: 0, stdout: "some unknown executable" },
    { exitCode: null, stdout: "" },
  ])("requires successful actual Git version output", async (version) => {
    expect(
      (
        await createSetupLocalPrerequisitesReader({
          ...fixture(),
          runGitVersion: async () => version,
        })()
      ).git,
    ).toBe("missing");
  });
  it("reports database failure independently without exposing errors", async () => {
    const result = await createSetupLocalPrerequisitesReader({
      ...fixture(),
      persistenceHealthy: () => false,
    })();
    expect(result).toEqual({
      git: "ready",
      storage: "failed",
      worktreeRoot: "ready",
    });
  });
  it("bounds unavailable read ports without leaking exception contents", async () => {
    const result = await createSetupLocalPrerequisitesReader({
      ...fixture(),
      timeoutMs: 5,
      runGitVersion: () => new Promise(() => {}),
      resolveRoot: () => new Promise(() => {}),
      persistenceHealthy: () => {
        throw new Error("secret-fixture-path");
      },
    })();
    expect(result).toEqual({
      git: "unavailable",
      storage: "unavailable",
      worktreeRoot: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("secret-fixture-path");
  });
});
