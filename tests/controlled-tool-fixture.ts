/** Test-only version/auth/model metadata port; never launches a real CLI. */
import type {
  AIToolCheckInput,
  AIToolStatus,
} from "../apps/desktop/src/shared/ai-connections";
export { toolEnvironment } from "../apps/desktop/src/main/ai/tool-detection";

export async function checkAITool(
  input: AIToolCheckInput,
): Promise<AIToolStatus> {
  return {
    tool: input.tool,
    ...(input.tool === "codex"
      ? { executable: input.executable ?? process.execPath, version: "0.156.0" }
      : {}),
    detected: input.tool === "codex",
    compatible: input.tool === "codex",
    authentication: input.tool === "codex" ? "subscription" : "missing",
    message: "Controlled local metadata fixture; no CLI or model contact.",
  };
}
