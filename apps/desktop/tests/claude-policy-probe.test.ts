import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudePolicyProbe } from "../src/main/ai/claude-policy-probe";
describe("policy helper lifecycle", () => {
  it("kills a stalled helper ignoring SIGTERM and returns only a fixed policy decision", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prmonitor-policy-probe-"));
    let child: ChildProcess | undefined;
    try {
      let started: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const launch = ((
        _exe: string,
        _args: string[],
        options: Parameters<typeof spawn>[2],
      ) => {
        child = spawn(
          process.execPath,
          [
            "-e",
            'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000);',
          ],
          options,
        );
        child.stdout!.once("data", () => started());
        return child;
      }) as typeof spawn;
      const controller = new AbortController();
      const checked = createClaudePolicyProbe(launch)(
        root,
        {},
        controller.signal,
      );
      await ready;
      controller.abort();
      expect(await checked).toEqual({ supported: false, reason: "unknown" });
      expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
