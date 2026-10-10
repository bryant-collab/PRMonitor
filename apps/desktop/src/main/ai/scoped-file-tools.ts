import { constants } from "node:fs";
import { lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { CodexThreadOptions } from "./codex-adapter";
import { claudeToolPermitted } from "./claude-policy";

const description =
  "Only files within this task's operation worktree. No commands, network, credentials, or Git administration.";
export function scopedFileTools(write: boolean): Record<string, unknown>[] {
  const schema = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  const text = { type: "string" };
  return [
    {
      type: "namespace",
      name: "prmonitor_files",
      description,
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read one bounded UTF-8 file.",
          inputSchema: schema({ path: text }, ["path"]),
          deferLoading: false,
        },
        {
          type: "function",
          name: "list_files",
          description: "List one directory without following links.",
          inputSchema: schema({ path: text }, ["path"]),
          deferLoading: false,
        },
        ...(write
          ? [
              {
                type: "function",
                name: "write_file",
                description:
                  "Write a bounded UTF-8 file; parent directory must exist.",
                inputSchema: schema({ path: text, content: text }, [
                  "path",
                  "content",
                ]),
                deferLoading: false,
              },
              {
                type: "function",
                name: "edit_file",
                description:
                  "Replace exactly one literal occurrence in a UTF-8 file.",
                inputSchema: schema(
                  { path: text, old: text, replacement: text },
                  ["path", "old", "replacement"],
                ),
                deferLoading: false,
              },
            ]
          : []),
      ],
    },
  ];
}
export interface FileToolReply {
  readonly contentItems: { type: "inputText"; text: string }[];
  readonly success: boolean;
}
export async function invokeScopedFileTool(
  options: CodexThreadOptions,
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<FileToolReply> {
  const reply = (success: boolean, text: string): FileToolReply => ({
    success,
    contentItems: [{ type: "inputText", text }],
  });
  try {
    signal?.throwIfAborted();
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error();
    const input = args as Record<string, unknown>;
    const fields =
      name === "read_file" || name === "list_files"
        ? ["path"]
        : name === "write_file"
          ? ["path", "content"]
          : name === "edit_file"
            ? ["path", "old", "replacement"]
            : [];
    if (
      !fields.length ||
      fields.some((key) => typeof input[key] !== "string") ||
      Object.keys(input).some((key) => !fields.includes(key))
    )
      throw new Error();
    const root = options.workingDirectory;
    if (!root || typeof input.path !== "string" || input.path.length > 4096)
      throw new Error();
    for (const key of ["content", "old", "replacement"])
      if (
        typeof input[key] === "string" &&
        (Buffer.byteLength(input[key]) > 128 * 1024 ||
          input[key].includes("\u0000"))
      )
        throw new Error();
    const target = path.resolve(root, input.path);
    if (
      path
        .relative(root, target)
        .split(/[\\/]/u)
        .some((part) => part.toLowerCase() === ".git")
    )
      throw new Error();
    const write = options.sandboxMode === "workspace-write";
    const mapped =
      name === "read_file"
        ? "Read"
        : name === "list_files"
          ? "Grep"
          : name === "write_file"
            ? "Write"
            : "Edit";
    if (
      !(await claudeToolPermitted(
        root,
        write,
        mapped,
        name === "list_files"
          ? { path: input.path }
          : { file_path: input.path },
      ))
    )
      throw new Error();
    if (name === "list_files") {
      if (!(await lstat(target)).isDirectory()) throw new Error();
      const entries = await readdir(target, { withFileTypes: true });
      if (entries.length > 256) throw new Error();
      const visible = entries
        .filter(
          (entry) =>
            !entry.isSymbolicLink() && entry.name.toLowerCase() !== ".git",
        )
        .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return reply(true, JSON.stringify(visible));
    }
    let before;
    try {
      before = await lstat(target);
    } catch {
      if (name !== "write_file") throw new Error();
    }
    const flags =
      name === "read_file"
        ? constants.O_RDONLY
        : before
          ? constants.O_RDWR
          : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
    const file = await open(target, flags | (constants.O_NOFOLLOW ?? 0), 0o600);
    let committed = false;
    try {
      const current = await file.stat();
      if (
        !current.isFile() ||
        current.size > 128 * 1024 ||
        (before &&
          (before.ino !== current.ino || before.dev !== current.dev)) ||
        current.nlink !== 1
      )
        throw new Error();
      if (path.relative(root, await realpath(target)).startsWith(".."))
        throw new Error();
      if (name === "read_file") {
        const content = await file.readFile("utf8");
        if (
          content.includes("\u0000") ||
          Buffer.byteLength(content) > 128 * 1024
        )
          throw new Error();
        signal?.throwIfAborted();
        return reply(true, content);
      }
      let content = String(input.content ?? "");
      if (name === "edit_file") {
        const existing = await file.readFile("utf8");
        const old = String(input.old);
        if (
          !old ||
          existing.indexOf(old) < 0 ||
          existing.indexOf(old) !== existing.lastIndexOf(old)
        )
          throw new Error();
        content = existing.replace(old, String(input.replacement));
      }
      if (Buffer.byteLength(content) > 128 * 1024 || content.includes("\u0000"))
        throw new Error();
      signal?.throwIfAborted();
      // Positional write avoids readFile advancing the edit descriptor's cursor.
      const bytes = Buffer.from(content);
      let written = 0;
      while (written < bytes.length) {
        const result = await file.write(
          bytes,
          written,
          bytes.length - written,
          written,
        );
        if (result.bytesWritten <= 0) throw new Error();
        written += result.bytesWritten;
      }
      await file.truncate(Buffer.byteLength(content));
      await file.sync();
      committed = true;
      return reply(true, "File updated within the operation worktree.");
    } finally {
      if (!before && !committed) {
        const ours = await file.stat();
        const current = await lstat(target).catch(() => undefined);
        if (
          current &&
          current.ino === ours.ino &&
          current.dev === ours.dev &&
          !current.isSymbolicLink()
        )
          await unlink(target);
      }
      await file.close();
    }
  } catch {
    return reply(
      false,
      "File request denied: use only bounded files inside the authorized operation worktree.",
    );
  }
}
