import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { JEV_MODEL } from "./jev.js";
import { createSemanticLinterClient } from "./typesafe-client.js";
import type {
  ApplicationCoverageAnswer,
  ApplicationCoverageChoice,
  ApplicationCoverageEvaluator,
  ApplicationCoverageEvaluation,
  ApplicationCoverageInput,
  ApplicationRequirement,
} from "./types.js";

const COVERAGE_CRITERIA = {
  covered:
    "The feature PRD explicitly addresses this application-level acceptance criterion through relevant feature requirements and observable acceptance criteria. A mapping row alone is not enough if the cited requirements do not actually address the criterion.",
  not_applicable:
    "This application-level criterion concerns a different product area or capability and is not relevant to the feature described by the PRD.",
  missing:
    "This application-level criterion is relevant to the feature described by the PRD, but the PRD does not adequately specify it or its observable acceptance evidence.",
} as const;

export function buildApplicationCoverageQuestions(requirements: readonly ApplicationRequirement[]) {
  return Object.fromEntries(
    requirements.map((requirement) => [
      requirement.id,
      choice(
        {
          task: "Classify how the new feature PRD relates to this application-level acceptance criterion.",
          application_requirement_id: requirement.id,
          application_requirement: requirement.text,
        },
        COVERAGE_CRITERIA,
      ),
    ]),
  );
}

function isCoverageChoice(value: string): value is ApplicationCoverageChoice {
  return value === "covered" || value === "missing" || value === "not_applicable";
}

function readAnswer(
  raw: {
    choice: string;
    confidence: number;
    probabilities: Readonly<Record<string, number>>;
  },
): ApplicationCoverageAnswer {
  if (!isCoverageChoice(raw.choice)) {
    throw new Error(`Jev returned an invalid application coverage choice: ${raw.choice}`);
  }

  const covered = raw.probabilities.covered;
  const missing = raw.probabilities.missing;
  const notApplicable = raw.probabilities.not_applicable;
  if (
    typeof covered !== "number" ||
    typeof missing !== "number" ||
    typeof notApplicable !== "number"
  ) {
    throw new Error("Jev returned an incomplete application coverage probability distribution");
  }

  return {
    choice: raw.choice,
    confidence: raw.confidence,
    probabilities: { covered, missing, not_applicable: notApplicable },
  };
}

export function createApplicationCoverageEvaluator(
  client: Pick<TypeSafeClient, "systemOne"> = createSemanticLinterClient(),
  model: string = JEV_MODEL,
): ApplicationCoverageEvaluator {
  return {
    async evaluate(input: ApplicationCoverageInput): Promise<ApplicationCoverageEvaluation> {
      const questions = buildApplicationCoverageQuestions(input.applicationRequirements);
      const response = await client.systemOne({
        state: {
          prd: input.prd,
          application_requirements: input.applicationRequirements.map(({ id, text }) => ({ id, text })),
          application_mappings: input.mappings.map((mapping) => ({
            application_ids: mapping.applicationIds,
            feature_requirements: mapping.featureRequirements,
            acceptance_criteria: mapping.acceptanceCriteria,
            ownership: mapping.ownership,
            line: mapping.line,
          })),
          feature_requirements: input.prdRequirements.map(({ id, text }) => ({ id, text })),
        },
        questions,
        model,
      });

      const answers = Object.fromEntries(
        input.applicationRequirements.map((requirement) => {
          const raw = response.answers[requirement.id] as unknown as {
            choice: string;
            confidence: number;
            probabilities: Readonly<Record<string, number>>;
          } | undefined;
          if (!raw) {
            throw new Error(`Jev did not return an answer for ${requirement.id}`);
          }
          return [requirement.id, readAnswer(raw)];
        }),
      );

      return { answers, model: response.model, usage: response.usage };
    },
  };
}
