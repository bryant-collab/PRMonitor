import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevEvaluator, JevEvaluation, LintInput, Requirement } from "./types.js";
import { createSemanticLinterClient } from "./typesafe-client.js";

export const JEV_MODEL = "jev-latest";

const ADEQUACY_CRITERIA = {
  true: "The implementation plan gives concrete work, design, dependencies, and/or validation evidence that adequately addresses this requirement. A direct requirement-ID mapping is useful evidence but is not sufficient by itself if the plan does not explain what will be built or verified.",
  false: "The implementation plan omits the requirement, contradicts it, only restates it without implementation or validation work, or is too vague to establish that it will be addressed.",
} as const;

export function buildJevQuestions(requirements: readonly Requirement[]) {
  return Object.fromEntries(
    requirements.map((requirement) => [
      requirement.id,
      noul(
        {
          task: "Judge whether the implementation plan adequately addresses the PRD requirement below.",
          requirement_id: requirement.id,
          requirement: requirement.text,
        },
        ADEQUACY_CRITERIA,
      ),
    ]),
  );
}

export function createJevEvaluator(
  client: Pick<TypeSafeClient, "systemOne"> = createSemanticLinterClient(),
  model: string = JEV_MODEL,
): JevEvaluator {
  return {
    async evaluate(input: LintInput): Promise<JevEvaluation> {
      const questions = buildJevQuestions(input.requirements);
      const response = await client.systemOne({
        state: {
          prd: input.prd,
          implementation_plan: input.plan,
        },
        questions,
        model,
      });

      const answers = Object.fromEntries(
        input.requirements.map((requirement) => {
          const answer = response.answers[requirement.id];
          if (!answer || typeof answer.noul !== "number") {
            throw new Error(`Jev did not return a valid answer for ${requirement.id}`);
          }
          return [requirement.id, { noul: answer.noul }];
        }),
      );

      return {
        answers,
        model: response.model,
        usage: response.usage,
      };
    },
  };
}
