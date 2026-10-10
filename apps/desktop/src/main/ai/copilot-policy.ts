import path from "node:path";
import type { SessionConfig } from "@prmonitor/provider-runtimes";
import type { CodexThreadOptions } from "./codex-adapter";
import { claudeToolPermitted } from "./claude-policy";
import { copilotBareModel } from "./copilot-wire";

export function copilotTools(write: boolean): string[] {
  return [
    "builtin:view",
    "builtin:glob",
    "builtin:grep",
    ...(write ? ["builtin:edit", "builtin:create"] : []),
  ];
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export async function copilotToolPermitted(
  root: string,
  write: boolean,
  name: string,
  value: unknown,
): Promise<boolean> {
  // The SDK swallows thrown PreToolUse errors. Always produce a deny on uncertainty.
  try {
    const bare = name.startsWith("builtin:") ? name.slice(8) : name;
    if (!copilotTools(write).includes(`builtin:${bare}`)) return false;
    const input = object(value);
    const mapped = (
      {
        view: "Read",
        edit: "Edit",
        create: "Write",
        glob: "Glob",
        grep: "Grep",
      } as Record<string, string>
    )[bare];
    if (
      !mapped ||
      "file_path" in input ||
      (input.path !== undefined && typeof input.path !== "string")
    )
      return false;
    const fields: Record<string, string[]> = {
      view: ["path", "view_range"],
      edit: ["path", "old_str", "new_str"],
      create: ["path", "file_text"],
      glob: ["path", "pattern"],
      grep: [
        "path",
        "pattern",
        "glob",
        "type",
        "output_mode",
        "head_limit",
        "multiline",
        "ignore_case",
      ],
    };
    if (Object.keys(input).some((key) => !fields[bare]?.includes(key)))
      return false;
    const normalized =
      bare === "view"
        ? { file_path: input.path }
        : bare === "edit"
          ? {
              file_path: input.path,
              old_string: input.old_str,
              new_string: input.new_str,
            }
          : bare === "create"
            ? { file_path: input.path, content: input.file_text }
            : bare === "glob"
              ? { path: input.path, pattern: input.pattern }
              : {
                  path: input.path,
                  pattern: input.pattern,
                  ...(input.glob === undefined ? {} : { glob: input.glob }),
                };
    return await claudeToolPermitted(root, write, mapped, normalized);
  } catch {
    return false;
  }
}
export function copilotSessionOptions(
  options: CodexThreadOptions,
): SessionConfig {
  if (
    !options.workingDirectory ||
    !path.isAbsolute(options.workingDirectory) ||
    !copilotBareModel(options.model)
  )
    throw new Error(
      "Copilot needs a supported service model and canonical operation worktree.",
    );
  const root = options.workingDirectory;
  const write = options.sandboxMode === "workspace-write";
  return {
    clientName: "PRMonitor",
    workingDirectory: root,
    model: options.model,
    ...(options.modelReasoningEffort
      ? {
          reasoningEffort:
            options.modelReasoningEffort as SessionConfig["reasoningEffort"],
        }
      : {}),
    availableTools: copilotTools(write),
    excludedTools: ["mcp:*", "custom:*"],
    tools: [],
    providers: [],
    models: [],
    mcpServers: {},
    customAgents: [],
    customAgentsLocalOnly: true,
    enableConfigDiscovery: false,
    enableFileHooks: false,
    enableSkills: false,
    enableOnDemandInstructionDiscovery: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    enableExperimentalMode: false,
    skipCustomInstructions: true,
    remoteSession: "off",
    memory: { enabled: false },
    manageScheduleEnabled: false,
    skillDirectories: [],
    instructionDirectories: [],
    additionalDirectories: [],
    managedSettings: {
      permissions: { disableBypassPermissionsMode: "disable" },
    },
    onPermissionRequest: () => ({
      kind: "denied-no-approval-rule-and-could-not-request-from-user",
    }),
    hooks: {
      onPreToolUse: async (input) =>
        (await copilotToolPermitted(
          root,
          write,
          input.toolName,
          input.toolArgs,
        ))
          ? {}
          : {
              permissionDecision: "deny",
              permissionDecisionReason:
                "This task permits only scoped file tools in its operation worktree.",
            },
    },
  };
}
