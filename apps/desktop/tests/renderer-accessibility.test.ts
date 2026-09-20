import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function readRenderer(relativePath: string): Promise<string> {
  return readFile(path.join(appRoot, "src", "renderer", relativePath), "utf8");
}

describe("F01 startup accessibility contract", () => {
  it("declares the semantic title, heading, status, skip link, and ready marker", async () => {
    const html = await readRenderer("index.html");
    const app = await readRenderer("StartupApp.tsx");
    expect(html).toContain("<title>PRMonitor</title>");
    expect(app).toContain("Skip to startup status");
    expect(app).toContain('<h1 id="startup-heading">{APPLICATION_TITLE}</h1>');
    expect(app).toContain('role="status"');
    expect(app).toContain('aria-live="polite"');
    expect(app).toContain(
      "data-prmonitor-ready={String(INITIAL_STARTUP_STATUS.ready)}",
    );
    expect(app).toContain("tabIndex={0}");
    expect(app).toContain("statusRef.current?.focus()");
  });

  it("contains a forced-colors media rule with non-color-only focus treatment", async () => {
    const styles = await readRenderer("styles.css");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toContain("CanvasText");
    expect(styles).toContain("Highlight");
    expect(styles).toContain("outline");
  });

  it("keeps the declared focus order skip link before the status target", async () => {
    const app = await readRenderer("StartupApp.tsx");
    expect(app.indexOf('className="skip-link"')).toBeLessThan(
      app.indexOf("id={STARTUP_STATUS_ID}"),
    );
  });
});
