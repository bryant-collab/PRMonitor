import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRootPath, resolveDocumentPath } from "../src/paths.js";

describe("spec-linter document path normalization", () => {
  it("resolves repository-relative paths from the checkout root", () => {
    expect(resolveDocumentPath("Specs/application_overview.md")).toBe(
      resolve(repositoryRootPath(), "Specs/application_overview.md"),
    );
  });

  it("resolves direct workspace-relative paths without looking under tools/spec-linter/Specs", () => {
    const normalized = resolveDocumentPath("../../Specs/application_overview.md");
    expect(normalized).toBe(resolve(repositoryRootPath(), "Specs/application_overview.md"));
    expect(normalized).not.toContain("tools/spec-linter/Specs");
  });

  it("preserves absolute paths", () => {
    const absolute = resolve(repositoryRootPath(), "Specs/application_overview.md");
    expect(resolveDocumentPath(absolute)).toBe(absolute);
  });
});
