/** Explanations from older services remain available in support details. */
export function customerExplanation(
  value: string | undefined,
  fallback: string,
): string {
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
