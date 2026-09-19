export type RequirementStatus = "covered" | "missing" | "needs-review";

export interface Requirement {
  id: string;
  text: string;
  line: number;
}

export interface LintThresholds {
  covered: number;
  missing: number;
}

export interface JevAnswer {
  noul: number;
}

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevEvaluation {
  answers: Record<string, JevAnswer>;
  model?: string;
  usage?: JevUsage;
}

export interface LintInput {
  prd: string;
  plan: string;
  requirements: readonly Requirement[];
}

export interface JevEvaluator {
  evaluate(input: LintInput): Promise<JevEvaluation>;
}

export interface RequirementJudgment {
  id: string;
  requirement: string;
  line: number;
  status: RequirementStatus;
  probabilityCovered: number;
  probabilityMissing: number;
}

export interface LintReport {
  prdPath?: string;
  planPath?: string;
  thresholds: LintThresholds;
  model?: string;
  usage?: JevUsage;
  judgments: RequirementJudgment[];
  summary: {
    covered: number;
    missing: number;
    needsReview: number;
  };
  hasMissing: boolean;
}

export type ApplicationCoverageStatus =
  | "covered"
  | "missing"
  | "not-applicable"
  | "needs-review";

export type ApplicationCoverageChoice = "covered" | "missing" | "not_applicable";

export interface ApplicationRequirement {
  id: string;
  text: string;
  line: number;
}

export interface ApplicationMapping {
  applicationIds: string[];
  featureRequirements: string;
  acceptanceCriteria: string;
  ownership: string;
  line: number;
  raw: string;
}

export interface ApplicationCoverageThresholds {
  decision: number;
  reviewConfidence: number;
}

export interface ApplicationCoverageAnswer {
  choice: ApplicationCoverageChoice;
  probabilities: Record<ApplicationCoverageChoice, number>;
  confidence: number;
}

export interface ApplicationCoverageInput {
  prd: string;
  applicationRequirements: readonly ApplicationRequirement[];
  mappings: readonly ApplicationMapping[];
  prdRequirements: readonly Requirement[];
}

export interface ApplicationCoverageEvaluation {
  answers: Record<string, ApplicationCoverageAnswer>;
  model?: string;
  usage?: JevUsage;
}

export interface ApplicationCoverageEvaluator {
  evaluate(input: ApplicationCoverageInput): Promise<ApplicationCoverageEvaluation>;
}

export interface ApplicationCoverageJudgment {
  id: string;
  requirement: string;
  line: number;
  status: ApplicationCoverageStatus;
  modelChoice: ApplicationCoverageChoice;
  probabilities: Record<ApplicationCoverageChoice, number>;
  confidence: number;
  mappingLines: number[];
}

export interface ApplicationCoverageReport {
  overviewPath?: string;
  prdPath?: string;
  thresholds: ApplicationCoverageThresholds;
  model?: string;
  usage?: JevUsage;
  judgments: ApplicationCoverageJudgment[];
  summary: {
    covered: number;
    missing: number;
    notApplicable: number;
    needsReview: number;
  };
  hasMissing: boolean;
}
