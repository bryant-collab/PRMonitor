import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ClaudePolicyMetadata } from "./claude-policy";

export type ClaudePolicyProbe = (
  cwd: string,
  env: Record<string, string>,
  signal?: AbortSignal,
) => Promise<ClaudePolicyMetadata>;
export function createClaudePolicyProbe(
  launch: typeof spawn = spawn,
): ClaudePolicyProbe {
  return async (cwd, env, signal) => {
    signal?.throwIfAborted();
    return new Promise((resolve) => {
      const child = launch(
        process.execPath,
        [
          fileURLToPath(new URL("./claude-policy-helper.js", import.meta.url)),
          "--prmonitor-policy-metadata",
        ],
        {
          shell: false,
          windowsHide: true,
          cwd,
          env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.stderr.resume();
      child.stdin.on("error", () => {});
      let output = "";
      let invalid = false;
      let force: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        invalid = true;
        child.kill();
        force ??= setTimeout(() => child.kill("SIGKILL"), 1000);
      };
      const timer = setTimeout(stop, 5000);
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
      child.stdout.on("data", (chunk: Buffer) => {
        if (invalid) return;
        if (Buffer.byteLength(output) + chunk.length > 1024) {
          stop();
          return;
        }
        output += chunk.toString("utf8");
      });
      child.once("error", () => {
        invalid = true;
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (force) clearTimeout(force);
        signal?.removeEventListener("abort", stop);
        try {
          const value: unknown = JSON.parse(output);
          if (
            !invalid &&
            code === 0 &&
            typeof value === "object" &&
            value !== null &&
            "supported" in value &&
            typeof value.supported === "boolean" &&
            "reason" in value &&
            [
              "compatible",
              "launch_commands",
              "billing_override",
              "unknown",
            ].includes(String(value.reason))
          ) {
            resolve({
              supported: value.supported,
              reason: value.reason as ClaudePolicyMetadata["reason"],
            });
            return;
          }
        } catch {
          /* Never project helper diagnostics. */
        }
        resolve({ supported: false, reason: "unknown" });
      });
      child.stdin.end(JSON.stringify({ cwd }));
    });
  };
}
export const checkClaudePolicy = createClaudePolicyProbe();
