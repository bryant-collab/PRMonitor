import { readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copilotSessionOptions } from "../src/main/ai/copilot-policy";
import { createWindowsJob } from "../src/main/ai/windows-job";
import {
  CopilotProcess,
  CopilotCleanupError,
} from "../src/main/ai/copilot-process";
import {
  decodeCopilotMessage,
  encodeCopilotMessage,
  COPILOT_POLICY_LIMIT,
} from "../src/main/ai/copilot-wire";
import {
  copilotProcessFixture,
  processRunning,
  waitFor,
  fixtureSession,
} from "./copilot-fixture";

const fixtures: Awaited<ReturnType<typeof copilotProcessFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.client.closeOwnedRuntime().catch(() => {});
    await rm(f.root, { recursive: true, force: true });
  }
});
async function fixture(
  mode: Parameters<typeof copilotProcessFixture>[0] = "normal",
) {
  const f = await copilotProcessFixture(mode);
  fixtures.push(f);
  return f;
}
function settings(root: string) {
  return copilotSessionOptions({
    model: "gpt-5",
    workingDirectory: root,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
  });
}
async function assertGone(
  f: Awaited<ReturnType<typeof fixture>>,
  identities: number[],
) {
  for (const pid of identities)
    expect(
      await processRunning(pid),
      `owned fixture PID ${pid} is still running`,
    ).toBe(false);
  const heartbeat = await f.heartbeat();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(await f.heartbeat()).toBe(heartbeat);
}
async function traceFixture<T>(
  f: Awaited<ReturnType<typeof fixture>>,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const trace = (await readFile(path.join(f.root, "requests.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).method);
    throw new Error(
      `Synthetic SDK fixture methods before failure: ${trace.join(", ")}`,
      { cause: error },
    );
  }
}
describe("supervised Copilot SDK worker and native ownership", () => {
  it("keeps supported SDK stdio, models/auth and deny-first scoped hooks across a fresh and resumed task", async () => {
    const f = await fixture("policy");
    await f.client.start();
    const identities = await f.identities();
    await waitFor(
      () => f.heartbeat(),
      (n) => n >= 2,
    );
    expect(await traceFixture(f, () => f.client.getAuthStatus())).toEqual({
      isAuthenticated: true,
      authType: "user",
      host: "github.com",
    });
    expect(await traceFixture(f, () => f.client.listModels())).toEqual([
      { id: "gpt-5", supportedReasoningEfforts: ["medium"] },
    ]);
    const session = await traceFixture(f, () =>
      f.client.createSession(settings(f.root)),
    );
    expect(await traceFixture(f, () => session.rpc.model.getCurrent())).toEqual(
      { modelId: "gpt-5" },
    );
    expect(
      (
        await traceFixture(f, () =>
          session.sendAndWait("synthetic input", 5000),
        )
      )?.data.content,
    ).toContain("Fixture answer");
    const decisions = JSON.parse(
      await readFile(path.join(f.root, "policy.json"), "utf8"),
    );
    expect(decisions[0]).toEqual({ output: {} });
    expect(decisions).toHaveLength(6);
    for (const decision of decisions.slice(1))
      expect(decision).toMatchObject({
        output: { permissionDecision: "deny" },
      });
    const config = JSON.parse(
      await readFile(path.join(f.root, "settings.json"), "utf8"),
    );
    expect(config).toMatchObject({
      availableTools: ["builtin:view", "builtin:glob", "builtin:grep"],
      enableFileHooks: false,
      enableHostGitOperations: false,
      enableConfigDiscovery: false,
      enableSkills: false,
      providers: [],
      models: [],
      memory: { enabled: false },
    });
    const env = JSON.parse(
      await readFile(path.join(f.root, "environment.json"), "utf8"),
    );
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    await traceFixture(f, () => session.disconnect());
    const resumed = await traceFixture(f, () =>
      f.client.resumeSession(session.sessionId, {
        ...settings(f.root),
        continuePendingWork: false,
      }),
    );
    expect(
      (
        await traceFixture(f, () =>
          resumed.sendAndWait("synthetic resume", 5000),
        )
      )?.data.content,
    ).toContain("Fixture answer");
    expect(
      JSON.parse(await readFile(path.join(f.root, "settings.json"), "utf8")),
    ).toMatchObject({
      continuePendingWork: false,
      enableFileHooks: false,
      enableHostGitOperations: false,
    });
    await f.client.closeOwnedRuntime();
    await assertGone(f, identities);
  }, 15000);
  it.each(["startup-hang", "send-hang", "stop-hang", "runtime-exit"] as const)(
    "awaits runtime, surviving grandchildren and retained streams after %s",
    async (mode) => {
      const f = await fixture(mode);
      const started = f.client.start();
      const startOutcome = started.then(
        () => "started",
        () => "failed",
      );
      const identities = await f.identities();
      await waitFor(
        () => f.heartbeat(),
        (n) => n >= 2,
      );
      let pending: Promise<unknown> | undefined;
      if (mode !== "startup-hang") {
        await started;
        if (mode !== "stop-hang") {
          const session = await f.client.createSession(settings(f.root));
          pending = session
            .sendAndWait("synthetic hang", 5000)
            .catch(() => "failed");
          await waitFor(
            () => readFile(path.join(f.root, "sent"), "utf8"),
            (value) => value.length > 0,
          );
        }
      }
      await Promise.all([
        f.client.closeOwnedRuntime(),
        f.client.closeOwnedRuntime(),
      ]);
      expect(["started", "failed"]).toContain(await startOutcome);
      if (pending) expect(await pending).toBe("failed");
      await assertGone(f, identities);
    },
    15000,
  );
  it("rejects partial Job assignment and cleans the Job before any SDK runtime starts", async () => {
    const f = await fixture();
    const job = {
      assign: vi.fn(),
      terminate: vi.fn(),
      activeProcesses: vi.fn(() => 2),
      close: vi.fn(),
    };
    const owner = new CopilotProcess({
      worker: f.worker,
      cwd: f.root,
      env: {},
      createJob: () => job,
    });
    await new Promise<void>((resolve) => owner.child.once("spawn", resolve));
    expect(() => owner.activate(owner.child.pid!, "1")).toThrow();
    job.activeProcesses.mockReturnValue(0);
    await owner.close();
    expect(job.terminate).toHaveBeenCalled();
    expect(job.close).toHaveBeenCalledOnce();
    expect(
      owner.child.exitCode !== null || owner.child.signalCode !== null,
    ).toBe(true);
    await expect(readFile(path.join(f.root, "runtime.pid"))).rejects.toThrow();
  });
  it("reports uncertain Job accounting instead of pretending worker close is a tree receipt", async () => {
    const f = await fixture();
    const job = {
      assign: vi.fn(),
      terminate: vi.fn(),
      activeProcesses: vi.fn(() => 1),
      close: vi.fn(),
    };
    const owner = new CopilotProcess({
      worker: f.worker,
      cwd: f.root,
      env: {},
      createJob: () => job,
      cleanupTimeoutMs: 100,
    });
    await new Promise<void>((resolve) => owner.child.once("spawn", resolve));
    await expect(owner.close()).rejects.toBeInstanceOf(CopilotCleanupError);
    expect(job.close).not.toHaveBeenCalled();
    expect(
      owner.child.exitCode !== null || owner.child.signalCode !== null,
    ).toBe(true);
  });
  it("rejects oversized or malformed policy messages and mismatched reply types", () => {
    expect(() => decodeCopilotMessage({ kind: "request" })).toThrow();
    expect(() =>
      decodeCopilotMessage('{"kind":"policy-result","id":1,"allow":"yes"}'),
    ).toThrow();
    expect(() =>
      encodeCopilotMessage({
        kind: "policy",
        id: 1,
        scope: 1,
        sessionId: fixtureSession,
        workingDirectory: "fixture",
        toolName: "view",
        toolArgs: { path: "x".repeat(COPILOT_POLICY_LIMIT) },
      }),
    ).toThrow();
  });
  it.each(["throw", "timeout"] as const)(
    "denies a %s in the parent permission callback without accepting a late allow",
    async (failure) => {
      const f = await fixture("policy-single");
      await f.client.start();
      const input = settings(f.root);
      input.hooks!.onPreToolUse = async () => {
        if (failure === "throw") throw new Error("Synthetic callback failure.");
        await new Promise((resolve) => setTimeout(resolve, 3500));
        return {};
      };
      const session = await f.client.createSession(input);
      await session.sendAndWait("synthetic input", 5000);
      expect(
        JSON.parse(await readFile(path.join(f.root, "policy.json"), "utf8")),
      ).toMatchObject([{ output: { permissionDecision: "deny" } }]);
      await f.client.closeOwnedRuntime();
    },
    15000,
  );
  it("keeps timed-out validators charged against the host callback cap", async () => {
    const f = await fixture("policy-burst");
    await f.client.start();
    const input = settings(f.root);
    const validate = vi.fn(async () => new Promise<never>(() => {}));
    input.hooks!.onPreToolUse = validate;
    const session = await f.client.createSession(input);
    await session.sendAndWait("synthetic input", 5000);
    const decisions = JSON.parse(
      await readFile(path.join(f.root, "policy.json"), "utf8"),
    );
    expect(decisions).toHaveLength(33);
    for (const decision of decisions)
      expect(decision).toMatchObject({
        output: { permissionDecision: "deny" },
      });
    expect(validate).toHaveBeenCalledTimes(32);
    await f.client.closeOwnedRuntime();
  }, 15000);
  it.runIf(process.platform === "win32")(
    "native Windows Job accounts for the entire SDK tree and reaches zero before its handle is released",
    async () => {
      let job: ReturnType<typeof createWindowsJob> | undefined;
      let countAtClose: number | undefined;
      const f = await copilotProcessFixture("stop-hang", {
        createJob: () => {
          job = createWindowsJob();
          return {
            ...job,
            close: () => {
              countAtClose = job!.activeProcesses();
              job!.close();
            },
          };
        },
      });
      fixtures.push(f);
      await f.client.start();
      const identities = await f.identities();
      expect(job!.activeProcesses()).toBeGreaterThanOrEqual(4);
      await f.client.closeOwnedRuntime();
      expect(countAtClose).toBe(0);
      await assertGone(f, identities);
    },
    15000,
  );
  it("cancellation before activation closes the bootstrap without initializing the SDK", async () => {
    const f = await fixture();
    const start = f.client.start().catch(() => "cancelled");
    await f.client.closeOwnedRuntime();
    expect(await start).toBe("cancelled");
    await expect(readFile(path.join(f.root, "runtime.pid"))).rejects.toThrow();
  });
  it.runIf(process.platform === "win32")(
    "rejects a native worker creation-time mismatch before SDK initialization",
    async () => {
      const f = await fixture();
      const owner = new CopilotProcess({
        worker: f.worker,
        cwd: f.root,
        env: f.env,
      });
      try {
        const boot = await new Promise<ReturnType<typeof decodeCopilotMessage>>(
          (resolve, reject) => {
            owner.child.once("message", (raw) => {
              try {
                resolve(decodeCopilotMessage(raw));
              } catch (error) {
                reject(error);
              }
            });
            owner.child.once("error", reject);
          },
        );
        if (boot.kind !== "booted" || !boot.birth)
          throw new Error("Missing fixture worker birth identity.");
        const wrongBirth = String(BigInt(boot.birth) + 1n);
        expect(() => owner.activate(boot.pid, wrongBirth)).toThrow(
          "identity changed",
        );
      } finally {
        await owner.close();
      }
      await expect(
        readFile(path.join(f.root, "runtime.pid")),
      ).rejects.toThrow();
    },
  );
  it("does not launch a worker when Job creation fails", async () => {
    const f = await copilotProcessFixture("normal", {
      createJob: () => {
        throw new Error("Synthetic native ownership failure.");
      },
    });
    fixtures.push(f);
    await expect(f.client.start()).rejects.toThrow(
      "Synthetic native ownership failure",
    );
    await f.client.closeOwnedRuntime();
    await expect(readFile(path.join(f.root, "runtime.pid"))).rejects.toThrow();
  });
  it.runIf(process.platform === "win32")(
    "loads the packaged Electron worker and native ABI before activation and loads the packaged SDK only inside an assigned Job",
    async () => {
      const f = await fixture();
      const executable = path.resolve(
        "../../release/win-unpacked/PRMonitor.exe",
      );
      expect((await stat(executable)).isFile()).toBe(true);
      const archive = path.join(
        path.dirname(executable),
        "resources",
        "app.asar",
      );
      const nativeModule = pathToFileURL(
        path.join(
          archive,
          "node_modules/@prmonitor/provider-runtimes/native.mjs",
        ),
      ).href;
      const sdkModule = pathToFileURL(
        path.join(
          archive,
          "node_modules/@prmonitor/provider-runtimes/index.mjs",
        ),
      ).href;
      const probe = path.join(f.root, "package-probe.mjs");
      await writeFile(
        probe,
        `
import { nativeFFI } from ${JSON.stringify(nativeModule)};
const k=nativeFFI.load("kernel32.dll");const current=k.func("__stdcall","GetCurrentProcess","void *",[]);const times=k.func("__stdcall","GetProcessTimes","int32",["void *","void *","void *","void *","void *"]);
const creation=Buffer.alloc(8);if(!times(current(),creation,Buffer.alloc(8),Buffer.alloc(8),Buffer.alloc(8)))process.exit(1);
process.send(JSON.stringify({kind:"booted",pid:process.pid,birth:creation.readBigUInt64LE().toString()}));
process.on("message",async()=>{try{const sdk=await import(${JSON.stringify(sdkModule)});process.send(JSON.stringify({kind:"reply",id:1,ok:typeof sdk.CopilotClient==="function"&&typeof sdk.RuntimeConnection.forStdio==="function"}));}catch{process.send(JSON.stringify({kind:"reply",id:1,ok:false}));}});
process.on("disconnect",()=>process.exit(1));setTimeout(()=>process.exit(1),10000);
`,
      );
      for (const entry of [
        path.join(archive, "out/main/copilot-worker.js"),
        probe,
      ]) {
        const job = createWindowsJob();
        const child = spawn(executable, [entry, "--prmonitor-copilot-worker"], {
          cwd: f.root,
          env: { ...f.env, ELECTRON_RUN_AS_NODE: "1" },
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        let closed = false;
        const ended = new Promise<void>((resolve) =>
          child.once("close", () => {
            closed = true;
            resolve();
          }),
        );
        async function message() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              new Promise<ReturnType<typeof decodeCopilotMessage>>(
                (resolve, reject) => {
                  child.once("message", (raw) => {
                    try {
                      resolve(decodeCopilotMessage(raw));
                    } catch (error) {
                      reject(error);
                    }
                  });
                  child.once("error", reject);
                  child.once("close", () =>
                    reject(new Error("Packaged worker exited before receipt.")),
                  );
                },
              ),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                  () => reject(new Error("Packaged worker receipt timed out.")),
                  5000,
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
        try {
          const boot = await message();
          expect(boot.kind).toBe("booted");
          if (boot.kind !== "booted" || !boot.birth)
            throw new Error("Missing native bootstrap identity.");
          job.assign(boot.pid, boot.birth);
          expect(job.activeProcesses()).toBe(1);
          const receipt = message();
          child.send(
            encodeCopilotMessage({
              kind: "request",
              id: 1,
              method: "stop",
              payload: null,
            }),
          );
          expect(await receipt).toMatchObject({
            kind: "reply",
            id: 1,
            ok: true,
          });
        } finally {
          job.terminate();
          if (!closed) child.kill("SIGKILL");
          await waitFor(
            async () => closed,
            (value) => value,
          );
          await ended;
          await waitFor(
            async () => job.activeProcesses(),
            (count) => count === 0,
          );
          job.close();
        }
      }
    },
    20000,
  );
  it("kills the owned tree if the SDK worker crashes before normal cleanup", async () => {
    const f = await fixture("send-hang");
    await f.client.start();
    const identities = await f.identities();
    await waitFor(
      () => f.heartbeat(),
      (n) => n >= 2,
    );
    const session = await f.client.createSession(settings(f.root));
    const pending = session
      .sendAndWait("synthetic input", 5000)
      .catch(() => "failed");
    await waitFor(
      () => readFile(path.join(f.root, "sent"), "utf8"),
      (value) => value.length > 0,
    );
    const runtime = JSON.parse(
      (await readFile(path.join(f.root, "requests.jsonl"), "utf8"))
        .split("\n")
        .filter(Boolean)[0]!,
    );
    expect(runtime.method).toBe("connect");
    // CopilotProcess owns the bootstrap child, whose PID is the runtime's parent.
    // Retrieve it only from a fixture marker, never from an SDK private field.
    const workerPid = Number(
      await readFile(path.join(f.root, "worker.pid"), "utf8"),
    );
    process.kill(workerPid, "SIGKILL");
    expect(await pending).toBe("failed");
    await f.client.closeOwnedRuntime();
    await assertGone(f, identities);
  }, 15000);
  it("owner crash closes the noninherited Job or disconnects the POSIX group owner", async () => {
    const f = await fixture("send-hang");
    const file = path.join(f.root, "owner.mjs");
    const built = pathToFileURL(
      path.resolve("out/main/copilot-supervisor.js"),
    ).href;
    await writeFile(
      file,
      `import { SupervisedCopilotClient } from ${JSON.stringify(built)}; const client=new SupervisedCopilotClient(${JSON.stringify(f.options)},{shutdownTimeoutMs:100});await client.start();process.send("ready");setInterval(()=>{},1000);`,
    );
    const child = spawn(process.execPath, [file], {
      cwd: f.root,
      env: f.env,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    child.stderr?.resume();
    try {
      const ready = new Promise<void>((resolve, reject) => {
        child.once("message", () => resolve());
        child.once("error", reject);
        child.once("exit", () =>
          reject(new Error("Fixture owner exited before ready.")),
        );
      });
      await ready;
      const identities = await f.identities();
      await waitFor(
        () => f.heartbeat(),
        (n) => n >= 2,
      );
      const closed = new Promise<void>((resolve) =>
        child.once("close", resolve),
      );
      child.kill("SIGKILL");
      await closed;
      for (const pid of identities)
        await waitFor(
          () => processRunning(pid),
          (value) => !value,
        );
      await assertGone(f, identities);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  }, 15000);
  it("owner crash before assignment cannot initialize the SDK or leave an unassigned bootstrap", async () => {
    const f = await fixture();
    const file = path.join(f.root, "bootstrap-owner.mjs");
    const built = pathToFileURL(
      path.resolve("out/main/copilot-supervisor.js"),
    ).href;
    await writeFile(
      file,
      `import { CopilotProcess } from ${JSON.stringify(built)};const owner=new CopilotProcess(${JSON.stringify({ worker: f.worker, cwd: f.root, env: f.env })});owner.child.once("spawn",()=>process.send({pid:owner.child.pid}));setInterval(()=>{},1000);`,
    );
    const child = spawn(process.execPath, [file], {
      cwd: f.root,
      env: f.env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let workerPid: number | undefined;
    child.once("message", (raw) => {
      workerPid = (raw as { pid: number }).pid;
    });
    const ended = new Promise<void>((resolve) => child.once("close", resolve));
    try {
      await waitFor(
        async () => workerPid,
        (value) => Number.isSafeInteger(value),
      );
      child.kill("SIGKILL");
      await ended;
      await waitFor(
        () => processRunning(workerPid!),
        (value) => !value,
      );
      await expect(
        readFile(path.join(f.root, "runtime.pid")),
      ).rejects.toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  }, 15000);
  it("application shutdown awaits its registered trees and prevents another worker from starting", async () => {
    const f = await fixture("stop-hang");
    const file = path.join(f.root, "shutdown-owner.mjs");
    const built = pathToFileURL(
      path.resolve("out/main/copilot-supervisor.js"),
    ).href;
    await writeFile(
      file,
      `import { SupervisedCopilotClient, shutdownCopilotWorkers } from ${JSON.stringify(built)};const client=new SupervisedCopilotClient(${JSON.stringify(f.options)},{shutdownTimeoutMs:100});await client.start();process.send("ready");process.once("message",async()=>{await shutdownCopilotWorkers();let rejected=false;try{await new SupervisedCopilotClient(${JSON.stringify(f.options)}).start();}catch{rejected=true;}process.send({closed:true,rejected});});setInterval(()=>{},1000);`,
    );
    const child = spawn(process.execPath, [file], {
      cwd: f.root,
      env: f.env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let ready = false;
    const ended = new Promise<void>((resolve) => child.once("close", resolve));
    let receipt: { closed: boolean; rejected: boolean } | undefined;
    child.on("message", (raw) => {
      if (raw === "ready") ready = true;
      else receipt = raw as typeof receipt;
    });
    try {
      await waitFor(
        async () => ready,
        (value) => value,
      );
      const identities = await f.identities();
      child.send("shutdown");
      await waitFor(
        async () => receipt,
        (value) => Boolean(value),
      );
      expect(receipt).toEqual({ closed: true, rejected: true });
      expect(child.exitCode).toBeNull();
      await assertGone(f, identities);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await ended;
    }
  }, 15000);
});
