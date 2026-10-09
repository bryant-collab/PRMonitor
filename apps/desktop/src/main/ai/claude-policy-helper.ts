import { resolveSettings } from "@prmonitor/provider-runtimes";
import { projectClaudePolicy } from "./claude-policy";

// A fresh process isolates the SDK's process-global settings/environment caches.
// Never print provider settings, raw diagnostics, environment values or credentials.
async function main(): Promise<void> {
  if (process.argv[2] !== "--prmonitor-policy-metadata")
    throw new Error("unsupported");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of process.stdin) {
    const chunk = Buffer.from(raw as Buffer);
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("bounded");
    chunks.push(chunk);
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    typeof input !== "object" ||
    input === null ||
    !("cwd" in input) ||
    typeof input.cwd !== "string"
  )
    throw new Error("invalid");
  const result = await resolveSettings({ cwd: input.cwd, settingSources: [] });
  process.stdout.write(JSON.stringify(projectClaudePolicy(result)));
}
void main().catch(() => {
  process.stdout.write(JSON.stringify({ supported: false, reason: "unknown" }));
  process.exitCode = 1;
});
