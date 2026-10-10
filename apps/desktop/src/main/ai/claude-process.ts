import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Transform } from "node:stream";
import type { Options } from "@prmonitor/provider-runtimes";

/** Own the SDK child and bound bytes before its JSON decoder. */
export function ownClaudeProcess(controller: AbortController): {
  spawn: NonNullable<Options["spawnClaudeCodeProcess"]>;
  close(): Promise<void>;
} {
  let child: ChildProcessWithoutNullStreams | undefined;
  let ended: Promise<void> | undefined;
  let reaping: Promise<void> | undefined;
  let output: Transform | undefined;
  const terminate = async () => {
    if (!child) return;
    if (reaping) return reaping;
    const owned = child;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && owned.pid)
          process.kill(-owned.pid, signal);
        else if (owned.exitCode === null && owned.signalCode === null)
          owned.kill(signal);
      } catch {
        /* Already reaped. */
      }
    };
    kill("SIGTERM");
    reaping = (async () => {
      // Retain the force kill even when the direct child exits first: its
      // process group may still contain descendants holding inherited pipes.
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      kill("SIGKILL");
      await ended;
    })();
    return reaping;
  };
  const abort = () => {
    void terminate();
  };
  controller.signal.addEventListener("abort", abort, { once: true });
  return {
    spawn: (options) => {
      controller.signal.throwIfAborted();
      if (child)
        throw new Error("Claude Code requested more than one runtime child.");
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      ended = new Promise<void>((resolve) => child!.once("close", resolve));
      child.stderr.resume();
      child.stdin.on("error", () => {});
      let total = 0;
      let line = 0;
      output = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          total += chunk.length;
          let valid = total <= 8 * 1024 * 1024;
          for (const byte of chunk) {
            line = byte === 10 ? 0 : line + 1;
            if (line > 256 * 1024) valid = false;
          }
          if (!valid) {
            controller.abort();
            done(new Error("Claude Code exceeded the output limit."));
          } else done(null, chunk);
        },
      });
      output.on("error", () => {
        controller.abort();
      });
      child.stdout.on("error", () => {
        controller.abort();
      });
      child.stdout.pipe(output);
      const owned = child;
      return {
        stdin: owned.stdin,
        stdout: output,
        get killed() {
          return owned.killed;
        },
        get exitCode() {
          return owned.exitCode;
        },
        get signalCode() {
          return owned.signalCode;
        },
        kill: (signal) => owned.kill(signal),
        on: (event, listener) => {
          owned.on(event, listener);
        },
        once: (event, listener) => {
          owned.once(event, listener);
        },
        off: (event, listener) => {
          owned.off(event, listener);
        },
      };
    },
    close: async () => {
      controller.signal.removeEventListener("abort", abort);
      await terminate();
      output?.destroy();
    },
  };
}
