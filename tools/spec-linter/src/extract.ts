import type { Requirement } from "./types.js";

// The templates define individual requirements as list items such as
// "- FR-01.1: The application SHALL ...". Group headings are intentionally
// excluded; the linter judges the leaf requirements that have full text.
const REQUIREMENT_LINE =
  /^\s*(?:(?:[-*+]\s+)|(?:\d+[.)]\s+))?(?:\*\*)?(?<id>(?:AC|FR|NFR|INV)-\d+(?:\.\d+)?)(?:\*\*)?\s*(?::|[-–—])\s*(?<text>.+?)\s*$/;

function withoutHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
}

function isCoverageMappingHeading(line: string): boolean {
  return /^\s*#{1,6}\s+Application Requirements Covered\b/i.test(line);
}

function isHeading(line: string): boolean {
  return /^\s*#{1,6}\s+/.test(line);
}

/** Extracts explicit, uniquely identified leaf requirements from a PRD. */
export function extractRequirements(markdown: string): Requirement[] {
  const lines = withoutHtmlComments(markdown.replace(/\r\n?/g, "\n")).split("\n");
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  let inCoverageMapping = false;

  for (const [index, line] of lines.entries()) {
    if (isHeading(line)) {
      inCoverageMapping = isCoverageMappingHeading(line);
      continue;
    }

    if (inCoverageMapping) {
      continue;
    }

    const match = line.match(REQUIREMENT_LINE);
    if (!match?.groups) {
      continue;
    }

    const id = match.groups.id;
    const rawText = match.groups.text;
    if (!id || !rawText || seen.has(id)) {
      continue;
    }
    const text = rawText.trim();
    if (!text) continue;

    seen.add(id);
    requirements.push({ id, text, line: index + 1 });
  }

  return requirements;
}
