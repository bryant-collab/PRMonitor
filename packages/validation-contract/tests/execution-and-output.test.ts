import { describe, expect, it } from "vitest";
import {
  StreamAccumulator,
  captureStreams,
  redactText,
  normalizeDisplayOutput,
  resolveWorkingDirectory,
  isPathWithin,
  effectiveTimeoutSeconds,
  effectiveOutputLimitBytes,
  createControlledEnvironment,
  resolveExecutable,
  prepareCommand,
  terminateProcessTree,
  transitionStepState,
  transitionRunState,
  handleRendererClosed,
  statusFromExit,
  type PathPort,
} from "../src/index.js";

describe("working-directory and command execution policy", () => {
  const fakePathPort: PathPort = {
    canonicalize(input) {
      const paths: Record<string, string> = {
        "/operation": "/operation",
        "/operation/src": "/operation/src",
        "/operation/link": "/outside/real",
        "/operation2": "/operation2",
        "/outside/real": "/outside/real",
      };
      return paths[input] ?? input;
    },
    isDirectory(input) {
      return ["/operation", "/operation/src", "/outside/real"].includes(input);
    },
  };

  it("accepts the root and child, and rejects traversal, absolute, symlink, and sibling-prefix escapes", () => {
    expect(resolveWorkingDirectory("/operation", ".", { platform: "posix", pathPort: fakePathPort })).toMatchObject({ ok: true });
    expect(resolveWorkingDirectory("/operation", "src", { platform: "posix", pathPort: fakePathPort })).toMatchObject({ ok: true });
    for (const candidate of ["..", "src/../..", "/outside", "C:\\outside", "link"]) {
      expect(resolveWorkingDirectory("/operation", candidate, { platform: "posix", pathPort: fakePathPort })).toMatchObject({
        ok: false,
        reason: "WORKTREE_PATH_INVALID",
      });
    }
    expect(isPathWithin("/operation", "/operation2", { platform: "posix" })).toBe(false);
    expect(isPathWithin("C:\\Work", "c:\\work\\src", { platform: "win32" })).toBe(true);
    expect(isPathWithin("C:\\Work", "C:\\Worktree", { platform: "win32" })).toBe(false);
  });

  it("applies inclusive timeout/limit bounds and records a resolved executable without a shell", () => {
    expect(effectiveTimeoutSeconds(undefined)).toEqual({ ok: true, value: 600 });
    expect(effectiveTimeoutSeconds(1)).toEqual({ ok: true, value: 1 });
    expect(effectiveTimeoutSeconds(3600)).toEqual({ ok: true, value: 3600 });
    expect(effectiveTimeoutSeconds(0).ok).toBe(false);
    expect(effectiveTimeoutSeconds(3601).ok).toBe(false);
    expect(effectiveOutputLimitBytes(1).ok).toBe(true);
    expect(effectiveOutputLimitBytes(1048577).ok).toBe(false);
    const prepared = prepareCommand({
      step: {
        kind: "command",
        id: "test",
        label: "Test",
        executable: "node",
        arguments: ["-e", "console.log('ok')"],
        workingDirectory: ".",
        timeoutSeconds: 1,
        outputLimitBytes: 100,
      },
      operationWorktreeRoot: "/operation",
      platform: "posix",
      pathPort: fakePathPort,
      environment: { PATH: "/tools" },
      fileExists: (candidate) => candidate === "/tools/node",
      executable: (candidate) => candidate === "/tools/node",
    });
    expect(prepared).toMatchObject({ ok: true });
    if (prepared.ok) {
      expect(prepared.command).toMatchObject({
        resolvedExecutable: "/tools/node",
        shell: false,
        timeoutSeconds: 1,
        outputLimitBytes: 100,
      });
    }
  });

  it("filters credential-shaped environment keys and does not inherit an arbitrary parent environment", () => {
    const environment = createControlledEnvironment({
      toolchainEnvironment: {
        PATH: "/tools",
        NODE_ENV: "test",
        GITHUB_TOKEN: "synthetic-github-token",
        OPENAI_API_KEY: "synthetic-ai-key",
        UNRELATED_PARENT_SECRET: "secret",
      },
    });
    expect(environment).toEqual({ PATH: "/tools", NODE_ENV: "test" });
  });
});

describe("runner-neutral lifecycle and process termination", () => {
  it("allows only legal lifecycle transitions and makes renderer closure a no-op", () => {
    expect(transitionStepState("pending", "running")).toMatchObject({ ok: true, state: "running" });
    expect(transitionStepState("passed", "running")).toMatchObject({ ok: false, reason: "INVALID_TRANSITION" });
    expect(transitionRunState("running", "failed")).toMatchObject({ ok: true, state: "failed" });
    const state = { status: "running" as const };
    expect(handleRendererClosed(state)).toBe(state);
  });

  it("requests graceful tree termination, waits exactly five seconds, then force-terminates survivors", async () => {
    const events: string[] = [];
    const result = await terminateProcessTree({
      reason: "TIMED_OUT",
      processTree: "tree-1",
      processControl: {
        requestGracefulTermination: () => events.push("graceful"),
        listSurvivingProcesses: () => {
          events.push("list");
          return ["child-2"];
        },
        forceTerminate: (processes) => events.push(`force:${processes.join(",")}`),
      },
      clock: {
        wait: async (milliseconds) => events.push(`wait:${milliseconds}`),
      },
    });
    expect(events).toEqual(["graceful", "wait:5000", "list", "force:child-2"]);
    expect(result).toMatchObject({ waitedMilliseconds: 5000, forceTerminated: ["child-2"] });
  });

  it("makes observed exit status authoritative", () => {
    expect(statusFromExit({ exitCode: 0 })).toEqual({ status: "passed" });
    expect(statusFromExit({ exitCode: 1 })).toEqual({ status: "failed", reason: "NON_ZERO_EXIT" });
    expect(statusFromExit({ startError: true, exitCode: 0 })).toEqual({ status: "failed", reason: "START_FAILED" });
    expect(statusFromExit({ exitCode: 0, timedOut: true })).toEqual({ status: "interrupted", reason: "TIMED_OUT" });
    expect(statusFromExit({ exitCode: 0, cancellationReason: "USER_CANCELLED" })).toEqual({ status: "interrupted", reason: "USER_CANCELLED" });
  });
});

describe("bounded output and redaction", () => {
  it("keeps small output unchanged, normalizes display controls, and redacts known/sensitive values", () => {
    expect(redactText("diagnostic token=alpha123 password=\"beta456\"", { knownSecrets: ["known-secret"] }).text).toBe(
      "diagnostic token=[REDACTED] password=\"[REDACTED]\"",
    );
    expect(redactText("Authorization: Bearer bearer-value").text).toBe("Authorization: Bearer [REDACTED]");
    expect(redactText("diagnostic value=ordinary").text).toBe("diagnostic value=ordinary");
    const accumulator = new StreamAccumulator({ limitBytes: 1024, knownSecrets: ["known-secret"] });
    accumulator.append("ok\r\n");
    accumulator.append("token=known-");
    accumulator.append("secret\u001b[31m!\u001b[0m");
    const output = accumulator.finish();
    expect(output).toMatchObject({ safe: true, redacted: true, originalByteCount: 32 });
    expect(output.text).toContain("token=[REDACTED]!");
    expect(output.text).not.toContain("known-secret");
    expect(output.text).not.toContain("\u001b");
    expect(normalizeDisplayOutput("a\r\nb\u0000\tc")).toBe("a\nb\tc");
  });

  it("bounds each stream independently and preserves head/tail with an explicit marker", () => {
    const result = captureStreams({
      limitBytes: 64,
      stdout: ["HEAD-", "x".repeat(300), "-TAIL"],
      stderr: ["ERR"],
    });
    expect(result.stdout.truncated).toBe(true);
    expect(result.stdout.text).toContain("output truncated");
    expect(result.stdout.text.startsWith("HEAD")).toBe(true);
    expect(result.stdout.text.endsWith("TAIL")).toBe(true);
    expect(result.stdout.retainedByteCount).toBeLessThanOrEqual(64);
    expect(result.stdout.originalByteCount).toBe(310);
    expect(result.stderr).toMatchObject({ text: "ERR", truncated: false, originalByteCount: 3 });
  });

  it("redacts secrets across chunk boundaries, keeps UTF-8 display safe, and fails closed on redaction failure", () => {
    const split = new StreamAccumulator({ limitBytes: 128, knownSecrets: ["secret-value"] });
    split.append("before secret-");
    split.append("value after");
    const splitResult = split.finish();
    expect(splitResult.text).toBe("before [REDACTED] after");
    expect(splitResult.text).not.toContain("secret-value");

    const utf8 = new StreamAccumulator({ limitBytes: 20 });
    utf8.append("🙂".repeat(20));
    const utf8Result = utf8.finish();
    expect(utf8Result.text).not.toContain("�");

    const failed = new StreamAccumulator({
      limitBytes: 128,
      redactor: () => {
        throw new Error("synthetic redaction failure");
      },
    });
    failed.append("secret");
    expect(failed.finish()).toMatchObject({ safe: false, reason: "REDACTION_FAILURE" });
  });
});
