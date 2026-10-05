import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { classifySmokeFailure } from "../apps/desktop/scripts/smoke-failure.mjs";

export async function canonicalTemporaryRoot(temporaryRoot) {
  return realpath(temporaryRoot);
}

export function canonicalTempEnvironment(environment, temporaryRoot) {
  return { ...environment, TEMP: temporaryRoot, TMP: temporaryRoot };
}

export function installerFailureLabel(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^INSTALLER_SMOKE_(TIMEOUT|OUTPUT_LIMIT|SPAWN_FAILED)$/.test(message))
    return message;
  if (
    /^INSTALLER_SMOKE_FAILED:(SANDBOX_SETUP_FAILED|DISPLAY_SETUP_FAILED|GPU_PROCESS_FAILED|UNCLASSIFIED):digest=[a-f0-9]{12}$/.test(
      message,
    )
  )
    return message;
  return "INSTALLER_ACCEPTANCE_FAILED";
}

/** Child output is bounded in memory and never appears in public errors. */
export function waitForInstallerSmoke(child, nonce, options = {}) {
  const timeoutMs = options.timeoutMs ?? 35000;
  const maxBytes = options.maxBytes ?? 131072;
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const stop = (label) => {
      finish(Error(label));
      child.kill();
    };
    const timer = setTimeout(() => stop("INSTALLER_SMOKE_TIMEOUT"), timeoutMs);
    const collect = (name, chunk) => {
      if (settled) return;
      const current = name === "stdout" ? stdout : stderr;
      const bytes = Buffer.from(chunk);
      if (current.length + bytes.length > maxBytes) {
        stop("INSTALLER_SMOKE_OUTPUT_LIMIT");
        return;
      }
      const value = Buffer.concat([current, bytes]);
      if (name === "stdout") stdout = value;
      else stderr = value;
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", () => finish(Error("INSTALLER_SMOKE_SPAWN_FAILED")));
    // close waits for both streams; exit can precede the final ready marker.
    child.on("close", (code) => {
      if (settled) return;
      if (code === 0 && stdout.includes(`PRMONITOR_SMOKE_READY:${nonce}`)) {
        finish();
        return;
      }
      const digest = createHash("sha256")
        .update(stdout)
        .update(stderr)
        .digest("hex")
        .slice(0, 12);
      const category = classifySmokeFailure(stderr.toString("utf8"));
      finish(Error(`INSTALLER_SMOKE_FAILED:${category}:digest=${digest}`));
    });
  });
}
