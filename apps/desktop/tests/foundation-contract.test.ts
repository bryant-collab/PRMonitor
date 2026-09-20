import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(appRoot, relativePath), "utf8");
}

describe("F01 workspace contract", () => {
  it("pins the approved desktop runtime and build dependency versions", async () => {
    const manifest = JSON.parse(await source("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      main: string;
    };

    expect(manifest.main).toBe("out/main/index.js");
    expect(manifest.dependencies).toMatchObject({
      "@openai/codex-sdk": "0.155.1",
      react: "19.3.0",
      "react-dom": "19.3.0",
      tabbable: "6.5.0",
    });
    expect(manifest.devDependencies).toMatchObject({
      electron: "44.4.3",
      "electron-vite": "5.0.0",
      vite: "7.3.6",
      "@vitejs/plugin-react": "5.0.4",
      typescript: "5.9.3",
      eslint: "10.11.0",
      "@eslint/js": "10.0.1",
      "typescript-eslint": "8.70.0",
      prettier: "3.9.8",
      "eslint-config-prettier": "10.1.8",
      vitest: "5.0.1",
      "@types/node": "24.13.6",
      "@types/react": "19.3.0",
      "@types/react-dom": "19.3.0",
      "electron-builder": "26.15.3",
    });

    for (const version of [
      ...Object.values(manifest.dependencies),
      ...Object.values(manifest.devDependencies),
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    }
  });

  it("keeps the four source boundaries and the renderer privileged-import guard", async () => {
    const expectedEntries = [
      "src/main/index.ts",
      "src/preload/index.ts",
      "src/renderer/main.tsx",
      "src/shared/startup.ts",
    ];
    for (const entry of expectedEntries) {
      await expect(source(entry)).resolves.toBeTruthy();
    }

    const renderer = `${await source("src/renderer/main.tsx")}\n${await source("src/renderer/StartupApp.tsx")}\n${await source("src/renderer/styles.css")}`;
    expect(renderer).not.toMatch(/from ["'](?:node:|electron)/u);
    expect(renderer).not.toMatch(
      /(?:require|import)\s*\([^)]*(?:node:|electron)/u,
    );
    expect(renderer).not.toMatch(
      /@openai\/codex-sdk|@prmonitor\/spec-linter|github|sqlite|child_process/iu,
    );

    const shared = await source("src/shared/startup.ts");
    expect(shared).not.toMatch(/from ["'](?:node:|electron)/u);
    const preload = await source("src/preload/index.ts");
    expect(preload).not.toMatch(/contextBridge|ipcRenderer|ipcMain/u);
  });

  it("keeps the main shell security preferences explicit and provider invocation absent", async () => {
    const main = await source("src/main/index.ts");
    expect(main).toContain(
      'path.join(currentDirectory, "..", "preload", "index.mjs")',
    );
    expect(main).toMatch(/contextIsolation:\s*true/u);
    expect(main).toMatch(/nodeIntegration:\s*false/u);
    expect(main).toMatch(/sandbox:\s*true/u);
    expect(main).not.toMatch(
      /@openai\/codex-sdk|child_process|net|https?:\/\//u,
    );
  });

  it("defines an unpacked directory artifact and bounded nonce smoke contract", async () => {
    const builder = await source("electron-builder.yml");
    const smoke = await source("scripts/smoke.mjs");
    expect(builder).toContain("output: ../../release");
    expect(builder).toContain("target: dir");
    expect(builder).toContain("signAndEditExecutable: false");
    expect(builder).toContain("forceCodeSigning: false");
    expect(smoke).toContain("PRMONITOR_SMOKE");
    expect(smoke).toContain("PRMONITOR_SMOKE_NONCE");
    expect(smoke).toContain("PRMONITOR_USER_DATA_DIR");
    expect(smoke).toContain(".prmonitor-smoke-owner.json");
    expect(smoke).toContain("30_000");
    expect(smoke).toContain("SMOKE_READY_PROTOCOL_FAILED");
    expect(smoke).toMatch(
      /TYPESAFE_API_KEY|_TOKEN|_SECRET|_PASSWORD|_API_KEY/iu,
    );
  });

  it("defines the exact CI matrix and keeps F01 provider/linter imports out of source", async () => {
    const repositoryRoot = path.resolve(appRoot, "..", "..");
    const workflow = await readFile(
      path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("node-version: 24.19.0");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain(
      'xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" npm run check',
    );

    for (const sourcePath of [
      "src/main/index.ts",
      "src/preload/index.ts",
      "src/renderer/main.tsx",
      "src/shared/startup.ts",
    ]) {
      const contents = await source(sourcePath);
      expect(contents).not.toMatch(
        /@openai\/codex-sdk|@prmonitor\/spec-linter/u,
      );
    }
  });
});
