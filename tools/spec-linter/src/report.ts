import type { LintReport, RequirementStatus } from "./types.js";

const STATUS_LABEL: Record<RequirementStatus, string> = {
  covered: "COVERED",
  missing: "MISSING",
  "needs-review": "NEEDS-REVIEW",
};

function probability(value: number): string {
  return value.toFixed(3);
}

export function renderTextReport(report: LintReport): string {
  const lines = [
    "PRD / implementation plan lint report",
    report.prdPath ? `PRD: ${report.prdPath}` : "PRD: <input>",
    report.planPath ? `Plan: ${report.planPath}` : "Plan: <input>",
    `Thresholds: covered >= ${report.thresholds.covered.toFixed(3)}, missing >= ${report.thresholds.missing.toFixed(3)}`,
    report.model ? `Model: ${report.model}` : "Model: <unknown>",
    "",
    `Summary: ${report.summary.covered} covered, ${report.summary.missing} missing, ${report.summary.needsReview} needs-review`,
    "",
  ];

  for (const judgment of report.judgments) {
    lines.push(`[${STATUS_LABEL[judgment.status]}] ${judgment.id} (PRD line ${judgment.line})`);
    lines.push(
      `  P(covered)=${probability(judgment.probabilityCovered)}  P(missing)=${probability(judgment.probabilityMissing)}`,
    );
    lines.push(`  ${judgment.requirement}`);
    lines.push("");
  }

  if (report.hasMissing) {
    lines.push("Result: FAILED — at least one requirement is missing from the plan.");
  } else if (report.summary.needsReview > 0) {
    lines.push("Result: PASS WITH REVIEW — no definite missing requirement was found.");
  } else {
    lines.push("Result: PASSED — every requirement is covered.");
  }

  return `${lines.join("\n")}\n`;
}
