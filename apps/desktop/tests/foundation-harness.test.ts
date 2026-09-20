import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGitFixture,
  createOwnedDirectoryForTest,
  directoryExists,
  runBoundedProcess,
  sanitizeChildEnvironment,
} from "./support/foundation-harness.js";

describe("F01 deterministic foundation harness", () => {
  it("creates isolated deterministic Git refs with synthetic identity and no remote", async () => {
    const [first, second] = await Promise.all([
      createGitFixture(),
      createGitFixture(),
    ]);
    try {
      expect(path.isAbsolute(first.path)).toBe(true);
      expect(path.dirname(first.path)).toBe(path.dirname(second.path));
      expect(first.path).not.toBe(second.path);
      expect(first.mainSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(first.featureSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(first.mainSha).toBe(second.mainSha);
      expect(first.featureSha).toBe(second.featureSha);
      expect(first.mainSha).not.toBe(first.featureSha);
      expect(first.featureTag).toBe("fixture-v1");
      expect(await readFile(path.join(first.path, "feature.txt"), "utf8")).toBe(
        "deterministic feature\n",
      );
      const gitConfig = await readFile(
        path.join(first.path, ".git", "config"),
        "utf8",
      );
      expect(gitConfig).toContain("PRMonitor F01 Fixture");
      expect(gitConfig).not.toContain("[remote");
      expect(
        await readFile(
          path.join(first.path, ".git", "refs", "heads", "fixture", "feature"),
          "utf8",
        ),
      ).toContain(first.featureSha);
      await first.cleanup();
      await second.cleanup();
      expect(await directoryExists(first.path)).toBe(false);
      expect(await directoryExists(second.path)).toBe(false);
    } finally {
      await first.cleanup().catch(() => undefined);
      await second.cleanup().catch(() => undefined);
    }
  });

  it("fails closed with machine-readable Git remediation when Git is unavailable", async () => {
    await expect(
      createGitFixture({ gitExecutable: "prmonitor-git-does-not-exist" }),
    ).rejects.toMatchObject({
      code: "GIT_UNAVAILABLE",
    });
  });

  it("removes only an owned temporary directory and refuses an ownership race", async () => {
    const owned = await createOwnedDirectoryForTest();
    const marker = await readFile(owned.markerPath, "utf8");
    await writeFile(owned.markerPath, '{"owner":"different-owner"}\n', "utf8");
    await expect(owned.cleanup()).rejects.toMatchObject({
      code: "FIXTURE_CLEANUP_REFUSED",
    });
    expect(await directoryExists(owned.path)).toBe(true);
    await writeFile(owned.markerPath, marker, "utf8");
    await owned.cleanup();
    await owned.cleanup();
    expect(await directoryExists(owned.path)).toBe(false);
  });

  it("refuses cleanup when a nested path is replaced by a symlink or junction", async () => {
    const owned = await createOwnedDirectoryForTest();
    const outside = await mkdtemp(
      path.join(os.tmpdir(), "prmonitor-f01-outside-"),
    );
    const link = path.join(owned.path, "nested", "escape");
    try {
      await symlink(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(owned.cleanup()).rejects.toMatchObject({
        code: "FIXTURE_CLEANUP_REFUSED",
      });
      expect(await directoryExists(owned.path)).toBe(true);
    } finally {
      await unlink(link).catch(() => undefined);
      await rm(outside, { recursive: true, force: true });
      await owned.cleanup().catch(() => undefined);
    }
  });

  it("sanitizes secret-shaped child environment names while retaining explicit runtime variables", () => {
    const sanitized = sanitizeChildEnvironment(
      {
        PATH: "synthetic-path",
        CI: "1",
        PRMONITOR_SMOKE: "1",
        PRMONITOR_UNDOCUMENTED_VALUE: "do-not-inherit",
        TYPESAFE_API_KEY: "do-not-inherit",
        GITHUB_TOKEN: "do-not-inherit",
        OPENAI_API_KEY: "do-not-inherit",
        PUBLISH_PASSWORD: "do-not-inherit",
        NODE_OPTIONS: "--require=secret-loader",
        UNRELATED_LOCAL_VALUE: "do-not-inherit",
      },
      ["PRMONITOR_SMOKE"],
    );

    expect(sanitized).toEqual({
      PATH: "synthetic-path",
      CI: "1",
      PRMONITOR_SMOKE: "1",
    });
    expect(sanitized).not.toHaveProperty("TYPESAFE_API_KEY");
    expect(sanitized).not.toHaveProperty("NODE_OPTIONS");
    expect(sanitized).not.toHaveProperty("PRMONITOR_UNDOCUMENTED_VALUE");
  });

  it("terminates a bounded child process instead of waiting indefinitely", async () => {
    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60000)"],
        100,
      ),
    ).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
  });

  it("keeps F01 source free of downstream product capability imports", async () => {
    const appRoot = path.resolve(import.meta.dirname, "..");
    const entries = await readdir(path.join(appRoot, "src"), {
      recursive: true,
      withFileTypes: true,
    });
    const sourceFiles = entries.filter(
      (entry) => entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name),
    );
    for (const entry of sourceFiles) {
      const relative = path.relative(
        path.join(appRoot, "src"),
        path.join(entry.parentPath, entry.name),
      );
      const contents = await readFile(
        path.join(entry.parentPath, entry.name),
        "utf8",
      );
      if (relative.startsWith(`shared${path.sep}domain${path.sep}`)) continue;
      expect(contents, relative).not.toMatch(
        /from ["'][^"']*(?:sqlite|github|worktree|publication|watcher|scheduler|tray|notification|deep-link)[^"']*["']/iu,
      );
    }
  });
});
