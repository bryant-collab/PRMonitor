import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultF13GitCommandRunner } from "../src/main/f13-git";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

afterEach(() => vi.resetAllMocks());

async function environmentFor(args: readonly string[]) {
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => child.emit("close", 0));
    return child as unknown as ChildProcess;
  });
  const result = await new DefaultF13GitCommandRunner().run(args, {
    cwd: os.tmpdir(),
  });
  expect(result.ok).toBe(true);
  return vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env;
}

describe("F13 command-scoped merge analysis identity", () => {
  it("supplies a synthetic committer only to the allowlisted no-commit merge", async () => {
    const env = await environmentFor([
      "merge",
      "--no-commit",
      "--no-ff",
      "--",
      "a".repeat(40),
    ]);
    expect(env?.GIT_COMMITTER_NAME).toBe("PRMonitor merge analysis");
    expect(env?.GIT_COMMITTER_EMAIL).toBe(
      "prmonitor-merge-analysis@example.invalid",
    );
    expect(env?.GIT_AUTHOR_NAME).toBeUndefined();
    expect(env?.GIT_AUTHOR_EMAIL).toBeUndefined();
  });

  it("does not supply the analysis identity to an actual commit", async () => {
    const env = await environmentFor([
      "commit",
      "--no-gpg-sign",
      "-m",
      "Explicitly approved publication",
    ]);
    expect(env?.GIT_COMMITTER_NAME).toBeUndefined();
    expect(env?.GIT_COMMITTER_EMAIL).toBeUndefined();
  });
});
