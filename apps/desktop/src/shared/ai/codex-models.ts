// Public fallback choices from openai/codex rust-v0.156.0 models-manager/models.json.
// Actual account model/list support is verified before every named-connection turn.
export const DEFAULT_CODEX_CONNECTION_MODEL = "gpt-6-astra";
export const CODEX_MODEL_CHOICES = [
  {
    modelId: "gpt-6-astra",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    modelId: "gpt-5.6-sol",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    modelId: "gpt-5.6-terra",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    modelId: "gpt-5.6-luna",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    modelId: "gpt-5.5",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
] as const;
