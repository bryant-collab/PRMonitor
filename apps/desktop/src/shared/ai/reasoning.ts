import { z } from "zod";

export const aiProviderReasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "persistent",
]);
export type AIProviderReasoningEffort = z.infer<
  typeof aiProviderReasoningEffortSchema
>;
