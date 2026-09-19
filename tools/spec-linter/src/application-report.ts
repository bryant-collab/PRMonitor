import type { ApplicationCoverageReport, ApplicationCoverageStatus } from "./types.js";

const STATUS_LABEL: Record<ApplicationCoverageStatus, string> = {
  covered: "COVERED",
  missing: "MISSING",
  "not-applicable": "NOT-APPLICABLE",
  "needs-review": "NEEDS-REVIEW",
};

function probability(value: number): string {
  return value.toFixed(3);
}

export function renderApplicationCoverageReport(report: ApplicationCoverageReport): string {
  const lines = [
    "Application overview / PRD coverage lint report",
    report.overviewPath ? `Overview: ${report.overviewPath}` : "Overview: <input>",
    report.prdPath ? `PRD: ${report.prdPath}` : "PRD: <input>",
    `Thresholds: decision >= ${report.thresholds.decision.toFixed(3)}, review confidence >= ${report.thresholds.reviewConfidence.toFixed(3)}`,
    report.model ? `Model: ${report.model}` : "Model: <unknown>",
    "",
    `Summary: ${report.summary.covered} covered, ${report.summary.missing} missing, ${report.summary.notApplicable} not-applicable, ${report.summary.needsReview} needs-review`,
    "",
  ];

  for (const judgment of report.judgments) {
    const mapping = judgment.mappingLines.length > 0 ? judgment.mappingLines.join(", ") : "none";
    lines.push(`[${STATUS_LABEL[judgment.status]}] ${judgment.id} (overview line ${judgment.line})`);
    lines.push(
      `  Choice=${judgment.modelChoice}  confidence=${probability(judgment.confidence)}  P(covered)=${probability(judgment.probabilities.covered)}  P(not-applicable)=${probability(judgment.probabilities.not_applicable)}  P(missing)=${probability(judgment.probabilities.missing)}`,
    );
    lines.push(`  PRD mapping lines: ${mapping}`);
    lines.push(`  ${judgment.requirement}`);
    lines.push("");
  }

  lines.push(
    report.hasMissing
      ? "Result: FAILED — at least one applicable application requirement is missing from the PRD."
      : report.summary.needsReview > 0
        ? "Result: PASS WITH REVIEW — no definite missing application requirement was found."
        : "Result: PASSED — every application requirement is covered or explicitly not applicable.",
  );

  return `${lines.join("\n")}\n`;
}
