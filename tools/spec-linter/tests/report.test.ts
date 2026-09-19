import { describe, expect, it } from "vitest";
import { renderTextReport } from "../src/report.js";

describe("renderTextReport", () => {
  it("shows every requirement, its status, and both probabilities", () => {
    const output = renderTextReport({
      prdPath: "feature_PRD.md",
      planPath: "feature_PLAN.md",
      thresholds: { covered: 0.8, missing: 0.8 },
      model: "jev-latest",
      judgments: [
        {
          id: "FR-01.1",
          requirement: "The application SHALL save the setting.",
          line: 7,
          status: "covered",
          probabilityCovered: 0.93,
          probabilityMissing: 0.07,
        },
        {
          id: "AC-01",
          requirement: "The setting is visible after restart.",
          line: 11,
          status: "needs-review",
          probabilityCovered: 0.57,
          probabilityMissing: 0.43,
        },
      ],
      summary: { covered: 1, missing: 0, needsReview: 1 },
      hasMissing: false,
    });

    expect(output).toContain("[COVERED] FR-01.1");
    expect(output).toContain("[NEEDS-REVIEW] AC-01");
    expect(output).toContain("P(covered)=0.930  P(missing)=0.070");
    expect(output).toContain("Summary: 1 covered, 0 missing, 1 needs-review");
    expect(output).toContain("Result: PASS WITH REVIEW");
  });
});
