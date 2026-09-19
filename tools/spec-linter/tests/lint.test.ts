import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { lintDocuments } from "../src/lint.js";
import type { JevEvaluator } from "../src/types.js";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("lintDocuments", () => {
  it("preserves one Jev probability for every requirement and classifies it", async () => {
    const prd = await fixture("representative.prd.md");
    const plan = await fixture("representative.plan.md");
    let seenRequirementCount = 0;

    const evaluator: JevEvaluator = {
      async evaluate(input) {
        seenRequirementCount = input.requirements.length;
        return {
          model: "jev-latest",
          answers: {
            "AC-01": { noul: 0.96 },
            "AC-02": { noul: 0.12 },
            "FR-01.1": { noul: 0.88 },
            "NFR-01": { noul: 0.59 },
            "INV-01": { noul: 0.93 },
          },
        };
      },
    };

    const report = await lintDocuments({ prd, plan, evaluator });

    expect(seenRequirementCount).toBe(5);
    expect(report.summary).toEqual({ covered: 3, missing: 1, needsReview: 1 });
    expect(report.hasMissing).toBe(true);
    expect(report.judgments.find(({ id }) => id === "NFR-01")).toMatchObject({
      status: "needs-review",
      probabilityCovered: 0.59,
      probabilityMissing: 0.41000000000000003,
    });
  });

  it("fails closed when Jev omits a requirement answer", async () => {
    const prd = await fixture("representative.prd.md");
    const plan = await fixture("representative.plan.md");
    const evaluator: JevEvaluator = {
      async evaluate() {
        return { answers: {} };
      },
    };

    await expect(lintDocuments({ prd, plan, evaluator })).rejects.toThrow("AC-01");
  });
});
