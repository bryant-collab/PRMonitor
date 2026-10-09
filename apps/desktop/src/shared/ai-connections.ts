import { aiProviderReasoningEffortSchema } from "./ai/reasoning";
import { f29HasControlCharacter } from "./f29-security";
import { z } from "zod";

export const aiToolSchema = z.enum(["codex", "claude", "copilot"]);
export type AITool = z.infer<typeof aiToolSchema>;
export const AI_TOOL_NAMES: Record<AITool, string> = {
  codex: "Codex",
  claude: "Claude Code",
  copilot: "GitHub Copilot",
};
export const AI_TOOL_EXTRA_OPTIONS: Record<AITool, readonly string[]> = {
  codex: ["--no-daemon"],
  claude: ["--no-chrome"],
  copilot: ["--no-color"],
};

// Only nonsecret launch choices belong in settings or operation snapshots.
// Credentials stay in provider-managed storage and never enter these settings.
export const aiConnectionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u),
    name: z.string().trim().min(1).max(80),
    tool: aiToolSchema,
    executable: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !f29HasControlCharacter(value)),
    extraArgs: z.array(z.string().min(1).max(256)).max(16),
    authMode: z.enum(["subscription", "api"]),
    signInSource: z.enum(["existing", "prmonitor"]).optional(),
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // No arbitrary configuration, directory, approval, shell, plugin or environment
    // overrides. Extend this table only with a documented compatibility contract.
    const allowed = AI_TOOL_EXTRA_OPTIONS[value.tool];
    if (
      new Set(value.extraArgs).size !== value.extraArgs.length ||
      value.extraArgs.some((arg) => !allowed.includes(arg))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extraArgs"],
        message:
          "This option is not supported. Workspace and safety options are set by PRMonitor.",
      });
    }
    if (value.tool !== "codex" && value.signInSource === "prmonitor") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signInSource"],
        message: "Use this tool's existing sign-in.",
      });
    }
    if (value.tool !== "codex" && value.authMode !== "subscription") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authMode"],
        message: "Use this tool's existing sign-in.",
      });
    }
  });
export type AIConnection = z.infer<typeof aiConnectionSchema>;

export const aiConnectionSaveSchema = z
  .object({
    expectedSettingsRevision: z.number().int().nonnegative(),
    connection: aiConnectionSchema,
    useForAllTasks: z.boolean(),
    modelId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/u),
  })
  .strict();
export type AIConnectionSave = z.infer<typeof aiConnectionSaveSchema>;

export const aiToolCheckInputSchema = z
  .object({
    connectionId: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u)
      .optional(),
    tool: aiToolSchema,
    executable: z.string().max(4096).optional(),
    extraArgs: z.array(z.string().max(256)).max(16).default([]),
    authMode: z.enum(["subscription", "api"]).default("subscription"),
    detectOnly: z.boolean().optional(),
  })
  .strict();
export type AIToolCheckInput = z.infer<typeof aiToolCheckInputSchema>;
export const aiConnectionSignInSchema = z
  .object({
    connectionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u),
    expectedSettingsRevision: z.number().int().nonnegative(),
  })
  .strict();
export type AIConnectionSignIn = z.infer<typeof aiConnectionSignInSchema>;

export const aiToolStatusSchema = z
  .object({
    tool: aiToolSchema,
    executable: z.string().max(4096).optional(),
    detected: z.boolean(),
    version: z.string().max(80).optional(),
    models: z
      .array(
        z
          .object({
            modelId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/u),
            reasoningEfforts: z.array(aiProviderReasoningEffortSchema).max(16),
          })
          .strict(),
      )
      .max(64)
      .optional(),
    compatible: z.boolean(),
    authentication: z.enum(["subscription", "api", "missing", "unknown"]),
    workReadiness: z.enum(["blocked", "not_checked"]).optional(),
    message: z.string().max(512),
  })
  .strict();
export type AIToolStatus = z.infer<typeof aiToolStatusSchema>;
export const aiToolsViewSchema = z
  .object({
    tools: z.array(aiToolStatusSchema).max(3),
  })
  .strict();
export type AIToolsView = z.infer<typeof aiToolsViewSchema>;
