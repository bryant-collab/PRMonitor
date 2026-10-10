import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const lockfile = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);

const expectedBoundaries = [
  "renderer_ipc",
  "route_url",
  "filesystem_worktree",
  "git",
  "validation_process",
  "database",
  "credential",
  "provider_policy",
  "diagnostics_recovery",
  "dependency_runtime",
];
const dependencySeverities = ["critical", "high", "moderate", "low", "info"];
const defaultQualityGateThreshold = "high";
const configuredQualityGateThreshold = (
  process.env.F29_QUALITY_GATE_THRESHOLD ?? defaultQualityGateThreshold
).toLowerCase();
const qualityGateThresholdIndex = dependencySeverities.indexOf(
  configuredQualityGateThreshold,
);
const qualityGateThresholdValid = qualityGateThresholdIndex >= 0;
const effectiveQualityPolicy = qualityGateThresholdValid
  ? dependencySeverities.slice(0, qualityGateThresholdIndex + 1).join(",")
  : "invalid";
const nonDefaultQualityPolicy =
  configuredQualityGateThreshold !== defaultQualityGateThreshold;
const qualityPolicyVersion =
  process.env.F29_QUALITY_GATE_POLICY_VERSION ?? "F29-default-v1";
const qualityPolicyOwner = process.env.F29_QUALITY_GATE_OWNER ?? "F29";
const riskAcceptanceUntil = process.env.F29_QUALITY_GATE_RISK_ACCEPTANCE_UNTIL;
const boundedPolicyField = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
const riskAcceptanceDateValid =
  typeof riskAcceptanceUntil === "string" &&
  /^\d{4}-\d{2}-\d{2}$/u.test(riskAcceptanceUntil) &&
  Number.isFinite(Date.parse(`${riskAcceptanceUntil}T23:59:59.999Z`)) &&
  Date.parse(`${riskAcceptanceUntil}T23:59:59.999Z`) >= Date.now();
const qualityGateConfigurationValid =
  qualityGateThresholdValid &&
  (!nonDefaultQualityPolicy ||
    (boundedPolicyField(qualityPolicyVersion) &&
      boundedPolicyField(qualityPolicyOwner) &&
      riskAcceptanceDateValid));

async function sourceFiles(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (["node_modules", "out", "dist", ".git"].includes(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(candidate)));
    else if (/\.(?:ts|tsx|mjs|js|json)$/u.test(entry.name))
      result.push(candidate);
  }
  return result;
}

const files = [
  ...(await sourceFiles(path.join(root, "apps"))),
  ...(await sourceFiles(path.join(root, "packages"))),
];
const contents = new Map();
for (const file of files) contents.set(file, await readFile(file, "utf8"));

const providerImports = [...contents.entries()]
  .filter(([, content]) =>
    /(?:from\s+["']@openai\/codex-sdk["']|require\(["']@openai\/codex-sdk["']\))/u.test(
      content,
    ),
  )
  .map(([file]) => path.relative(root, file).replaceAll("\\", "/"));
const rendererOrSharedLeaks = [...contents.entries()]
  .filter(([file, content]) => {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const rendererSafe =
      relative.startsWith("apps/desktop/src/renderer/") ||
      relative.startsWith("apps/desktop/src/shared/");
    return (
      rendererSafe &&
      /from\s+["'](?:electron|node:(?:child_process|fs|process|module)|@openai\/codex-sdk|@prmonitor\/provider-runtimes(?:\/native)?|@anthropic-ai\/(?:claude-agent-sdk|sdk)|@github\/copilot-sdk)["']/u.test(
        content,
      )
    );
  })
  .map(([file]) => path.relative(root, file).replaceAll("\\", "/"));
const additionalSdkImports = [...contents.entries()]
  .filter(([, content]) =>
    /(?:from\s+["'](?:@anthropic-ai\/(?:claude-agent-sdk|sdk)|@github\/copilot-sdk)["']|require\(["'](?:@anthropic-ai\/(?:claude-agent-sdk|sdk)|@github\/copilot-sdk)["']\))/u.test(
      content,
    ),
  )
  .map(([file]) => path.relative(root, file).replaceAll("\\", "/"));
const hostRuntimeImports = [...contents.entries()]
  .filter(([, content]) =>
    /(?:from\s+|import\s*\()["']@prmonitor\/provider-runtimes(?:\/native)?["']/u.test(
      content,
    ),
  )
  .map(([file]) => path.relative(root, file).replaceAll("\\", "/"));
const allowedHostRuntimes = new Set(
  [
    "claude-adapter.ts",
    "claude-policy-helper.ts",
    "claude-process.ts",
    "copilot-adapter.ts",
    "copilot-runtime.ts",
    "copilot-policy.ts",
    "copilot-supervisor.ts",
    "copilot-worker.ts",
    "windows-job.ts",
  ].map((name) => `apps/desktop/src/main/ai/${name}`),
);
const dynamicLoading = [...contents.entries()]
  .filter(([, content]) =>
    /(?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add|fetch\s*\([^)]*https?:|import\s*\([^)]*repository|require\s*\([^)]*repository)/iu.test(
      content,
    ),
  )
  .map(([file]) => path.relative(root, file).replaceAll("\\", "/"));

const lockPackages = Object.entries(lockfile.packages ?? {})
  .filter(([key, value]) => key.includes("node_modules/") && value?.version)
  .map(([key, value]) => ({
    name: key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length),
    version: value.version,
    production: value.dev !== true && value.optional !== true,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));
const productionPackages = lockPackages.filter((item) => item.production);
const codexPackage = lockfile.packages?.["node_modules/@openai/codex-sdk"];
const supportedNode = packageJson.engines?.node;
const supportedNpm = packageJson.engines?.npm;
const runtimeMatches =
  process.versions.node === supportedNode &&
  process.env.npm_config_user_agent?.includes(`npm/${supportedNpm}`) !== false;

const checks = {
  lockfilePresent: lockfile.lockfileVersion !== undefined,
  runtimeIdentityRecorded: Boolean(supportedNode && supportedNpm),
  providerImportIsolation:
    providerImports.length === 1 &&
    providerImports[0] === "apps/desktop/src/main/ai/codex-adapter.ts",
  additionalProviderImportIsolation:
    additionalSdkImports.length === 2 &&
    additionalSdkImports.every((file) =>
      [
        "packages/provider-runtimes/index.mjs",
        "packages/provider-runtimes/index.d.ts",
      ].includes(file),
    ) &&
    hostRuntimeImports.every(
      (file) =>
        allowedHostRuntimes.has(file) || file.startsWith("apps/desktop/tests/"),
    ),
  rendererSharedImportIsolation: rendererOrSharedLeaks.length === 0,
  noDynamicInstallOrLoad: dynamicLoading.length === 0,
  threatModelBoundaryCount: expectedBoundaries.length === 10,
  qualityGateConfiguration: qualityGateConfigurationValid,
  defaultQualityGate: effectiveQualityPolicy === "critical,high",
};

const report = {
  schemaVersion: 1,
  kind: "f29-security-gate",
  runtime: {
    node: process.versions.node,
    npm:
      process.env.npm_config_user_agent?.match(/npm\/([^ ]+)/u)?.[1] ??
      "unknown",
    supportedNode,
    supportedNpm,
    matchesSupportedRuntime: runtimeMatches,
  },
  lockfile: {
    lockfileVersion: lockfile.lockfileVersion,
    productionPackageCount: productionPackages.length,
    codexSdk: codexPackage?.version ?? "missing",
  },
  qualityGate: {
    effectivePolicy: effectiveQualityPolicy,
    defaultPolicy: "critical,high",
    threshold: configuredQualityGateThreshold,
    nonDefaultPolicy: nonDefaultQualityPolicy,
    policyVersion: qualityPolicyVersion,
    owner: qualityPolicyOwner,
    riskAcceptanceUntil: riskAcceptanceUntil ?? null,
    riskAcceptanceRequired: nonDefaultQualityPolicy,
    riskAcceptanceValid: !nonDefaultQualityPolicy || riskAcceptanceDateValid,
  },
  providerImports,
  additionalSdkImports,
  hostRuntimeImports,
  rendererOrSharedLeaks,
  dynamicLoading,
  boundaries: expectedBoundaries,
  checks,
  commands: [
    "npm ci",
    "npm run check",
    `npm audit --omit=dev --audit-level=${configuredQualityGateThreshold}`,
    "npm run lint:prd-plan -- Specs/security_and_trust_boundary_hardening_PRD.md Specs/security_and_trust_boundary_hardening_PLAN.md",
    "npm run lint:application-coverage -- Specs/application_overview.md Specs/security_and_trust_boundary_hardening_PRD.md",
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (
  !checks.lockfilePresent ||
  !checks.runtimeIdentityRecorded ||
  !checks.providerImportIsolation ||
  !checks.additionalProviderImportIsolation ||
  !checks.rendererSharedImportIsolation ||
  !checks.noDynamicInstallOrLoad ||
  !checks.qualityGateConfiguration
) {
  process.exitCode = 1;
}
