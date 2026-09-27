import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  F22ChoiceControls,
  f22ChoiceConfirmDisabled,
} from "../src/renderer/F22ChoiceControls";

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

  it("declares the F22 stale/dirty action surface with keyboard and non-visual cues", async () => {
    const workspace = await readRenderer("ReviewBundleWorkspace.tsx");
    const controls = await readRenderer("F22ChoiceControls.tsx");
    const styles = await readRenderer("styles.css");
    expect(workspace).toContain('aria-labelledby="review-f22-heading"');
    expect(workspace).toContain('role={workspace.f22.status === "CURRENT"');
    expect(workspace).toContain('aria-live="polite"');
    expect(workspace).toContain('<fieldset className="review-f22-scope">');
    expect(workspace).toContain("Retain feedback for re-evaluation (optional)");
    expect(workspace).toContain("<F22ChoiceControls");
    expect(controls).toContain("data-f22-focus-target");
    expect(controls).toContain('aria-describedby="f22-choice-help"');
    expect(controls).toContain("onConfirmedChange(false)");
    expect(controls).toContain("Clear All Changes");
    expect(controls).toContain("Clear Only AI Changes");
    expect(controls).toContain("Keep Worktree and Cancel");
    expect(controls).toContain("Keyboard focus moves here");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("min-width: 0");
  });

  it("runtime-renders an operable F22 choice surface with a safe confirmation gate", () => {
    const rendered = renderToStaticMarkup(
      createElement(F22ChoiceControls, {
        requiredChoice: "CLEAR_ALL",
        choice: "CLEAR_ALL",
        confirmed: false,
        busy: false,
        onChoiceChange: () => undefined,
        onConfirmedChange: () => undefined,
        onConfirm: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(rendered).toContain('role="group"');
    expect(rendered).toContain('tabindex="-1"');
    expect(rendered).toContain('aria-describedby="f22-choice-help"');
    expect(rendered).toContain("Clear All Changes");
    expect(rendered).toContain("Clear Only AI Changes");
    expect(rendered).toContain("Keep Worktree and Cancel");
    expect(rendered.indexOf('id="f22-worktree-choice"')).toBeLessThan(
      rendered.indexOf('id="f22-confirmation"'),
    );
    expect(rendered.indexOf('id="f22-confirmation"')).toBeLessThan(
      rendered.indexOf('id="f22-confirm-choice"'),
    );
    expect(
      f22ChoiceConfirmDisabled({
        choice: "CLEAR_ALL",
        confirmed: false,
        busy: false,
      }),
    ).toBe(true);
    expect(
      f22ChoiceConfirmDisabled({
        choice: "KEEP_AND_CANCEL",
        confirmed: false,
        busy: false,
      }),
    ).toBe(false);
  });
});
