import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  aiConnectionSchema,
  type AIConnection,
} from "../../shared/ai-connections";
import {
  checkAITool,
  toolEnvironment,
  type ToolCommand,
} from "./tool-detection";

const markerName = ".prmonitor-connection-owner.json";
const pathKey = (value: string) =>
  process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
/** Nonsecret ownership metadata only. Credential storage remains inside the provider. */
export class ConnectionAuthentication {
  private readonly holders = new Set<string>();
  private readonly queues = new Map<
    string,
    { grant(): void; reject(): void }[]
  >();
  private readonly logins = new Map<
    string,
    { promise: Promise<void>; cancel(): void }
  >();
  public constructor(
    private readonly root: string,
    private readonly source: NodeJS.ProcessEnv = process.env,
    private readonly run?: ToolCommand,
    private readonly launch: typeof spawn = spawn,
    private readonly loginTimeoutMs = 5 * 60 * 1000,
  ) {
    if (!path.isAbsolute(root))
      throw new Error(
        "AI connection storage must be an application-owned absolute path.",
      );
  }
  public async home(
    connection: AIConnection,
    create = false,
  ): Promise<string | undefined> {
    aiConnectionSchema.parse(connection);
    if (connection.signInSource !== "prmonitor") {
      const userHome = this.source.USERPROFILE ?? this.source.HOME;
      const existingHome =
        this.source.CODEX_HOME ??
        (userHome ? path.join(userHome, ".codex") : undefined);
      if (!existingHome || !path.isAbsolute(existingHome)) return undefined;
      try {
        const info = await lstat(existingHome);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error(
            "Choose an existing provider sign-in directory without links.",
          );
        return await realpath(existingHome);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return undefined;
        throw error;
      }
    }
    const directory = path.join(
      this.root,
      connection.tool,
      createHash("sha256").update(connection.id).digest("hex"),
    );
    try {
      for (const item of [this.root, path.dirname(directory), directory]) {
        if (create) await mkdir(item, { recursive: true, mode: 0o700 });
        const info = await lstat(item);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          pathKey(await realpath(item)) !== pathKey(item)
        )
          throw new Error(
            "AI connection storage has an unsupported path or link.",
          );
      }
    } catch (error) {
      if (
        !create &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return undefined;
      throw error;
    }
    const marker = path.join(directory, markerName);
    const expected = {
      owner: "prmonitor-ai-connection",
      id: connection.id,
      tool: connection.tool,
    };
    if (create) {
      try {
        await writeFile(marker, JSON.stringify(expected), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if (!(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
      }
    }
    const markerInfo = await lstat(marker);
    if (
      !markerInfo.isFile() ||
      markerInfo.isSymbolicLink() ||
      markerInfo.size > 1024
    )
      throw new Error("AI connection storage ownership could not be verified.");
    const actual: unknown = JSON.parse(await readFile(marker, "utf8"));
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        "AI connection storage belongs to a different connection.",
      );
    return directory;
  }
  public acquire(
    connectionId: string,
    signal?: AbortSignal,
  ): Promise<() => void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(connectionId) ?? [];
      if (queue.length >= 32) {
        reject(
          new Error("This connection has too much queued work. Retry later."),
        );
        return;
      }
      const release = () => {
        if (!this.holders.delete(connectionId)) return;
        const next = this.queues.get(connectionId)?.shift();
        if (next) next.grant();
        else this.queues.delete(connectionId);
      };
      const abort = () => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        signal?.removeEventListener("abort", abort);
        reject(new Error("Queued AI work was cancelled."));
      };
      const waiter = {
        grant: () => {
          signal?.removeEventListener("abort", abort);
          this.holders.add(connectionId);
          let released = false;
          resolve(() => {
            if (!released) {
              released = true;
              release();
            }
          });
        },
        reject: abort,
      };
      if (!this.holders.has(connectionId)) waiter.grant();
      else {
        this.queues.set(connectionId, queue);
        queue.push(waiter);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      }
    });
  }
  public environment(
    connection: AIConnection,
    home: string,
    source: NodeJS.ProcessEnv = this.source,
  ): Record<string, string> {
    if (connection.tool !== "codex")
      throw new Error(
        "This tool's sign-in and permission contract is not yet supported.",
      );
    return {
      ...toolEnvironment(connection.tool, connection.authMode, this.source),
      ...toolEnvironment(connection.tool, connection.authMode, source),
      CODEX_HOME: home,
    };
  }
  public async check(connection: AIConnection, signal?: AbortSignal) {
    const home = await this.home(connection);
    return checkAITool(
      {
        tool: connection.tool,
        executable: connection.executable,
        extraArgs: connection.extraArgs,
        authMode: connection.authMode,
      },
      this.run,
      this.source,
      signal,
      home,
    );
  }
  public signIn(connection: AIConnection): Promise<void> {
    const existing = this.logins.get(connection.id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.login(connection, controller.signal).finally(() =>
      this.logins.delete(connection.id),
    );
    this.logins.set(connection.id, {
      promise,
      cancel: () => controller.abort(),
    });
    return promise;
  }
  public cancel(connectionId: string): void {
    this.logins.get(connectionId)?.cancel();
  }
  public dispose(): void {
    for (const login of this.logins.values()) login.cancel();
    for (const queue of this.queues.values())
      for (const waiter of [...queue]) waiter.reject();
  }
  private async login(
    connection: AIConnection,
    signal: AbortSignal,
  ): Promise<void> {
    const release = await this.acquire(connection.id, signal);
    try {
      await this.performLogin(connection, signal);
    } finally {
      release();
    }
  }
  private async performLogin(
    connection: AIConnection,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      connection.tool !== "codex" ||
      connection.authMode !== "subscription" ||
      connection.signInSource !== "prmonitor"
    )
      throw new Error(
        "Browser sign-in is available for Codex subscription connections.",
      );
    const status = await checkAITool(
      {
        tool: connection.tool,
        executable: connection.executable,
        extraArgs: connection.extraArgs,
        authMode: connection.authMode,
      },
      this.run,
      this.source,
      signal,
    );
    if (!status.compatible || !status.executable)
      throw new Error(status.message);
    const home = await this.home(connection, true);
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = this.launch(
        status.executable!,
        [
          ...connection.extraArgs,
          "--config",
          'forced_login_method="chatgpt"',
          "login",
        ],
        {
          shell: false,
          windowsHide: true,
          env: this.environment(connection, home!),
          cwd: home!,
          stdio: "ignore",
          detached: process.platform !== "win32",
        },
      );
      let timedOut = false;
      let force: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      const kill = (forceful = false) => {
        if (closed) return;
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, forceful ? "SIGKILL" : "SIGTERM");
          } catch {
            child.kill(forceful ? "SIGKILL" : "SIGTERM");
          }
        } else child.kill(forceful ? "SIGKILL" : "SIGTERM");
      };
      const terminate = () => {
        kill();
        force ??= setTimeout(() => kill(true), 1000);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, this.loginTimeoutMs);
      const abort = () => terminate();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      let failed = false;
      child.once("error", () => {
        failed = true;
      });
      child.once("close", (code) => {
        closed = true;
        clearTimeout(timer);
        if (force) clearTimeout(force);
        signal.removeEventListener("abort", abort);
        if (failed || code !== 0 || signal.aborted || timedOut)
          reject(
            new Error(
              "Sign-in did not complete. Check this connection before trying again.",
            ),
          );
        else resolve();
      });
    });
  }
}
