import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createWindowsJob, type WindowsJob } from "./windows-job";

export class CopilotCleanupError extends Error {
  constructor() {
    super(
      "Copilot process cleanup could not be confirmed. Restart PRMonitor before using this connection again.",
    );
  }
}
export interface CopilotProcessOptions {
  worker: string;
  cwd: string;
  env: Record<string, string>;
  createJob?: () => WindowsJob;
  cleanupTimeoutMs?: number;
}
/** Public child identity + OS owner; the SDK process handle is never inspected. */
export class CopilotProcess {
  readonly child: ChildProcess;
  private readonly job?: WindowsJob;
  private readonly cleanupTimeoutMs: number;
  private closed = false;
  private assigned = false;
  private cleanup?: Promise<void>;
  constructor(options: CopilotProcessOptions) {
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5000;
    // Create the kill-on-close owner before launch, then assign before activation.
    this.job =
      options.createJob?.() ??
      (process.platform === "win32" ? createWindowsJob() : undefined);
    try {
      this.child = spawn(
        process.execPath,
        [options.worker, "--prmonitor-copilot-worker"],
        {
          cwd: options.cwd,
          env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" },
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          serialization: "json",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
    } catch (error) {
      this.job?.close();
      throw error;
    }
    this.child.once("close", () => {
      this.closed = true;
    });
    this.child.on("error", () => {});
  }
  activate(pid: number, birth?: string): void {
    if (this.closed || this.cleanup || this.assigned || this.child.pid !== pid)
      throw new Error("Copilot worker ownership changed before activation.");
    if (this.job) {
      if (!birth)
        throw new Error("Copilot worker has no Windows process identity.");
      this.job.assign(pid, birth);
      if (this.job.activeProcesses() !== 1)
        throw new Error(
          "Copilot worker started before ownership was assigned.",
        );
    }
    this.assigned = true;
  }
  private signal(signal: NodeJS.Signals): void {
    if (this.job) {
      // Assignment may have committed before its confirmation failed. Always
      // clean the Job as well as a possibly still-unassigned bootstrap child.
      try {
        this.job.terminate();
      } finally {
        if (!this.closed) this.child.kill(signal);
      }
      return;
    }
    if (process.platform !== "win32" && this.child.pid) {
      try {
        process.kill(-this.child.pid, signal);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        ))
          throw error;
      }
    } else if (!this.closed) this.child.kill(signal);
  }
  private async empty(): Promise<boolean> {
    if (this.job) return this.job.activeProcesses() === 0;
    if (process.platform === "win32" || !this.child.pid) return this.closed;
    if (process.platform === "linux") {
      // Linux may retain orphan zombies until init reaps them. They cannot run or
      // retain streams. The directly owned worker is still awaited via close.
      for (const name of await readdir("/proc")) {
        if (!/^\d+$/u.test(name)) continue;
        try {
          const stat = await readFile(`/proc/${name}/stat`, "utf8");
          const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          if (Number(fields[2]) === this.child.pid && fields[0] !== "Z")
            return false;
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            ["ENOENT", "ESRCH"].includes(String(error.code))
          ))
            throw error;
        }
      }
      return true;
    }
    try {
      process.kill(-this.child.pid, 0);
      return false;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH")
        return true;
      throw error;
    }
  }
  close(): Promise<void> {
    return (this.cleanup ??= this.reap());
  }
  private async reap(): Promise<void> {
    const deadline = Date.now() + this.cleanupTimeoutMs;
    try {
      try {
        this.signal("SIGTERM");
      } catch {
        // A failed native termination still needs the independent child kill
        // and an accounting check; only a confirmed empty owner can resolve.
      }
      if (process.platform !== "win32") await delay(200);
      // Always escalate for descendants, including when the direct worker exited.
      try {
        this.signal("SIGKILL");
      } catch {
        // Query the still-retained owner below before declaring uncertainty.
      }
      do {
        if (this.closed && (await this.empty())) {
          this.job?.close();
          return;
        }
        await delay(20);
      } while (Date.now() < deadline);
    } catch {
      /* Keep the Job handle alive so owner exit still kills its tree. */
    }
    throw new CopilotCleanupError();
  }
}
