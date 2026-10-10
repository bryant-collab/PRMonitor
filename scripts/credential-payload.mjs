// Source code can contain an export-map getter for an environment schema.
// A simple () => identifier property is a function, not a serialized credential.
// Keep assignment checks and literal checks, including tokens under other names.
export function hasCredentialPayload(text) {
  const declarations =
    /(?:TYPESAFE_API_KEY|GITHUB_TOKEN|OPENAI_API_KEY|PRMONITOR_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))["']?\s*[:=]/giu;
  for (const match of text.matchAll(declarations)) {
    const suffix = text.slice(match.index + match[0].length);
    const exportGetter =
      match[0].endsWith(":") &&
      /^\s*\(\)\s*=>\s*[A-Za-z_$][A-Za-z0-9_$]*\s*(?=[,}])/u.test(suffix);
    if (!exportGetter) return true;
  }
  return /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:ant-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,}))\b/u.test(
    text,
  );
}
