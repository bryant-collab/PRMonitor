import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderValidationSchema } from "../src/schema-artifact.js";

describe("generated validation schema preservation", () => {
  it("matches the tracked schema byte-for-byte without writing it", async () => {
    const repositoryRoot = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "..",
      "..",
    );
    const schemaPath = resolve(
      repositoryRoot,
      "Specs",
      "contracts",
      "validation-profile.v1.schema.json",
    );
    const tracked = await readFile(schemaPath);
    expect(tracked.equals(Buffer.from(renderValidationSchema(), "utf8"))).toBe(
      true,
    );
  });

  it("keeps schema bytes and the worktree status stable during verification", async () => {
    const repositoryRoot = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "..",
      "..",
    );
    const schemaPath = resolve(
      repositoryRoot,
      "Specs",
      "contracts",
      "validation-profile.v1.schema.json",
    );
    const beforeBytes = await readFile(schemaPath);
    const beforeStatus = execFileSync("git", ["status", "--short"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    });

    expect(Buffer.from(renderValidationSchema()).equals(beforeBytes)).toBe(
      true,
    );

    const afterBytes = await readFile(schemaPath);
    const afterStatus = execFileSync("git", ["status", "--short"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(afterBytes.equals(beforeBytes)).toBe(true);
    expect(afterStatus).toBe(beforeStatus);
  });

  it("refuses a disposable verifier-output cleanup when ownership changes", async () => {
    // Windows temporary paths may use an 8.3 alias. Record the canonical
    // directory before ownership checks so aliases do not look like a swap.
    const disposableRoot = await realpath(
      await mkdtemp(join(os.tmpdir(), "prmonitor-schema-verify-")),
    );
    const markerPath = join(disposableRoot, ".owner.json");
    const marker = {
      owner: "validation-schema-verifier",
      directory: resolve(disposableRoot),
    };
    const safeRemove = async (): Promise<void> => {
      const current = JSON.parse(
        await readFile(markerPath, "utf8"),
      ) as typeof marker;
      if (
        current.owner !== marker.owner ||
        current.directory !== marker.directory
      ) {
        throw new Error(
          "SCHEMA_VERIFY_CLEANUP_REFUSED: ownership or canonical containment changed",
        );
      }
      const canonicalRoot = await realpath(disposableRoot);
      const canonicalTemp = await realpath(os.tmpdir());
      const escaped = relative(canonicalTemp, canonicalRoot).startsWith(
        `..${pathSeparator()}`,
      );
      if (escaped || resolve(canonicalRoot) !== resolve(disposableRoot)) {
        throw new Error(
          "SCHEMA_VERIFY_CLEANUP_REFUSED: ownership or canonical containment changed",
        );
      }
      const finalMarker = JSON.parse(
        await readFile(markerPath, "utf8"),
      ) as typeof marker;
      if (
        finalMarker.owner !== marker.owner ||
        finalMarker.directory !== marker.directory
      ) {
        throw new Error(
          "SCHEMA_VERIFY_CLEANUP_REFUSED: ownership changed before deletion",
        );
      }
      await rm(disposableRoot, { recursive: true, force: false });
    };

    try {
      await writeFile(markerPath, `${JSON.stringify(marker)}\n`, "utf8");
      await writeFile(
        markerPath,
        `${JSON.stringify({ ...marker, owner: "changed-owner" })}\n`,
        "utf8",
      );
      await expect(safeRemove()).rejects.toThrow(
        "SCHEMA_VERIFY_CLEANUP_REFUSED",
      );
      await writeFile(markerPath, `${JSON.stringify(marker)}\n`, "utf8");
      await safeRemove();
    } finally {
      await rm(disposableRoot, { recursive: true, force: true });
    }
  });
});

function pathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}
