import { f29HasControlCharacter } from "../../shared/f29-security";
import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  aiConnectionSchema,
  type AIConnection,
  type AITool,
  type AIToolCheckInput,
  type AIToolStatus,
} from "../../shared/ai-connections";

export interface ToolCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export type ToolCommand = (
  executable: string,
  args: readonly string[],
  env: Record<string, string>,
  signal?: AbortSignal,
) => Promise<ToolCommandResult>;
export const runToolCommand: ToolCommand = (executable, args, env, signal) =>
  new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      {
        shell: false,
        windowsHide: true,
        env,
        ...(env.CODEX_HOME ? { cwd: env.CODEX_HOME } : {}),
        timeout: 5000,
        maxBuffer: 16384,
        encoding: "utf8",
        signal,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : null,
          stdout,
          stderr,
        });
      },
    );
  });

export function toolEnvironment(
  tool: AITool,
  mode: AIConnection["authMode"],
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  // Deliberate sign-in-store access; never inherit GitHub publication tokens,
  // provider routing, API credentials or arbitrary app environment variables.
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (source[key] !== undefined) env[key] = source[key];
  const apiKeyName = "OPENAI_API_KEY";
  if (tool === "codex" && mode === "api" && source[apiKeyName])
    env[apiKeyName] = source[apiKeyName];
  return env;
}

export async function resolveToolExecutable(
  tool: AITool,
  selected?: string,
  source: NodeJS.ProcessEnv = process.env,
  runtime: {
    readonly platform: NodeJS.Platform;
    readonly arch: string;
  } = process,
): Promise<string | undefined> {
  const windows = runtime.platform === "win32";
  const paths = windows ? path.win32 : path;
  const directories = (source.PATH ?? source.Path ?? "")
    .split(paths.delimiter)
    .filter(Boolean);
  const home = source.USERPROFILE ?? source.HOME;
  if (home) directories.push(paths.join(home, ".local", "bin"));
  const candidates = selected
    ? [selected]
    : directories.map((directory) =>
        paths.join(directory, tool + (windows ? ".exe" : "")),
      );
  for (const candidate of candidates) {
    if (!paths.isAbsolute(candidate) || f29HasControlCharacter(candidate))
      continue;
    // npm's Windows Codex shim is not executed through a shell. Resolve its
    // installed native payload directly using the pinned package layout.
    const nativeCandidates = nativeExecutableCandidates(
      tool,
      candidate,
      runtime,
    );
    for (const native of nativeCandidates)
      try {
        if (windows && !native.toLowerCase().endsWith(".exe")) continue;
        await access(native, windows ? 0 : 1);
        if ((await stat(native)).isFile()) return await realpath(native);
      } catch {
        /* Try the next installed location. */
      }
  }
  return undefined;
}

export function nativeExecutableCandidates(
  tool: AITool,
  selected: string,
  runtime: {
    readonly platform: NodeJS.Platform;
    readonly arch: string;
  } = process,
): readonly string[] {
  if (runtime.platform !== "win32" || tool !== "codex") return [selected];
  const paths = path.win32;
  const directory = paths.dirname(selected);
  // A global npm shim lives at the prefix; local npm shims live in .bin.
  const modules =
    paths.basename(directory).toLowerCase() === ".bin"
      ? paths.dirname(directory)
      : paths.join(directory, "node_modules");
  const base = paths.join(modules, "@openai");
  const architecture = runtime.arch === "arm64" ? "arm64" : "x64";
  const triple =
    architecture === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc";
  const packageName = `codex-win32-${architecture}`;
  const packages = [
    paths.join(base, "codex"),
    paths.join(base, packageName),
    paths.join(base, "codex", "node_modules", "@openai", packageName),
  ];
  return [
    selected,
    ...packages.flatMap((directory) =>
      ["bin", "codex"].map((layout) =>
        paths.join(directory, "vendor", triple, layout, "codex.exe"),
      ),
    ),
  ];
}

export async function checkAITool(
  input: AIToolCheckInput,
  run: ToolCommand = runToolCommand,
  source: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
  ownedHome?: string,
): Promise<AIToolStatus> {
  signal?.throwIfAborted();
  const executable = await resolveToolExecutable(
    input.tool,
    input.executable,
    source,
  );
  if (!executable)
    return {
      tool: input.tool,
      detected: false,
      compatible: false,
      authentication: "unknown",
      message: "Program not found. Choose Browse for program.",
    };
  const base = { tool: input.tool, executable, detected: true };
  const parsed = aiConnectionSchema.safeParse({
    id: "check",
    name: "Check",
    tool: input.tool,
    executable,
    extraArgs: input.extraArgs,
    authMode: input.authMode,
    revision: 1,
  });
  if (!parsed.success)
    return {
      ...base,
      compatible: false,
      authentication: "unknown",
      message:
        "Remove unsupported extra options. PRMonitor sets workspace and safety options.",
    };
  const env = {
    ...toolEnvironment(input.tool, input.authMode, source),
    ...(ownedHome ? { CODEX_HOME: ownedHome } : {}),
  };
  const command: ToolCommand = async (program, args, environment) => {
    signal?.throwIfAborted();
    const result = signal
      ? await run(program, args, environment, signal)
      : await run(program, args, environment);
    signal?.throwIfAborted();
    return result;
  };
  const versionResult = await command(executable, ["--version"], env);
  const version = versionResult.stdout.match(
    /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/u,
  )?.[0];
  if (versionResult.exitCode !== 0 || !version)
    return {
      ...base,
      compatible: false,
      authentication: "unknown",
      message: "The program could not report its version.",
    };
  if (input.tool !== "codex")
    return {
      ...base,
      version,
      compatible: false,
      authentication: "unknown",
      message:
        input.tool === "claude"
          ? "Claude Code is detected. Work is blocked because managed hooks cannot be verified before a session starts."
          : "GitHub Copilot is detected. Work is blocked until existing native sandbox enforcement and effective permissions can be verified.",
    };
  const help = await command(executable, ["app-server", "--help"], env);
  const globalHelp = input.extraArgs.length
    ? await command(executable, ["--help"], env)
    : undefined;
  const compatible =
    help.exitCode === 0 &&
    help.stdout.includes("--strict-config") &&
    (() => {
      const numbers = version.split(".").map(Number);
      return (numbers[0] ?? 0) > 0 || (numbers[1] ?? 0) >= 156;
    })() &&
    (!input.extraArgs.includes("--no-daemon") ||
      globalHelp?.stdout.includes("--no-daemon") === true);
  if (!ownedHome)
    return {
      ...base,
      version,
      compatible,
      authentication:
        input.authMode === "api" && source.OPENAI_API_KEY ? "api" : "missing",
      message: !compatible
        ? "This version does not support the required options. Choose a compatible program or remove extra options."
        : "Sign in with the selected method in Codex, then check the saved connection.",
    };
  const auth = await command(executable, ["login", "status"], env);
  const authText = auth.stdout + auth.stderr;
  const authentication =
    auth.exitCode !== 0
      ? "missing"
      : /chatgpt/iu.test(authText)
        ? "subscription"
        : /api\s*key/iu.test(authText)
          ? "api"
          : "unknown";
  const selectedAuth =
    input.authMode === "api" && source.OPENAI_API_KEY ? "api" : authentication;
  return {
    ...base,
    version,
    compatible,
    authentication: selectedAuth,
    workReadiness: process.platform === "win32" ? "blocked" : "not_checked",
    message: !compatible
      ? "This version does not support the required options. Choose a compatible program or remove extra options."
      : selectedAuth !== input.authMode
        ? "Sign in with the selected method in this program, then check again. PRMonitor will not switch billing methods."
        : process.platform === "win32"
          ? "Program and sign-in are configured. Work is blocked until native Windows sandbox enforcement can be verified without changing security settings."
          : "Program and sign-in are configured. Work permissions are verified before each task.",
  };
}
