import { describe, expect, it } from "vitest";
import { lintApplicationCoverage } from "../src/application-lint.js";
import type { ApplicationCoverageEvaluator } from "../src/types.js";

const overview = `# Application overview

1. **APP-AC-01:** The feature is visible to the user.
2. **APP-AC-02:** The feature is safe to retry.
3. **APP-AC-03:** The feature supports export.
4. **APP-AC-04:** The feature records an audit event.
`;

const prd = `# Feature PRD

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-01 | FR-01.1 | AC-01 | Primary |
| APP-AC-02 | FR-01.2 | AC-02 | Shared |
| APP-AC-03 |  |  | None |
| APP-AC-04 | FR-01.4 | AC-04 | Primary |

## Functional Requirements

- FR-01.1: The application SHALL show the feature.
- FR-01.2: The application SHALL make retries idempotent.
- FR-01.4: The application SHALL record an audit event.

## Observable Acceptance Criteria

- AC-01: The feature is visible.
- AC-02: Repeating the operation is safe.
- AC-04: The audit event can be inspected.
`;

describe("lintApplicationCoverage", () => {
  it("separates covered, missing, not-applicable, and uncertain judgments", async () => {
    const evaluator: ApplicationCoverageEvaluator = {
      async evaluate() {
        return {
          model: "jev-latest",
          answers: {
            "APP-AC-01": {
              choice: "covered",
              probabilities: { covered: 0.94, missing: 0.03, not_applicable: 0.03 },
              confidence: 0.94,
            },
            "APP-AC-02": {
              choice: "missing",
              probabilities: { covered: 0.04, missing: 0.92, not_applicable: 0.04 },
              confidence: 0.92,
            },
            "APP-AC-03": {
              choice: "not_applicable",
              probabilities: { covered: 0.04, missing: 0.06, not_applicable: 0.9 },
              confidence: 0.9,
            },
            "APP-AC-04": {
              choice: "covered",
              probabilities: { covered: 0.58, missing: 0.2, not_applicable: 0.22 },
              confidence: 0.58,
            },
          },
        };
      },
    };

    const report = await lintApplicationCoverage({ overview, prd, evaluator });

    expect(report.summary).toEqual({
      covered: 1,
      missing: 1,
      notApplicable: 1,
      needsReview: 1,
    });
    expect(report.hasMissing).toBe(true);
    expect(report.judgments.find(({ id }) => id === "APP-AC-04")).toMatchObject({
      status: "needs-review",
      modelChoice: "covered",
      probabilities: { covered: 0.58, missing: 0.2, not_applicable: 0.22 },
    });
  });
});
