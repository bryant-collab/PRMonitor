import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ownClaudeProcess } from "../src/main/ai/claude-process";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function program(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "prmonitor-owned-cli-"));
  roots.push(root);
  const script = path.join(root, "fixture.cjs");
  await writeFile(script, source);
  return { root, script };
}
describe("owned Claude SDK runtime child", () => {
  it("bounds an unterminated line before JSON decoding and reaps the child", async () => {
    const fixture = await program(
      'process.stdout.write("x".repeat(256*1024+1));setInterval(()=>{},1000);',
    );
    const controller = new AbortController();
    const owner = ownClaudeProcess(controller);
    const child = owner.spawn({
      command: process.execPath,
      args: [fixture.script],
      cwd: fixture.root,
      env: {},
      signal: controller.signal,
    });
    child.on("error", () => {});
    const error = new Promise<void>((resolve) =>
      child.stdout.once("error", () => resolve()),
    );
    child.stdout.resume();
    await error;
    expect(controller.signal.aborted).toBe(true);
    await owner.close();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it("force-reaps a child ignoring SIGTERM before releasing process ownership", async () => {
    const fixture = await program(
      'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000);',
    );
    const controller = new AbortController();
    const owner = ownClaudeProcess(controller);
    const child = owner.spawn({
      command: process.execPath,
      args: [fixture.script],
      cwd: fixture.root,
      env: {},
      signal: controller.signal,
    });
    child.on("error", () => {});
    await new Promise<void>((resolve) =>
      child.stdout.once("data", () => resolve()),
    );
    controller.abort();
    await owner.close();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it("does not launch cancelled work", () => {
    const controller = new AbortController();
    controller.abort();
    const owner = ownClaudeProcess(controller);
    expect(() =>
      owner.spawn({
        command: process.execPath,
        args: [],
        env: {},
        signal: controller.signal,
      }),
    ).toThrow();
  });
});
