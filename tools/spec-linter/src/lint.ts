import { extractRequirements } from "./extract.js";
import { classifyProbability, DEFAULT_THRESHOLDS, validateThresholds } from "./thresholds.js";
import type {
  JevEvaluator,
  LintReport,
  LintThresholds,
  RequirementJudgment,
} from "./types.js";

export interface LintDocumentsOptions {
  prd: string;
  plan: string;
  evaluator: JevEvaluator;
  thresholds?: LintThresholds;
  prdPath?: string;
  planPath?: string;
}

export async function lintDocuments(options: LintDocumentsOptions): Promise<LintReport> {
  const thresholds = validateThresholds(options.thresholds ?? { ...DEFAULT_THRESHOLDS });
  const requirements = extractRequirements(options.prd);

  if (requirements.length === 0) {
    throw new Error(
      "No individual requirements were found. Add explicit AC-*, FR-*, NFR-*, or INV-* list items to the PRD.",
    );
  }

  const evaluation = await options.evaluator.evaluate({
    prd: options.prd,
    plan: options.plan,
    requirements,
  });

  const judgments: RequirementJudgment[] = requirements.map((requirement) => {
    const answer = evaluation.answers[requirement.id];
    if (!answer) {
      throw new Error(`Jev did not return an answer for ${requirement.id}`);
    }

    const probabilityCovered = answer.noul;
    const probabilityMissing = 1 - probabilityCovered;
    return {
      id: requirement.id,
      requirement: requirement.text,
      line: requirement.line,
      status: classifyProbability(probabilityCovered, thresholds),
      probabilityCovered,
      probabilityMissing,
    };
  });

  const summary = judgments.reduce(
    (counts, judgment) => {
      if (judgment.status === "covered") counts.covered += 1;
      if (judgment.status === "missing") counts.missing += 1;
      if (judgment.status === "needs-review") counts.needsReview += 1;
      return counts;
    },
    { covered: 0, missing: 0, needsReview: 0 },
  );

  return {
    prdPath: options.prdPath,
    planPath: options.planPath,
    thresholds,
    model: evaluation.model,
    usage: evaluation.usage,
    judgments,
    summary,
    hasMissing: summary.missing > 0,
  };
}
