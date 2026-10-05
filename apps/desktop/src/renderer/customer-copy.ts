/** Explanations from older services remain available in support details. */
export function customerExplanation(
  value: string | undefined,
  fallback: string,
): string {
  const known: Readonly<Record<string, string>> = {
    "The Review Bundle no longer owns the active per-PR hold.":
      "This saved review is no longer the active work for this pull request.",
    "The bundle is committed and waiting for the explicit next action shown below.":
      "This saved review is waiting for the next action shown below.",
    "The original Review Bundle and its immutable evidence remain available.":
      "The original review and its saved evidence remain available.",
    "No worktree or publication mutation is implied by this state.":
      "Opening this saved work does not change code or publish it.",
  };
  if (value !== undefined && Object.hasOwn(known, value)) return known[value]!;
  if (
    value === undefined ||
    value.trim() === "" ||
    /\bF\d{2}\b|\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|authoritative|main.process|projection|delegated effect|deterministic/iu.test(
      value,
    )
  )
    return fallback;
  return value;
}
