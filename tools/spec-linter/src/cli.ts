import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createJevEvaluator } from "./jev.js";
import { lintDocuments } from "./lint.js";
import { resolveDocumentPath } from "./paths.js";
import { renderTextReport } from "./report.js";
import type { LintThresholds } from "./types.js";

type OutputFormat = "text" | "json";

interface CliOptions {
  prdPath: string;
  planPath: string;
  format: OutputFormat;
  thresholds: LintThresholds;
}

const usage = `Usage: npm run lint:prd-plan -- <prd.md> <plan.md> [options]

Options:
  --format text|json          Output format (default: text)
  --covered-threshold <n>    P(covered) threshold (default: 0.8)
  --missing-threshold <n>    P(missing) threshold (default: 0.8)
  --help                     Show this help

Exit codes:
  0  No requirement classified as missing
  1  At least one requirement classified as missing
  2  Usage, file, or TypeSafe evaluation error
`;

function parseProbability(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0.5 || parsed > 1) {
    throw new Error(`${option} must be a number > 0.5 and <= 1`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions | "help" {
  if (argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }

  const positional: string[] = [];
  let format: OutputFormat = "text";
  let covered = 0.8;
  let missing = 0.8;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;

    if (argument === "--format") {
      const value = argv[++index];
      if (value !== "text" && value !== "json") {
        throw new Error("--format must be text or json");
      }
      format = value;
      continue;
    }

    if (argument === "--covered-threshold") {
      const value = argv[++index];
      if (!value) throw new Error("--covered-threshold requires a value");
      covered = parseProbability(value, "--covered-threshold");
      continue;
    }

    if (argument === "--missing-threshold") {
      const value = argv[++index];
      if (!value) throw new Error("--missing-threshold requires a value");
      missing = parseProbability(value, "--missing-threshold");
      continue;
    }

    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    positional.push(argument);
  }

  if (positional.length !== 2) {
    throw new Error("Expected exactly two positional arguments: <prd.md> <plan.md>");
  }

  return {
    prdPath: positional[0]!,
    planPath: positional[1]!,
    format,
    thresholds: { covered, missing },
  };
}

export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed === "help") {
      process.stdout.write(usage);
      return 0;
    }

    const prdPath = resolveDocumentPath(parsed.prdPath);
    const planPath = resolveDocumentPath(parsed.planPath);
    const [prd, plan] = await Promise.all([readFile(prdPath, "utf8"), readFile(planPath, "utf8")]);
    const report = await lintDocuments({
      prd,
      plan,
      evaluator: createJevEvaluator(),
      thresholds: parsed.thresholds,
      prdPath,
      planPath,
    });

    process.stdout.write(
      parsed.format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderTextReport(report),
    );
    return report.hasMissing ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`prd-plan-lint: ${message}\n\n${usage}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
