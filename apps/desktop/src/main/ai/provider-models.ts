import { z } from "zod";
import { aiProviderReasoningEffortSchema } from "../../shared/ai/provider-contracts";
import type { AITool } from "../../shared/ai-connections";

export const detectedModelSchema = z
  .object({
    modelId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/u),
    reasoningEfforts: z.array(aiProviderReasoningEffortSchema).max(16),
  })
  .strict();
export type DetectedModel = z.infer<typeof detectedModelSchema>;
const catalogs = new Map<AITool, DetectedModel[]>();
/** Read metadata only; saved profiles and captured operation snapshots remain immutable. */
export function recordProviderModels(
  tool: AITool,
  values: readonly unknown[],
): DetectedModel[] {
  const models = values.slice(0, 64).flatMap((value) => {
    const parsed = detectedModelSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const unique = [
    ...new Map(models.map((model) => [model.modelId, model])).values(),
  ];
  if (unique.length) catalogs.set(tool, unique);
  return structuredClone(unique);
}
export function detectedProviderModels(
  tool: AITool,
): DetectedModel[] | undefined {
  const values = catalogs.get(tool);
  return values ? structuredClone(values) : undefined;
}
