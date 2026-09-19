import { extractApplicationMappings, extractApplicationRequirements } from "./application-extract.js";
import {
  classifyApplicationCoverage,
  DEFAULT_APPLICATION_COVERAGE_THRESHOLDS,
  validateApplicationCoverageThresholds,
} from "./thresholds.js";
import { extractRequirements } from "./extract.js";
import type {
  ApplicationCoverageEvaluator,
  ApplicationCoverageReport,
  ApplicationCoverageThresholds,
} from "./types.js";

export interface LintApplicationCoverageOptions {
  overview: string;
  prd: string;
  evaluator: ApplicationCoverageEvaluator;
  thresholds?: ApplicationCoverageThresholds;
  overviewPath?: string;
  prdPath?: string;
}

export async function lintApplicationCoverage(
  options: LintApplicationCoverageOptions,
): Promise<ApplicationCoverageReport> {
  const thresholds = validateApplicationCoverageThresholds(
    options.thresholds ?? { ...DEFAULT_APPLICATION_COVERAGE_THRESHOLDS },
  );
  const applicationRequirements = extractApplicationRequirements(options.overview);
  if (applicationRequirements.length === 0) {
    throw new Error(
      "No APP-AC-* requirements were found in the application overview. Add stable IDs before linting.",
    );
  }

  const mappings = extractApplicationMappings(options.prd);
  const knownIds = new Set(applicationRequirements.map(({ id }) => id));
  const invalidMappings = mappings.flatMap((mapping) =>
    mapping.applicationIds
      .filter((id) => !knownIds.has(id))
      .map((id) => `${id} (PRD line ${mapping.line})`),
  );
  if (invalidMappings.length > 0) {
    throw new Error(`PRD references unknown application requirement IDs: ${invalidMappings.join(", ")}`);
  }

  const evaluation = await options.evaluator.evaluate({
    prd: options.prd,
    applicationRequirements,
    mappings,
    prdRequirements: extractRequirements(options.prd),
  });

  const judgments = applicationRequirements.map((requirement) => {
    const answer = evaluation.answers[requirement.id];
    if (!answer) throw new Error(`Jev did not return an answer for ${requirement.id}`);

    const mappingLines = mappings
      .filter((mapping) => mapping.applicationIds.includes(requirement.id))
      .map(({ line }) => line);
    return {
      id: requirement.id,
      requirement: requirement.text,
      line: requirement.line,
      status: classifyApplicationCoverage(answer, thresholds),
      modelChoice: answer.choice,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
      mappingLines,
    };
  });

  const summary = judgments.reduce(
    (counts, judgment) => {
      if (judgment.status === "covered") counts.covered += 1;
      if (judgment.status === "missing") counts.missing += 1;
      if (judgment.status === "not-applicable") counts.notApplicable += 1;
      if (judgment.status === "needs-review") counts.needsReview += 1;
      return counts;
    },
    { covered: 0, missing: 0, notApplicable: 0, needsReview: 0 },
  );

  return {
    overviewPath: options.overviewPath,
    prdPath: options.prdPath,
    thresholds,
    model: evaluation.model,
    usage: evaluation.usage,
    judgments,
    summary,
    hasMissing: summary.missing > 0,
  };
}
