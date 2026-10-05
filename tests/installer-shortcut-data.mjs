import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

export async function installerShortcutData(
  mode,
  dataDirectory,
  evidenceDirectory,
) {
  assert.ok(mode === "seed" || mode === "assert");
  const owner = JSON.parse(
    await readFile(
      path.join(dataDirectory, ".installer-shortcut-owner.json"),
      "utf8",
    ),
  );
  assert.equal(owner.owner, "prmonitor-installer-shortcuts");
  assert.equal(owner.root, dataDirectory);
  const bundle = path.join(evidenceDirectory, "fixtures.mjs");
  const expected = path.join(evidenceDirectory, "retained-work.json");
  if (mode === "seed") {
    await build({
      entryPoints: [
        fileURLToPath(new URL("setup-e2e-fixtures.ts", import.meta.url)),
      ],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      // Source fixtures also run before root check builds workspace packages.
      alias: {
        "@prmonitor/validation-contract": fileURLToPath(
          new URL(
            "../packages/validation-contract/src/index.ts",
            import.meta.url,
          ),
        ),
      },
    });
  }
  const fixtures = await import(pathToFileURL(bundle).href);
  if (mode === "seed") {
    await fixtures.seedSavedReview(dataDirectory);
    await fixtures.installerData(dataDirectory, true);
  } else {
    // Fail before opening persistence: initialization must not conceal deletion.
    await access(path.join(dataDirectory, "database", "prmonitor.sqlite"));
    await access(expected);
  }
  const retained = {
    setting: await fixtures.installerData(dataDirectory, false),
    // JSON represents absent array slots as null. Preserve that representation
    // for both snapshots; seeded records still require full equality.
    reviews: (await fixtures.readRetainedWork(dataDirectory)).reviews.map(
      (review) => review ?? null,
    ),
  };
  assert.ok(retained.setting);
  assert.ok(retained.reviews[0]);
  if (mode === "seed") {
    await writeFile(expected, JSON.stringify(retained));
  } else {
    assert.deepEqual(retained, JSON.parse(await readFile(expected, "utf8")));
  }
}

if (import.meta.main) {
  // The native CLI can operate on an installed profile only on a disposable
  // hosted Windows runner, and still requires the ownership marker above.
  assert.equal(process.platform, "win32");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const [mode, dataDirectory, evidenceDirectory] = process.argv.slice(2);
  await installerShortcutData(mode, dataDirectory, evidenceDirectory);
  process.stdout.write(
    `Owned installed SQLite settings and saved review: ${mode} passed.\n`,
  );
}
