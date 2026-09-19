import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { extractRequirements } from "../src/extract.js";

describe("extractRequirements", () => {
  it("extracts leaf requirement list items and ignores comments and mapping tables", async () => {
    const prd = await readFile(new URL("./fixtures/representative.prd.md", import.meta.url), "utf8");
    const requirements = extractRequirements(prd);

    expect(requirements.map(({ id }) => id)).toEqual([
      "AC-01",
      "AC-02",
      "FR-01.1",
      "NFR-01",
      "INV-01",
    ]);
    expect(requirements[0]).toMatchObject({ line: 11 });
    expect(requirements[2]?.text).toContain("restore a saved cart");
  });
});
