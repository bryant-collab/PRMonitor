import { describe, expect, it } from "vitest";
import { classifyProbability } from "../src/thresholds.js";

describe("classifyProbability", () => {
  it("keeps confident coverage and confident gaps separate", () => {
    expect(classifyProbability(0.91)).toBe("covered");
    expect(classifyProbability(0.09)).toBe("missing");
  });

  it("routes the uncertain middle to needs-review", () => {
    expect(classifyProbability(0.55)).toBe("needs-review");
  });

  it("supports code-configured thresholds", () => {
    expect(classifyProbability(0.74, { covered: 0.7, missing: 0.7 })).toBe("covered");
    expect(classifyProbability(0.26, { covered: 0.7, missing: 0.7 })).toBe("missing");
  });
});
