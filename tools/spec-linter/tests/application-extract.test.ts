import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  extractApplicationMappings,
  extractApplicationRequirements,
} from "../src/application-extract.js";

describe("application overview extraction", () => {
  it("finds all 77 stable acceptance-criterion IDs", async () => {
    const overview = await readFile(
      new URL("../../../Specs/application_overview.md", import.meta.url),
      "utf8",
    );
    const requirements = extractApplicationRequirements(overview);

    expect(requirements).toHaveLength(77);
    expect(requirements[0]).toMatchObject({ id: "APP-AC-01" });
    expect(requirements.at(-1)).toMatchObject({ id: "APP-AC-77" });
  });

  it("parses the PRD application-coverage table", () => {
    const prd = `# Feature

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-01 / APP-AC-02 | FR-01.1 | AC-01 | Shared |

## Executive Summary
`;

    expect(extractApplicationMappings(prd)).toEqual([
      {
        applicationIds: ["APP-AC-01", "APP-AC-02"],
        featureRequirements: "FR-01.1",
        acceptanceCriteria: "AC-01",
        ownership: "Shared",
        line: 7,
        raw: "| APP-AC-01 / APP-AC-02 | FR-01.1 | AC-01 | Shared |",
      },
    ]);
  });
});
