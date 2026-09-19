import type {
  ApplicationCoverageAnswer,
  ApplicationCoverageStatus,
  ApplicationCoverageThresholds,
  LintThresholds,
  RequirementStatus,
} from "./types.js";

/**
 * Conservative defaults. Tune these against representative PRDs and plans for
 * the project's risk tolerance; the raw probabilities remain in every report.
 */
export const DEFAULT_THRESHOLDS: Readonly<LintThresholds> = Object.freeze({
  covered: 0.8,
  missing: 0.8,
});

export function validateThresholds(thresholds: LintThresholds): LintThresholds {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value <= 0.5 || value > 1) {
      throw new Error(`${name} threshold must be > 0.5 and <= 1; received ${value}`);
    }
  }

  return thresholds;
}

export function classifyProbability(
  probabilityCovered: number,
  thresholds: LintThresholds = DEFAULT_THRESHOLDS,
): RequirementStatus {
  validateThresholds(thresholds);

  if (!Number.isFinite(probabilityCovered) || probabilityCovered < 0 || probabilityCovered > 1) {
    throw new Error(`Jev probability must be between 0 and 1; received ${probabilityCovered}`);
  }

  const probabilityMissing = 1 - probabilityCovered;
  if (probabilityCovered >= thresholds.covered) {
    return "covered";
  }

  if (probabilityMissing >= thresholds.missing) {
    return "missing";
  }

  return "needs-review";
}

export const DEFAULT_APPLICATION_COVERAGE_THRESHOLDS: Readonly<ApplicationCoverageThresholds> =
  Object.freeze({
    decision: 0.8,
    reviewConfidence: 0.75,
  });

export function validateApplicationCoverageThresholds(
  thresholds: ApplicationCoverageThresholds,
): ApplicationCoverageThresholds {
  if (!Number.isFinite(thresholds.decision) || thresholds.decision <= 0.5 || thresholds.decision > 1) {
    throw new Error(`decision threshold must be > 0.5 and <= 1; received ${thresholds.decision}`);
  }
  if (
    !Number.isFinite(thresholds.reviewConfidence) ||
    thresholds.reviewConfidence < 0 ||
    thresholds.reviewConfidence > 1
  ) {
    throw new Error(
      `review confidence threshold must be between 0 and 1; received ${thresholds.reviewConfidence}`,
    );
  }

  return thresholds;
}

export function classifyApplicationCoverage(
  answer: ApplicationCoverageAnswer,
  thresholds: ApplicationCoverageThresholds = DEFAULT_APPLICATION_COVERAGE_THRESHOLDS,
): ApplicationCoverageStatus {
  validateApplicationCoverageThresholds(thresholds);

  for (const probability of Object.values(answer.probabilities)) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error(`Jev choice probability must be between 0 and 1; received ${probability}`);
    }
  }
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    throw new Error(`Jev confidence must be between 0 and 1; received ${answer.confidence}`);
  }

  if (answer.confidence < thresholds.reviewConfidence) {
    return "needs-review";
  }
  if (answer.probabilities.covered >= thresholds.decision) {
    return "covered";
  }
  if (answer.probabilities.missing >= thresholds.decision) {
    return "missing";
  }
  if (answer.probabilities.not_applicable >= thresholds.decision) {
    return "not-applicable";
  }

  return "needs-review";
}
