import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  link,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeToolPermitted,
  projectClaudePolicy,
} from "../src/main/ai/claude-policy";
import {
  copilotToolPermitted,
  copilotSessionOptions,
} from "../src/main/ai/copilot-adapter";
import { invokeScopedFileTool } from "../src/main/ai/scoped-file-tools";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "prmonitor-files-"));
  roots.push(root);
  const owned = path.join(root, "owned");
  await mkdir(owned);
  await writeFile(path.join(owned, "file.txt"), "hello");
  await writeFile(path.join(root, "outside.txt"), "outside sentinel");
  return { root, owned };
}
const options = (root: string, write = true) => ({
  model: "gpt-5",
  sandboxMode: write ? ("workspace-write" as const) : ("read-only" as const),
  workingDirectory: root,
  approvalPolicy: "never" as const,
  networkAccessEnabled: false,
});
describe("provider file-only boundary", () => {
  it("permits canonical reads and authorized edits while denying traversal, links, commands, and read-only writes", async () => {
    const { root, owned } = await fixture();
    await symlink(
      root,
      path.join(owned, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await link(path.join(root, "outside.txt"), path.join(owned, "hard.txt"));
    expect(
      await claudeToolPermitted(owned, false, "Read", {
        file_path: "file.txt",
      }),
    ).toBe(true);
    for (const file_path of [
      "../outside.txt",
      path.join(root, "outside.txt"),
      "linked/outside.txt",
      "hard.txt",
    ])
      expect(
        await claudeToolPermitted(owned, true, "Write", { file_path }),
      ).toBe(false);
    expect(
      await claudeToolPermitted(owned, false, "Read", {
        file_path: "hard.txt",
      }),
    ).toBe(false);
    expect(
      await claudeToolPermitted(owned, false, "Grep", {
        path: ".",
        pattern: "sentinel",
      }),
    ).toBe(false);
    expect(
      (
        await invokeScopedFileTool(options(owned, false), "read_file", {
          path: "hard.txt",
        })
      ).success,
    ).toBe(false);
    expect(
      await claudeToolPermitted(owned, false, "Edit", {
        file_path: "file.txt",
      }),
    ).toBe(false);
    expect(
      await claudeToolPermitted(owned, true, "Bash", {
        command: "echo unsafe",
      }),
    ).toBe(false);
    expect(
      await claudeToolPermitted(owned, false, "Glob", { pattern: "../*" }),
    ).toBe(false);
    expect(
      await claudeToolPermitted(owned, false, "Grep", { glob: "../*" }),
    ).toBe(false);
    expect(
      await copilotToolPermitted(owned, true, "builtin:edit", {
        path: "file.txt",
        old_str: "hello",
        new_str: "world",
      }),
    ).toBe(true);
    for (const name of ["mcp:view", "custom:view", "Bash"])
      expect(
        await copilotToolPermitted(owned, true, name, { path: "file.txt" }),
      ).toBe(false);
    expect(
      await copilotToolPermitted(owned, true, "edit", {
        path: "file.txt",
        cwd: root,
      }),
    ).toBe(false);
    expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe(
      "outside sentinel",
    );
  });
  it("runs host file tools with strict arguments, byte bounds, literal edits, Git protection, and cancellation", async () => {
    const { root, owned } = await fixture();
    const opt = options(owned);
    expect(
      await invokeScopedFileTool(opt, "read_file", { path: "file.txt" }),
    ).toMatchObject({ success: true, contentItems: [{ text: "hello" }] });
    expect(
      (
        await invokeScopedFileTool(opt, "edit_file", {
          path: "file.txt",
          old: "hello",
          replacement: "world",
        })
      ).success,
    ).toBe(true);
    expect(await readFile(path.join(owned, "file.txt"), "utf8")).toBe("world");
    expect(
      (
        await invokeScopedFileTool(opt, "write_file", {
          path: "new.txt",
          content: "new",
        })
      ).success,
    ).toBe(true);
    for (const [name, args] of [
      ["write_file", { path: "../outside.txt", content: "changed" }],
      ["write_file", { path: ".git/config", content: "changed" }],
      ["read_file", { path: "file.txt", extra: true }],
      [
        "write_file",
        { path: "large.txt", content: "x".repeat(128 * 1024 + 1) },
      ],
      ["edit_file", { path: "file.txt", old: "absent", replacement: "new" }],
    ] as const)
      expect((await invokeScopedFileTool(opt, name, args)).success).toBe(false);
    expect(
      (
        await invokeScopedFileTool(options(owned, false), "write_file", {
          path: "file.txt",
          content: "bad",
        })
      ).success,
    ).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await invokeScopedFileTool(
          opt,
          "write_file",
          { path: "file.txt", content: "bad" },
          controller.signal,
        )
      ).success,
    ).toBe(false);
    expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe(
      "outside sentinel",
    );
    expect(await readFile(path.join(owned, "file.txt"), "utf8")).toBe("world");
  });
  it("retains managed denials and disables Copilot discovery, commands, MCP, memory and pending resume work", async () => {
    expect(projectClaudePolicy({ effective: {}, sources: [] })).toEqual({
      supported: true,
      reason: "compatible",
    });
    for (const effective of [
      { hooks: { PreToolUse: [{}] } },
      { env: { ANTHROPIC_API_KEY: "synthetic" } },
      { forceLoginMethod: "console" },
      { apiKeyHelper: "fixture" },
    ])
      expect(projectClaudePolicy({ effective, sources: [] }).supported).toBe(
        false,
      );
    expect(projectClaudePolicy({ effective: {} }).supported).toBe(false);
    const { owned } = await fixture();
    const config = copilotSessionOptions(options(owned));
    expect(config).toMatchObject({
      availableTools: [
        "builtin:view",
        "builtin:glob",
        "builtin:grep",
        "builtin:edit",
        "builtin:create",
      ],
      enableConfigDiscovery: false,
      enableFileHooks: false,
      enableHostGitOperations: false,
      providers: [],
      models: [],
      mcpServers: {},
      memory: { enabled: false },
      remoteSession: "off",
    });
    expect(
      config.onPermissionRequest!(
        { kind: "shell", sessionId: "fixture" } as never,
        { sessionId: "fixture" },
      ),
    ).toMatchObject({
      kind: "denied-no-approval-rule-and-could-not-request-from-user",
    });
  });
});
