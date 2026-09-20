import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_TITLE,
  SMOKE_READY_PREFIX,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import { initializePersistence, type PersistenceStore } from "./persistence";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const smokeMode = process.env.PRMONITOR_SMOKE === "1";
const smokeNonce = process.env.PRMONITOR_SMOKE_NONCE;
const smokeTimeoutMs = 29_000;
let smokeReady = false;
let smokeTimer: NodeJS.Timeout | undefined;
let smokeWindow: BrowserWindow | undefined;
let persistenceStore: PersistenceStore | undefined;

const rendererEntry = path.join(
  currentDirectory,
  "..",
  "renderer",
  "index.html",
);
const preloadEntry = path.join(currentDirectory, "..", "preload", "index.mjs");

function configureSmokePaths(): void {
  if (!smokeMode) return;
  const userDataDirectory = process.env.PRMONITOR_USER_DATA_DIR;
  const cacheDirectory = process.env.PRMONITOR_CACHE_DIR;
  if (
    !userDataDirectory ||
    !cacheDirectory ||
    !path.isAbsolute(userDataDirectory) ||
    !path.isAbsolute(cacheDirectory)
  ) {
    throw new Error("SMOKE_RUNTIME_PATHS_MISSING");
  }
  app.setPath("userData", userDataDirectory);
  app.setPath("cache", cacheDirectory);
}

const accessibilityProbe = `(() => {
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getAttribute("aria-hidden") !== "true";
  };
  const focusable = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex=\\"-1\\"])" )]
    .filter((element) => visible(element) && !element.hasAttribute("disabled"));
  const skipLink = document.querySelector(".skip-link");
  const status = document.querySelector("#${STARTUP_STATUS_ID}");
  const heading = document.querySelectorAll("h1");
  if (!skipLink || !status) return { ok: false, reason: "required-target-missing" };
  const skipIndex = focusable.indexOf(skipLink);
  const statusIndex = focusable.indexOf(status);
  skipLink.focus();
  const skipFocused = document.activeElement === skipLink;
  skipLink.click();
  const enterMovesFocus = document.activeElement === status;
  return {
    ok: document.title === "${APPLICATION_TITLE}" &&
      heading.length === 1 && visible(heading[0]) &&
      status.getAttribute("role") === "status" &&
      status.getAttribute("aria-live") === "polite" &&
      status.getAttribute("data-prmonitor-ready") === "true" &&
      skipIndex >= 0 && statusIndex > skipIndex && skipFocused && enterMovesFocus,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    title: document.title,
    headingCount: heading.length,
    statusRole: status.getAttribute("role"),
    statusLive: status.getAttribute("aria-live"),
    statusReady: status.getAttribute("data-prmonitor-ready"),
    skipIndex,
    statusIndex,
    skipFocused,
    enterMovesFocus,
  };
})()`;

function smokeFailure(reason: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? error.message
      : error === undefined
        ? ""
        : String(error);
  process.stderr.write(
    `PRMONITOR_SMOKE_ERROR:${reason}${detail ? `:${detail}` : ""}\n`,
  );
  if (smokeTimer !== undefined) clearTimeout(smokeTimer);
  app.exit(1);
}

async function runAccessibilityProbe(
  window: BrowserWindow,
): Promise<{ ok: boolean; forcedColors: boolean }> {
  const normal = (await window.webContents.executeJavaScript(
    accessibilityProbe,
    true,
  )) as {
    ok: boolean;
    forcedColors: boolean;
  };
  if (!normal.ok) return normal;
  if (!(await runKeyboardProbe(window))) {
    return { ok: false, forcedColors: false };
  }

  try {
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      {
        features: [{ name: "forced-colors", value: "active" }],
      },
    );
    const forced = (await window.webContents.executeJavaScript(
      accessibilityProbe,
      true,
    )) as { ok: boolean; forcedColors: boolean };
    const forcedKeyboard = await runKeyboardProbe(window);
    await window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      { features: [] },
    );
    window.webContents.debugger.detach();
    if (!forced.ok || !forced.forcedColors || !forcedKeyboard)
      return { ok: false, forcedColors: forced.forcedColors };
  } catch (error) {
    try {
      if (window.webContents.debugger.isAttached())
        window.webContents.debugger.detach();
    } catch {
      // Detaching is best effort after a failed probe; the smoke result remains failed.
    }
    throw new Error(
      `forced-colors probe unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return { ok: true, forcedColors: true };
}

async function runKeyboardProbe(window: BrowserWindow): Promise<boolean> {
  await window.webContents.executeJavaScript(
    `(() => {
      const body = document.body;
      body.setAttribute("tabindex", "-1");
      body.focus();
      body.removeAttribute("tabindex");
    })()`,
    true,
  );
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const tabTarget = (await window.webContents.executeJavaScript(
    `document.activeElement?.classList.contains("skip-link") === true`,
    true,
  )) as boolean;

  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const enterTarget = (await window.webContents.executeJavaScript(
    `document.activeElement?.id === "${STARTUP_STATUS_ID}"`,
    true,
  )) as boolean;
  return tabTarget && enterTarget;
}

async function createWindow(): Promise<void> {
  if (smokeMode && !smokeNonce) {
    smokeFailure("SMOKE_NONCE_MISSING");
    return;
  }

  smokeWindow = new BrowserWindow({
    width: 720,
    height: 480,
    show: !smokeMode,
    title: APPLICATION_TITLE,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadEntry,
    },
  });

  smokeWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      if (smokeMode)
        smokeFailure(`RENDERER_LOAD_FAILED_${errorCode}`, errorDescription);
    },
  );

  smokeWindow.webContents.once("did-finish-load", () => {
    if (!smokeMode || !smokeWindow) return;
    void runAccessibilityProbe(smokeWindow)
      .then((probe) => {
        if (!probe.ok || !probe.forcedColors || smokeReady) {
          smokeFailure("ACCESSIBILITY_PROBE_FAILED");
          return;
        }
        smokeReady = true;
        process.stdout.write(`${SMOKE_READY_PREFIX}${smokeNonce}\n`, () => {
          if (!smokeWindow?.isDestroyed()) smokeWindow?.close();
          app.quit();
        });
      })
      .catch((error: unknown) =>
        smokeFailure("ACCESSIBILITY_PROBE_FAILED", error),
      );
  });

  smokeWindow.on("closed", () => {
    smokeWindow = undefined;
  });

  if (smokeMode) {
    smokeTimer = setTimeout(
      () => smokeFailure("READINESS_TIMEOUT"),
      smokeTimeoutMs,
    );
  }

  await smokeWindow.loadFile(rendererEntry);
}

try {
  configureSmokePaths();
} catch (error) {
  smokeFailure("SMOKE_RUNTIME_PATHS_INVALID", error);
}

async function initializeMainProcessPersistence(): Promise<void> {
  const userDataDirectory = app.getPath("userData");
  persistenceStore = await initializePersistence({
    databasePath: path.join(userDataDirectory, "database", "prmonitor.sqlite"),
    backupRoot: path.join(userDataDirectory, "backups"),
  });
}

app
  .whenReady()
  .then(async () => {
    await initializeMainProcessPersistence();
    await createWindow();
  })
  .catch((error: unknown) => smokeFailure("APP_START_FAILED", error));

app.on("will-quit", () => {
  persistenceStore?.close();
  persistenceStore = undefined;
});

app.on("window-all-closed", () => {
  if (!smokeMode) app.quit();
});
