import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createApplicationCoverageEvaluator } from "./application-jev.js";
import { lintApplicationCoverage } from "./application-lint.js";
import { renderApplicationCoverageReport } from "./application-report.js";
import type { ApplicationCoverageThresholds } from "./types.js";

type OutputFormat = "text" | "json";

interface CliOptions {
  overviewPath: string;
  prdPath: string;
  format: OutputFormat;
  thresholds: ApplicationCoverageThresholds;
}

const usage = `Usage: npm run lint:application-coverage -- <application_overview.md> <feature_PRD.md> [options]

Options:
  --format text|json          Output format (default: text)
  --decision-threshold <n>   Probability threshold for a definite result (default: 0.8)
  --review-confidence <n>    Minimum Jev confidence for a definite result (default: 0.75)
  --help                     Show this help

Exit codes:
  0  No requirement classified as missing
  1  At least one applicable requirement classified as missing
  2  Usage, file, mapping, or TypeSafe evaluation error
`;

function parseNumber(value: string, option: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > 1) {
    throw new Error(`${option} must be between ${minimum} and 1`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions | "help" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";

  const positional: string[] = [];
  let format: OutputFormat = "text";
  let decision = 0.8;
  let reviewConfidence = 0.75;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;

    if (argument === "--format") {
      const value = argv[++index];
      if (value !== "text" && value !== "json") throw new Error("--format must be text or json");
      format = value;
      continue;
    }
    if (argument === "--decision-threshold") {
      const value = argv[++index];
      if (!value) throw new Error("--decision-threshold requires a value");
      decision = parseNumber(value, "--decision-threshold", 0.5);
      continue;
    }
    if (argument === "--review-confidence") {
      const value = argv[++index];
      if (!value) throw new Error("--review-confidence requires a value");
      reviewConfidence = parseNumber(value, "--review-confidence", 0);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    positional.push(argument);
  }

  if (positional.length !== 2) {
    throw new Error("Expected exactly two positional arguments: <application_overview.md> <feature_PRD.md>");
  }

  return {
    overviewPath: positional[0]!,
    prdPath: positional[1]!,
    format,
    thresholds: { decision, reviewConfidence },
  };
}

export async function runApplicationCoverageCli(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed === "help") {
      process.stdout.write(usage);
      return 0;
    }

    const [overview, prd] = await Promise.all([
      readFile(parsed.overviewPath, "utf8"),
      readFile(parsed.prdPath, "utf8"),
    ]);
    const report = await lintApplicationCoverage({
      overview,
      prd,
      evaluator: createApplicationCoverageEvaluator(),
      thresholds: parsed.thresholds,
      overviewPath: parsed.overviewPath,
      prdPath: parsed.prdPath,
    });

    process.stdout.write(
      parsed.format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderApplicationCoverageReport(report),
    );
    return report.hasMissing ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`application-coverage-lint: ${message}\n\n${usage}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runApplicationCoverageCli(process.argv.slice(2));
}
