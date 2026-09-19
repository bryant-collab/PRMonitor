import { describe, expect, it, vi } from "vitest";
import { buildJevQuestions, createJevEvaluator } from "../src/jev.js";
import type { Requirement } from "../src/types.js";

const requirements: Requirement[] = [
  { id: "FR-01.1", text: "The app SHALL save the setting.", line: 4 },
  { id: "AC-01", text: "The setting is visible after restart.", line: 8 },
];

describe("Jev adapter", () => {
  it("builds one narrow Noul per requirement", () => {
    const questions = buildJevQuestions(requirements);

    expect(Object.keys(questions)).toEqual(["FR-01.1", "AC-01"]);
    expect(questions["FR-01.1"]?.type).toBe("noul");
    expect(questions["AC-01"]?.instructions).toMatchObject({ requirement_id: "AC-01" });
  });

  it("passes the full named document state and preserves Jev answers", async () => {
    const systemOne = vi.fn().mockResolvedValue({
      model: "jev-latest",
      answers: {
        "FR-01.1": { type: "noul", noul: 0.93 },
        "AC-01": { type: "noul", noul: 0.62 },
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    });
    const evaluator = createJevEvaluator({ systemOne } as never);

    const result = await evaluator.evaluate({
      prd: "PRD text",
      plan: "Plan text",
      requirements,
    });

    expect(systemOne).toHaveBeenCalledOnce();
    expect(systemOne.mock.calls[0]?.[0].state).toEqual({
      prd: "PRD text",
      implementation_plan: "Plan text",
    });
    expect(result.answers).toEqual({
      "FR-01.1": { noul: 0.93 },
      "AC-01": { noul: 0.62 },
    });
  });
});
