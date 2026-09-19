import type { ApplicationMapping, ApplicationRequirement } from "./types.js";

const APPLICATION_REQUIREMENT_LINE =
  /^\s*(?:\d+[.)]\s+)?(?:\*\*)?(?<id>APP-AC-\d+)(?:\*\*)?\s*:\s*(?<text>.+?)\s*$/;
const APPLICATION_ID = /\bAPP-AC-\d+\b/g;

function withoutHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;

  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isHeading(line: string): boolean {
  return /^\s*#{1,6}\s+/.test(line);
}

/** Extracts stable APP-AC-* entries from the application overview. */
export function extractApplicationRequirements(markdown: string): ApplicationRequirement[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const requirements: ApplicationRequirement[] = [];
  const seen = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const match = line.match(APPLICATION_REQUIREMENT_LINE);
    if (!match?.groups) continue;

    const id = match.groups.id;
    const text = match.groups.text?.trim();
    if (!id || !text) continue;
    if (seen.has(id)) {
      throw new Error(`Duplicate application requirement ID: ${id}`);
    }

    seen.add(id);
    requirements.push({ id, text, line: index + 1 });
  }

  return requirements;
}

/** Extracts the PRD's explicit Application Requirements Covered table. */
export function extractApplicationMappings(markdown: string): ApplicationMapping[] {
  const lines = withoutHtmlComments(markdown.replace(/\r\n?/g, "\n")).split("\n");
  const mappings: ApplicationMapping[] = [];
  let inMappingSection = false;

  for (const [index, line] of lines.entries()) {
    if (isHeading(line)) {
      inMappingSection = /^\s*#{1,6}\s+Application Requirements Covered\b/i.test(line);
      continue;
    }
    if (!inMappingSection) continue;

    const cells = splitTableRow(line);
    if (!cells || cells.length === 0) continue;
    if (/^application\s+id$/i.test(cells[0] ?? "") || /^[-\s:]+$/.test(cells[0] ?? "")) {
      continue;
    }

    const applicationIds = [...(cells[0] ?? "").matchAll(APPLICATION_ID)].map(
      (match) => match[0],
    );
    if (applicationIds.length === 0) continue;

    mappings.push({
      applicationIds,
      featureRequirements: cells[1] ?? "",
      acceptanceCriteria: cells[2] ?? "",
      ownership: cells[3] ?? "",
      line: index + 1,
      raw: line.trim(),
    });
  }

  return mappings;
}
