/* Electron-only acceptance entrypoint. Never launched against real user data. */
const {
  app,
  BrowserWindow,
  session,
  Tray,
  screen,
  ipcMain,
} = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

const root = process.env.PRMONITOR_E2E_ROOT;
const stage = process.env.PRMONITOR_E2E_STAGE;
const evidence = process.env.PRMONITOR_E2E_EVIDENCE;
const network = [];
const forbidden = [];
const startupDiagnostics =
  require("./setup-startup-diagnostics.cjs").observeStartup({
    app,
    root,
    stage,
  });
const ipcAudit = [];
let ioDiagnostics;
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) =>
  registerHandler(channel, async (event, request) => {
    const response = await handler(event, request);
    if (
      [
        "conditional-review",
        "conditional-provider",
        "conditional-f22",
        "conditional-publication",
      ].includes(stage) &&
      request?.type?.startsWith("review-bundle.")
    )
      ipcAudit.push({
        type: request.type,
        ok: response.ok,
        code: response.error?.code,
        outcome: response.value?.outcome,
        reason:
          response.value?.reason?.code ??
          response.value?.publication?.reasons?.[0]?.code ??
          response.value?.workspace?.f22?.reason?.code,
      });
    return response;
  });
const realExit = app.exit.bind(app);
let retryRelaunches = 0;
let retryExits = 0;
let currentStep = "startup";
const timeout = setTimeout(
  () => finish(new Error(`E2E_STAGE_TIMEOUT:${currentStep}`)),
  55000,
);
let finished = false;
let nativeTray, nativeMenu;
const setContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  nativeTray = this;
  nativeMenu = menu;
  startupDiagnostics.note("TRAY_CREATED");
  return setContextMenu.call(this, menu);
};

async function finish(error, assertions = []) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  await fs.writeFile(
    path.join(root, `${stage}.json`),
    JSON.stringify(
      {
        stage,
        ok: !error,
        assertions,
        fixtureRequests: network.length,
        forbiddenEffects: forbidden.length,
        startupDiagnostics: startupDiagnostics.snapshot(),
        ioDiagnostics: ioDiagnostics?.snapshot(),
        error:
          error === undefined ? undefined : `${currentStep}: ${error.message}`,
      },
      null,
      2,
    ),
  );
  realExit(error ? 1 : 0);
}

async function waitFor(operation, label) {
  currentStep = label;
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await operation();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`E2E_WAIT:${label}`);
}

async function start() {
  const marker = JSON.parse(
    await fs.readFile(path.join(root, ".setup-e2e-owner.json"), "utf8"),
  );
  assert.equal(marker.owner, "prmonitor-setup-e2e");
  assert.equal(marker.root, path.resolve(root));
  const userData =
    require("./setup-startup-diagnostics.cjs").userDataDirectoryForStage(
      root,
      stage,
    );
  app.setPath("userData", userData);
  app.setPath("sessionData", path.join(root, "session-data"));
  app.setPath("home", path.join(root, "home"));
  Object.assign(process.env, {
    PRMONITOR_TEST_MODE: "1",
    PRMONITOR_ISOLATED_ROOT: root,
    PRMONITOR_USER_DATA_DIR: userData,
    PRMONITOR_CACHE_DIR: path.join(root, "cache"),
    PRMONITOR_WORKTREE_DIR: path.join(root, "worktrees"),
  });
  if (stage === "lost-auth")
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedSavedReview(userData);
  if (stage === "shell")
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedShell(userData);
  if (stage === "guarded")
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedGuardedWork(userData, root);
  if (["conditional-f22", "conditional-provider"].includes(stage))
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedHeldFinalReview(userData);
  if (stage === "conditional-publication") {
    const fixtures = await import(
      pathToFileURL(path.join(root, "fixtures.mjs")).href
    );
    await fixtures.seedGuardedWork(userData, root, "publication-");
    await fixtures.seedHeldFinalReview(userData);
  }
  if (stage === "conditional-sync") {
    const fixtures = await import(
      pathToFileURL(path.join(root, "fixtures.mjs")).href
    );
    await fixtures.seedGuardedWork(userData, root, "sync-");
    await fixtures.seedConditionalSyncWork(userData, root);
  }
  if (stage === "bootstrap-failure") {
    app.relaunch = () => {
      retryRelaunches++;
    };
    app.exit = () => {
      retryExits++;
    };
  }
  for (const method of [
    "spawn",
    "execFile",
    "exec",
    "spawnSync",
    "execFileSync",
    "execSync",
  ]) {
    const original = childProcess[method];
    childProcess[method] = function (command, ...args) {
      if (
        /codex/i.test(String(command)) ||
        /\b(push|commit)\b/i.test(JSON.stringify(args[0]))
      ) {
        forbidden.push("process-effect");
        throw new Error("E2E_FORBIDDEN_PROCESS_EFFECT");
      }
      const begin = Date.now();
      const work = original.call(this, command, ...args);
      if (/^git(?:\.exe)?$/i.test(path.basename(String(command))))
        startupDiagnostics.trackGit(work, begin);
      return work;
    };
  }
  ioDiagnostics = require("./setup-io-diagnostics.cjs").observeOwnedIo(
    fs,
    require("node:sqlite"),
    root,
  );
  syncBuiltinESMExports();
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, "GET");
    const addFixture =
      stage === "add-success" &&
      /^https:\/\/api\.github\.com\/repos\/fixture\/added\/pulls\/(73|74)$/.test(
        String(url),
      );
    assert.ok(
      addFixture ||
        [
          "https://api.github.com/user",
          "https://github.example.test/api/v3/user",
        ].includes(String(url)),
      "unexpected main network request",
    );
    network.push(addFixture ? "isolated-pr-metadata-read" : "identity-read");
    const repo = {
      id: 173,
      owner: { login: "fixture" },
      name: "added",
      default_branch: "main",
    };
    const response = new Response(
      JSON.stringify(
        addFixture
          ? {
              number: Number(String(url).split("/").at(-1)),
              state: "open",
              merged: false,
              title: "Submitted isolated Add fixture",
              base: { ref: "main", sha: "a".repeat(40), repo },
              head: { ref: "fixture-change", sha: "b".repeat(40), repo },
            }
          : { login: "setup-fixture", name: "Setup fixture" },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
  };
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) {
      forbidden.push("renderer-network");
      callback({ cancel: true });
    } else callback({});
  });
  await import(
    pathToFileURL(
      [
        "conditional-provider",
        "conditional-f22",
        "conditional-publication",
        "conditional-sync",
        "conditional-preferences",
      ].includes(stage)
        ? path.join(root, "controlled-app/main/index.cjs")
        : path.join(__dirname, "../apps/desktop/out/main/index.js"),
    ).href
  );
  let window = await waitFor(
    () => BrowserWindow.getAllWindows().find((item) => !item.isDestroyed()),
    "window",
  );
  if (["retained-restart", "conditional-settings"].includes(stage)) {
    assert.ok(
      startupDiagnostics.snapshot().git.started < 30,
      "global worktree recovery must not repeat its full Git scan for every managed PR",
    );
  }
  window.setSize(1280, 1100);
  window.webContents.setZoomFactor(1);
  const evaluate = (code) => {
    try {
      return Promise.race([
        window.webContents.executeJavaScript(code, true),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error(`E2E_RENDERER_TIMEOUT:${currentStep}`)),
            3000,
          ),
        ),
      ]).catch((error) => {
        throw Error(
          `E2E_RENDERER:${currentStep}:${code.slice(0, 160)}:${error.message}`,
        );
      });
    } catch (error) {
      return Promise.reject(
        Error(`E2E_RENDERER_DESTROYED:${currentStep}:${error.message}`),
      );
    }
  };
  await waitFor(
    async () =>
      evaluate(
        "Boolean(window.prmonitor && document.querySelector('main'))",
      ).catch(() => false),
    "renderer",
  );
  await evaluate(`(() => {
    window.__setupObservedInbox = false;
    const inspect = () => {
      const element = [...document.querySelectorAll('*')].find(item => item.childElementCount === 0 && item.textContent === 'No pull requests yet');
      if (element && element.getClientRects().length && !element.closest('[hidden]')) window.__setupObservedInbox = true;
    };
    new MutationObserver(inspect).observe(document.body, {childList:true, subtree:true, attributes:true}); inspect();
  })()`);
  const readiness = () =>
    evaluate(
      "window.prmonitor.readSetupReadiness().then(r => r.ok ? r.value.projection : null)",
    );
  const visible = (text) =>
    evaluate(
      ` [...document.querySelectorAll('*')].some(e => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(text)} && e.getClientRects().length > 0 && !e.closest('[hidden]')) `,
    );
  const click = async (text) => {
    await waitFor(
      () =>
        evaluate(
          `[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.closest('[hidden]')&&!e.disabled)`,
        ),
      `enabled control ${text}`,
    );
    return evaluate(
      `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && !e.closest('[hidden]')); if(!b || b.disabled) throw Error('E2E_BUTTON_UNAVAILABLE'); b.click(); })()`,
    );
  };
  const capture = async (name) => {
    await evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fs.writeFile(
      path.join(evidence, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  };
  const setField = (selector, value) =>
    evaluate(
      `(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('E2E_FIELD_MISSING');const type=input.tagName==='TEXTAREA'?HTMLTextAreaElement:input.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  const openTarget = (kind, id) =>
    window.webContents.send("prmonitor:ipc:v1:event", {
      schemaVersion: 1,
      type: "open-target",
      target: {
        schemaVersion: 1,
        kind,
        ...(id === undefined ? {} : { id }),
        requestId: `route-e2e-${Date.now().toString(36)}`,
      },
    });
  const assertions = [];
  const reviewPane = async (label) => {
    await waitFor(
      () =>
        evaluate(
          `(()=>{const b=[...document.querySelectorAll('.review-bundle-workspace .workspace-panes button')].find(b=>!b.closest('[hidden]')&&b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);if(!b)return false;b.click();return true;})()`,
        ),
      `enabled workspace pane ${label}`,
    );
    await waitFor(
      () =>
        evaluate(
          `[...document.querySelectorAll('.workspace-panes button')].some(b=>!b.closest('[hidden]')&&b.textContent.trim()===${JSON.stringify(label)}&&b.getAttribute('aria-pressed')==='true')`,
        ),
      `conditional pane ${label}`,
    );
  };
  assertions.push(
    `native display scale factor ${screen.getDisplayMatching(window.getBounds()).scaleFactor}; browser zoom ${window.webContents.getZoomFactor()}; physical Windows DPI/text scaling and screen-reader interaction are not simulated`,
  );
  const read = await waitFor(readiness, "projection");
  if (
    [
      "fresh",
      "partial",
      "lost-auth",
      "bootstrap-failure",
      "bootstrap-fixed",
    ].includes(stage)
  ) {
    assert.equal(read.ready, false);
    await waitFor(() => visible("Set up PRMonitor"), "setup landing");
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('.setup-screen')?.getAttribute('aria-busy') === 'false'",
        ),
      "setup loading settles",
    );
    assert.equal(
      await evaluate("window.__setupObservedInbox"),
      false,
      "incomplete startup exposed ready inbox",
    );
    assertions.push(
      "incomplete startup lands on setup; observed renderer never exposes ready inbox",
    );
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('#setup-heading') === document.activeElement",
        ),
      "setup heading focus",
    );
    assert.equal(
      await evaluate(
        "Boolean(document.querySelector('.setup-screen [aria-live=polite]'))",
      ),
      true,
    );
    const firstMissing =
      read.checks.find((c) => c.id === "github-access")?.status !== "complete"
        ? "1. GitHub"
        : read.checks.some(
              (c) =>
                ["ai-access", "ai-task-configuration"].includes(c.id) &&
                c.status !== "complete",
            )
          ? "2. AI connection"
          : read.checks.find((c) => c.id === "working-policy")?.status !==
              "complete"
            ? "3. Work permissions"
            : "4. Review and finish";
    assert.equal(
      await evaluate(
        "document.querySelector('.setup-steps [aria-current=step]').textContent.trim()",
      ),
      firstMissing,
    );
    await click("4. Review and finish");
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Finish setup'&&!b.closest('[hidden]')).disabled",
      ),
      true,
    );
    assert.ok(
      await visible(
        "Finish becomes available when every saved setup check passes.",
      ),
    );
    assertions.push(
      "setup heading receives focus; statuses are live; incomplete inbox action is disabled",
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await waitFor(
      () =>
        evaluate(
          "document.activeElement.tagName === 'BUTTON' && document.activeElement.textContent.trim().length > 0",
        ),
      "Tab focus control",
    );
    await evaluate("document.querySelector('#setup-heading').focus()");
    assertions.push(
      "Tab reaches a labeled actionable control from the setup heading",
    );
  }
  const preferences = () =>
    evaluate(
      "window.prmonitor.readPreferences().then(r=> {if(!r.ok)throw Error(r.error.message);return r.value.preferences})",
    );
  if (stage === "shell") {
    assert.equal(read.ready, true);
    await waitFor(
      () => evaluate("document.querySelectorAll('.inbox-card').length === 20"),
      "twenty real PR rows",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.preferences-panel, .activity-viewer, .connection-status, .server-form')].some(e=>!e.closest('[hidden]'))",
      ),
      false,
    );
    await evaluate("document.querySelector('.inbox-inspect').click()");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('#selected-pr-heading'))"),
      "selected exact PR details",
    );
    const selected = await evaluate(
      "document.querySelector('#selected-pr-heading').textContent",
    );
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.inbox-card input:checked').length",
      ),
      0,
    );
    if (await visible("Reset branch sync selection")) {
      await click("Reset branch sync selection");
      await waitFor(
        async () => !(await visible("Reset branch sync selection")),
        "current branch sync selection",
      );
    }
    await evaluate("document.querySelector('.inbox-card input').click()");
    await waitFor(
      () =>
        evaluate(
          "document.querySelectorAll('.inbox-card input:checked').length === 1",
        ),
      "independent sync selection",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#selected-pr-heading').textContent",
      ),
      selected,
    );
    const selectionBeforeFilter = await evaluate(
      "window.prmonitor.readSynchronizationSelection().then(r=>r.value.selection.selectedManagedPrIds)",
    );
    for (const filter of ["Needs attention", "Running"]) {
      await click(filter);
      assert.deepEqual(
        await evaluate(
          "window.prmonitor.readSynchronizationSelection().then(r=>r.value.selection.selectedManagedPrIds)",
        ),
        selectionBeforeFilter,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('#selected-pr-heading').textContent",
        ),
        selected,
      );
    }
    await click("Select all");
    await waitFor(
      () =>
        evaluate(
          "window.prmonitor.readSynchronizationSelection().then(r=>r.value.selection.selectedCount===20)",
        ),
      "Select all includes filtered-out PRs",
    );
    await click("All PRs");
    await waitFor(
      () =>
        evaluate(
          "document.querySelectorAll('.inbox-card input:checked').length === 20",
        ),
      "select all PRs",
    );
    await click("Clear");
    await waitFor(
      () =>
        evaluate(
          "document.querySelectorAll('.inbox-card input:checked').length === 0",
        ),
      "clear sync selection",
    );
    await click("PR settings");
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea'))",
        ),
      "exact PR configuration",
    );
    await evaluate(
      `(()=>{const input=document.querySelector('form[aria-label="Edit pull request configuration"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Unsaved PR context survives navigation.');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click("Activity");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('.activity-viewer'))"),
      "PR activity",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.activity-entry-heading h3')].some(element=>element.textContent === 'PRMonitor started.')",
      ),
      false,
    );
    await evaluate(
      "(()=>{const select=document.querySelector('.activity-viewer select');select.value='APPLICATION';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await waitFor(
      () => evaluate("document.querySelectorAll('.activity-entry').length > 0"),
      "real application diagnostics",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.activity-viewer').textContent.includes('PRMonitor started.')",
      ),
      true,
    );
    await capture("activity-application-diagnostics");
    await click("PRs");
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea')?.value === 'Unsaved PR context survives navigation.'",
        ),
      "unsaved PR context retained",
    );
    const inspectedId = await evaluate(
      "window.prmonitor.readManagedPrs().then(r=>r.value.value.managedPrs.find(p=>document.querySelector('.pr-detail-heading p').textContent===p.owner+'/'+p.repositoryName+' #'+p.number).id)",
    );
    for (const back of ["Back to PR inbox", "PRs"]) {
      await click("Add PR");
      await waitFor(
        () =>
          evaluate(
            "Boolean(document.querySelector('form[aria-label=\"Add a pull request\"]'))",
          ),
        "Add draft screen",
      );
      await evaluate(
        "document.querySelector('.optional-pr-settings').open=true",
      );
      await setField(
        'form[aria-label="Add a pull request"] textarea',
        "Independent Add context",
      );
      await click(back);
      await waitFor(
        () =>
          evaluate(
            "Boolean(document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea'))",
          ),
        "existing PR settings after Add",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea').value",
        ),
        "Unsaved PR context survives navigation.",
      );
      await click("Save new configuration revision");
      await waitFor(
        () =>
          evaluate(
            `window.prmonitor.readManagedPr(${JSON.stringify(inspectedId)}).then(r=>r.ok&&r.value.managedPr.configuration.context==='Unsaved PR context survives navigation.')`,
          ),
        "correct persisted PR context",
      );
      await click("Add PR");
      await waitFor(
        () =>
          evaluate(
            "document.querySelector('form[aria-label=\"Add a pull request\"] textarea')?.value==='Independent Add context'",
          ),
        "Add draft remains independent",
      );
      await click("Back to PR inbox");
    }
    assertions.push(
      "existing PR edit → independent Add draft → Back and sidebar Inbox → Save writes only the existing PR draft; Add draft remains intact",
    );
    await click("Overview");
    for (const [width, height, zoom, name] of [
      [1280, 800, 1, "shell-desktop-1280"],
      [1024, 768, 1, "shell-desktop-1024"],
      [900, 650, 1, "shell-narrow-900"],
      [320, 800, 1, "shell-narrow-320"],
      [900, 650, 2, "shell-200-percent"],
    ]) {
      window.webContents.setZoomFactor(zoom);
      window.setContentSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await evaluate(
          "document.documentElement.scrollWidth <= innerWidth + 1",
        ),
        true,
        `${name} horizontal clipping`,
      );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('.pr-detail-heading button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1;})",
        ),
        true,
        `${name} detail tabs clipped`,
      );
      if (width < 1000 || zoom > 1) {
        for (const label of [
          "Overview",
          "Review",
          "Branch sync",
          "Activity",
          "PR settings",
        ]) {
          assert.equal(
            await evaluate(
              `(()=>{const button=[...document.querySelectorAll('.pr-detail-heading button')].find(button=>button.textContent.trim()===${JSON.stringify(label)});button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return r.top>=main.top && r.bottom<=main.bottom;})()`,
            ),
            true,
            `${name}: ${label} is vertically reachable`,
          );
        }
      }
      await capture(name);
    }
    window.webContents.setZoomFactor(1);
    window.setContentSize(1280, 800);
    await evaluate(
      "document.querySelector('.pr-detail [role=tab][aria-selected=true]').focus()",
    );
    for (const [key, expected] of [
      ["Home", "Overview"],
      ["Right", "Review"],
      ["End", "PR settings"],
      ["Left", "Activity"],
      ["Home", "Overview"],
    ]) {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
      await waitFor(
        () =>
          evaluate(
            `document.activeElement.getAttribute('role')==='tab'&&document.activeElement.textContent.trim()===${JSON.stringify(expected)}&&document.activeElement.getAttribute('aria-selected')==='true'`,
          ),
        `native detail keyboard ${key}`,
      );
    }
    assertions.push(
      "native Home/End/arrow keys move selected detail tabs and keyboard focus together; tablist/tabpanel expose selection and relationships",
    );
    await evaluate("document.querySelector('.inbox-inspect').focus()");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    assert.equal(await evaluate("document.activeElement.tagName"), "BUTTON");
    await window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "forced-colors", value: "active" }] },
    );
    await capture("shell-forced-colors");
    window.webContents.debugger.detach();
    // The public prototype uses inline iframe scripts. Keep it out of the
    // production session, whose file-response CSP correctly rejects them.
    // This nonpersistent session still belongs to the owned session-data root.
    const referenceSession = session.fromPartition("approved-reference");
    const optionalReferenceScripts = new Set([
      "https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js",
      "https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js",
      "https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js",
    ]);
    let blockedReferenceScripts = 0;
    referenceSession.webRequest.onBeforeRequest((details, callback) => {
      if (/^https?:/i.test(details.url)) {
        if (optionalReferenceScripts.has(details.url))
          blockedReferenceScripts++;
        else forbidden.push("reference-network");
        callback({ cancel: true });
      } else callback({});
    });
    const reference = new BrowserWindow({
      show: true,
      width: 1280,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        session: referenceSession,
      },
    });
    await reference.loadFile(path.join(root, "approved-preview.html"));
    const referenceFrame = await waitFor(async () => {
      for (const frame of reference.webContents.mainFrame.frames) {
        if (
          await frame
            .executeJavaScript(
              "document.readyState === 'complete' && document.body.innerText.includes('PR inbox')",
            )
            .catch(() => false)
        )
          return frame;
      }
      return null;
    }, "approved-reference-content");
    await referenceFrame.executeJavaScript(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fs.writeFile(
      path.join(evidence, "approved-reference-1280.png"),
      (await reference.webContents.capturePage()).toPNG(),
    );
    reference.destroy();
    assertions.push(
      `exact approved reference painted in a separate nonpersistent session; ${blockedReferenceScripts} known optional public prototype scripts blocked before network; product CSP unchanged`,
    );
    assertions.push(
      "twenty persisted PRs use independent inspection/sync selection; select-all/clear retain inspected PR; PR draft survives Activity navigation; genuine PR/application Activity views; desktop 1280/1024, narrow 900/320, Chromium 200% zoom have no whole-page horizontal overflow and unclipped detail tabs; native Tab and emulated forced colors captured",
    );
  }
  if (stage === "bootstrap-failure") {
    assert.equal(
      read.checks.find((c) => c.id === "local-prerequisites").status,
      "incomplete",
    );
    const blocked = path.join(userData, "database");
    assert.equal(
      await fs.readFile(blocked, "utf8"),
      "setup-e2e-owned-path-obstruction",
    );
    await readiness();
    await readiness();
    assert.equal(
      retryRelaunches,
      0,
      "ordinary readiness reads must not relaunch",
    );
    await capture("bootstrap-failure");
    await evaluate(
      "Promise.all([window.prmonitor.retrySetupReadiness(),window.prmonitor.retrySetupReadiness()])",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(retryRelaunches, 1);
    assert.equal(retryExits, 1);
    assert.equal(
      await fs.readFile(blocked, "utf8"),
      "setup-e2e-owned-path-obstruction",
    );
    assert.equal(network.length, 0);
    assertions.push(
      "initialization failure exposes setup; ordinary reads never relaunch; explicit duplicate Retry coalesces; obstruction bytes remain intact; no domain network started",
    );
  }
  if (stage === "bootstrap-fixed") {
    assert.equal(
      read.checks.find((c) => c.id === "local-prerequisites").status,
      "complete",
    );
    await capture("bootstrap-remediated");
    assertions.push(
      "after external repair of the owned obstruction, fresh process starts normally and recomputes incomplete configuration",
    );
  }
  const saveProfiles = async (count) => {
    let value = await preferences();
    for (const existing of value.taskProfiles.slice(0, count)) {
      if (existing.enabled) continue;
      const input = {
        expectedSettingsRevision: value.settingsRevision,
        profile: {
          taskType: existing.taskType,
          providerId: "codex",
          modelId: "gpt-5-codex",
          providerOptions: {},
          enabled: true,
        },
      };
      const result = await evaluate(
        `window.prmonitor.saveTaskProfile(${JSON.stringify(input)})`,
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      value = result.value.preferences;
    }
    return value;
  };
  if (stage === "fresh") {
    assert.ok(read.checks.filter((c) => c.status !== "complete").length >= 3);
    assert.ok(await visible("Add or test GitHub server"));
    assert.ok(await visible("Edit independent task profiles"));
    assert.ok(
      await evaluate(
        "document.querySelector('.setup-screen').textContent.includes('Optional: add a PR')",
      ),
    );
    await capture("fresh-install");
    window.setSize(720, 900);
    window.webContents.setZoomFactor(1.25);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(
      await evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth + 1",
      ),
      true,
      "narrow scaled page has horizontal clipping",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.setup-screen button')].every(b=> {const r=b.getBoundingClientRect();return r.left>=0 && r.right <= innerWidth+1})",
      ),
      true,
    );
    await capture("fresh-narrow-125-percent");
    await evaluate(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Finish setup').scrollIntoView({block:'center'})",
    );
    await capture("fresh-narrow-125-percent-actions");
    assertions.push(
      "fresh setup exposes remediation, optional PR guidance, and unclipped actions at narrow 125% zoom",
    );
    const value = await saveProfiles(1);
    assert.equal(value.taskProfiles.filter((p) => p.enabled).length, 1);
    assertions.push("one task profile committed before shutdown");
    currentStep = "close window";
    window.close();
    await waitFor(
      () => window.isDestroyed() || !window.isVisible(),
      "close hides or destroys view",
    );
    currentStep = "activate window";
    await new Promise((resolve) => setTimeout(resolve, 250));
    app.emit("activate");
    window = await waitFor(
      () =>
        BrowserWindow.getAllWindows().find(
          (w) =>
            !w.isDestroyed() && !w.webContents.isDestroyed() && w.isVisible(),
        ),
      "reopened view",
    );
    currentStep = "reopened renderer setup";
    await waitFor(
      () => visible("Set up PRMonitor").catch(() => false),
      "incomplete reopen setup",
    );
    currentStep = "reopened committed preferences";
    assert.equal(
      (await preferences()).taskProfiles.filter((p) => p.enabled).length,
      1,
    );
    assertions.push(
      "closing and activating the production window resumes setup with only committed progress",
    );
  }
  if (stage === "partial") {
    assert.equal(
      (await preferences()).taskProfiles.filter((p) => p.enabled).length,
      1,
    );
    await capture("restart-midway");
    assertions.push("cold restart retains committed profile and resumes setup");
    await saveProfiles(4);
    for (const serverUrl of [
      "https://github.com",
      "https://github.example.test",
    ]) {
      const response = await evaluate(
        `window.prmonitor.upsertGithubProfile(${JSON.stringify({ displayName: serverUrl.endsWith(".test") ? "GHES fixture" : "GitHub fixture", serverUrl })})`,
      );
      assert.equal(response.ok, true, JSON.stringify(response));
      const result = await evaluate(
        `window.prmonitor.submitGithubCredential(${JSON.stringify(response.value.profile.id)}, 'setup-e2e-fixture-token')`,
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    await waitFor(
      async () => (await readiness())?.ready,
      "all checks complete",
    );
    await click("Check saved setup");
    await click("4. Review and finish");
    await waitFor(
      async () =>
        evaluate(
          "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Finish setup'&&!b.disabled&&!b.closest('[hidden]'))",
        ),
      "open inbox enabled",
    );
    await click("Finish setup");
    await waitFor(() => visible("No pull requests yet"), "empty inbox");
    assert.ok(await visible("Add PR"));
    await capture("completed-empty-inbox");
    assertions.push(
      "GitHub.com and GHES identity fixtures, four independent persisted profiles, and local auth complete all checks; zero PRs allows inbox",
    );
  }
  if (stage === "guarded") {
    const saved = await evaluate(
      "window.prmonitor.readSynchronizationResult('guarded-sync-1')",
    );
    assert.equal(saved.value.result.conflictResolution.usage.tokens, 26);
    assert.equal(saved.value.result.conflictResolution.usage.inputTokens, 17);
    assert.equal(saved.value.result.conflictResolution.usage.outputTokens, 9);
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-1");
    const activeSync = async (id, version) => {
      await evaluate(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
      return evaluate(
        `Boolean(document.querySelector('.synchronization-result-card[data-sync-operation="${id}"]${version === undefined ? "" : `[data-sync-source-version="${version}"]`}'))`,
      );
    };
    await waitFor(
      () => activeSync("guarded-sync-1", 1),
      "exact saved result A",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Submit answer')?.disabled",
      ),
      true,
    );
    await setField(
      ".synchronization-conflict-review textarea",
      "Answer retained for result A",
    );
    await evaluate(
      "[...document.querySelectorAll('.synchronization-result-list button')].find(b=>b.textContent.includes('Result 2 needs')).click()",
    );
    await waitFor(
      () => activeSync("guarded-sync-2", 1),
      "result B navigation owns root target",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.synchronization-conflict-review textarea').value",
      ),
      "",
    );
    await setField(
      ".synchronization-conflict-review textarea",
      "Answer retained for result B",
    );
    await click("Activity");
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-1");
    await waitFor(
      () => activeSync("guarded-sync-1", 1),
      "explicit A after internal B",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.synchronization-conflict-review textarea').value",
      ),
      "Answer retained for result A",
    );
    await click("Activity");
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).advanceGuardedResult(userData);
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-1");
    await waitFor(
      () => activeSync("guarded-sync-1", 2),
      "saved result advanced while away",
    );
    assert.equal(
      (
        await evaluate(
          "window.prmonitor.readSynchronizationResult('guarded-sync-1')",
        )
      ).value.result.reason.what,
      "Saved result updated while away.",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.synchronization-conflict-review textarea').value",
      ),
      "Answer retained for result A",
    );
    await capture("guarded-sync-saved-result");
    const publish = await evaluate(
      "window.prmonitor.publishSynchronizationPublication({operationId:'guarded-sync-1',idempotencyKey:'unapproved-native-publication'})",
    );
    assert.equal(publish.ok, false, JSON.stringify(publish));
    assertions.push(
      "exact A/B result navigation isolates answer drafts; returning rereads a changed saved result; empty answers and unapproved publication remain guarded",
    );
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await waitFor(
      () => visible("Guarded final review with complete saved changes"),
      "saved final review",
    );
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedConditionalGate(userData, "guarded-final-review");
    await click("Activity");
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await waitFor(
      () => visible("Guarded final review with complete saved changes"),
      "historical registered final gate rehydrated",
    );
    const finalWorkspace = () =>
      evaluate(
        "window.prmonitor.readReviewBundle('guarded-final-review').then(r=>r.value.workspace)",
      );
    const beforeDraft = await finalWorkspace();
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('[aria-labelledby=\"review-response-heading\"] textarea'))",
        ),
      "final response editor",
    );
    const responseSelector =
      '[aria-labelledby="review-response-heading"] textarea';
    await setField(responseSelector, "");
    await click("Save response draft");
    await waitFor(
      () => visible("A response draft cannot be empty."),
      "empty final draft refused",
    );
    assert.equal((await finalWorkspace()).version, beforeDraft.version);
    await setField(
      responseSelector,
      "Saved owned final-review reply. No response was posted.",
    );
    await click("Save response draft");
    await waitFor(
      async () =>
        (await finalWorkspace()).items[0].responseDraft ===
        "Saved owned final-review reply. No response was posted.",
      "final draft saved through owning service",
    );
    assert.ok((await finalWorkspace()).version > beforeDraft.version);
    await click("Activity");
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await waitFor(
      () =>
        evaluate(
          `document.querySelector(${JSON.stringify(responseSelector)})?.value==='Saved owned final-review reply. No response was posted.'`,
        ),
      "committed final draft rehydrated after navigation",
    );
    assertions.push(
      "final-review empty draft guard preserves version; nonempty response draft persists through real IPC and rehydrates after navigation without posting",
    );
    await click("Files and changes");
    await click("Refresh evidence");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('.review-condition'))"),
      "fresh real worktree condition",
    );
    await click("Proposed Worktree Diff");
    const actualDiff = await evaluate(
      "window.prmonitor.readReviewBundleDiff('guarded-final-review','PROPOSED_WORKTREE')",
    );
    assert.ok(actualDiff.ok, JSON.stringify(actualDiff));
    assert.ok(
      actualDiff.value.diff?.files?.length > 0,
      JSON.stringify({
        diff: actualDiff,
        operation: (
          await (
            await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
          ).readRetainedWork(userData)
        ).worktree,
      }),
    );
    await waitFor(
      () =>
        evaluate(
          "document.querySelectorAll('.review-diff-line-text').length >= 600",
        ),
      "complete local proposed diff",
    );
    assert.ok(
      await evaluate(
        "[...document.querySelectorAll('.review-diff-line-text')].some(e=>e.textContent.includes('changed299'))",
      ),
    );
    await evaluate(
      "document.querySelector('.review-diff-panel').scrollIntoView({block:'start'})",
    );
    await capture("guarded-review-complete-diff");
    for (const pane of [
      "Review",
      "Conversation and revisions",
      "Validation and instructions",
      "Discard and re-evaluate",
      "Publication",
    ]) {
      await evaluate(
        `[...document.querySelectorAll('.workspace-panes button')].find(b=>b.textContent.trim()===${JSON.stringify(pane)}).click()`,
      );
      await waitFor(
        () =>
          evaluate(
            `[...document.querySelectorAll('.workspace-panes button')].some(b=>b.textContent.trim()===${JSON.stringify(pane)}&&b.getAttribute('aria-pressed')==='true')`,
          ),
        `review pane ${pane}`,
      );
    }
    await capture("guarded-review-publication");
    const reviewPublish = await evaluate(
      "window.prmonitor.publishReviewBundlePublication({bundleId:'guarded-final-review',idempotencyKey:'unapproved-native-review-publication'})",
    );
    assert.equal(reviewPublish.ok, true, JSON.stringify(reviewPublish));
    assert.equal(reviewPublish.value.publication.status, "BLOCKED");
    assert.equal(reviewPublish.value.publication.canPublish, false);
    assert.equal(
      reviewPublish.value.publication.reasons[0].code,
      "PUBLICATION_INTENT_NOT_FOUND",
    );
    assertions.push(
      "real owned Git worktree renders all 600 changed lines including the final line; six saved review panes remain reachable; publication without approval is rejected by the production service",
    );
    for (const kind of [
      "REVIEW_BUNDLE",
      "SYNCHRONIZATION_RESULT",
      "SYNCHRONIZATION_BATCH",
      "MANAGED_PR",
      "MANAGED_PR_SETTINGS",
    ]) {
      openTarget(kind, "missing-guarded-target");
      await waitFor(
        () =>
          evaluate(
            "[...document.querySelectorAll('[role=alert],.empty-state')].some(e=>!e.closest('[hidden]')&&/unavailable|not found|could not|cannot|does not exist/i.test(e.textContent))",
          ),
        `missing ${kind}`,
      );
      assert.equal(
        await evaluate(
          "Boolean(document.querySelector('.synchronization-result-card'))",
        ),
        false,
      );
    }
    assertions.push(
      "missing review, sync result/batch and PR/settings targets produce explicit unavailable states without selecting unrelated saved work",
    );
  }
  if (stage === "lifecycle") {
    const fixtures = await import(
      pathToFileURL(path.join(root, "fixtures.mjs")).href
    );
    const before = await fixtures.readRetainedWork(userData);
    assert.ok(
      before.reviews.some((r) => r.bundleId === "guarded-final-review"),
    );
    assert.ok(nativeTray && !nativeTray.isDestroyed());
    window.close();
    await waitFor(
      () => BrowserWindow.getAllWindows().length === 0,
      "native close keeps tray process",
    );
    assert.equal(nativeTray.isDestroyed(), false);
    const open = nativeMenu.items.find(
      (item) => item.label === "Open PRMonitor",
    );
    assert.ok(open?.enabled);
    open.click(open, undefined, {});
    window = await waitFor(
      () => BrowserWindow.getAllWindows().find((item) => !item.isDestroyed()),
      "native tray opens window",
    );
    await waitFor(
      () => visible("PR inbox").catch(() => false),
      "tray reopened renderer",
    );
    const afterOpen = await fixtures.readRetainedWork(userData);
    assert.deepEqual(afterOpen.reviews, before.reviews);
    assert.deepEqual(afterOpen.results, before.results);
    app.setAccessibilitySupportEnabled(true);
    window.webContents.debugger.attach("1.3");
    const ax = await window.webContents.debugger.sendCommand(
      "Accessibility.getFullAXTree",
    );
    assert.ok(
      ax.nodes.some(
        (node) =>
          node.role?.value === "button" && node.name?.value === "Settings",
      ),
    );
    assert.ok(ax.nodes.some((node) => node.role?.value === "heading"));
    window.webContents.debugger.detach();
    assertions.push(
      "real Electron tray menu callback reopens a closed window; saved review/sync records remain byte-equivalent; native accessibility tree exposes named controls and headings (no physical screen-reader claim)",
    );
    const ordinaryQuit = app.quit.bind(app);
    let quitRequested = false;
    app.quit = () => {
      quitRequested = true;
    };
    const shutdown = nativeMenu.items.find(
      (item) => item.label === "Shutdown PRMonitor",
    );
    assert.ok(shutdown?.enabled);
    shutdown.click(shutdown, undefined, {});
    await waitFor(() => {
      const state = startupDiagnostics.snapshot().lifecycle;
      if (
        state.phase === "RECOVERY_REQUIRED" ||
        state.shutdown === "RECOVERY_REQUIRED"
      )
        throw Error(`NATIVE_SHUTDOWN_RECOVERY:${JSON.stringify(state)}`);
      return quitRequested;
    }, "native shutdown completed before quit");
    assert.equal(nativeTray.isDestroyed(), true);
    const after = await fixtures.readRetainedWork(userData);
    assert.equal(after.shutdown.state, "COMPLETED");
    assert.deepEqual(after.reviews, before.reviews);
    assert.deepEqual(after.results, before.results);
    await fs.writeFile(
      path.join(root, "retained-work.json"),
      JSON.stringify({ reviews: after.reviews, results: after.results }),
    );
    assertions.push(
      "native Shutdown callback persists COMPLETED before removing its tray and requesting ordinary app quit; all saved review and synchronization records survive",
    );
    assert.equal(forbidden.length, 0);
    finished = true;
    clearTimeout(timeout);
    await fs.writeFile(
      path.join(root, `${stage}.json`),
      JSON.stringify(
        {
          stage,
          ok: true,
          assertions,
          fixtureRequests: network.length,
          forbiddenEffects: forbidden.length,
          startupDiagnostics: startupDiagnostics.snapshot(),
        },
        null,
        2,
      ),
    );
    app.quit = ordinaryQuit;
    ordinaryQuit();
    return;
  }
  if (stage === "settings") {
    await click("Settings");
    const category = async (label) => {
      await evaluate(
        `[...document.querySelectorAll('.settings-categories button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
      await evaluate(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
    };
    await category("AI connections");
    await evaluate(
      "[...document.querySelectorAll('summary')].find(e=>e.textContent.trim()==='Advanced task choices').parentElement.open=true",
    );
    await waitFor(
      () =>
        evaluate("Boolean(document.querySelector('.preference-card input'))"),
      "native task editor",
    );
    const task = async (id) => {
      await evaluate(
        `(()=>{const s=document.querySelector('.preference-grid select');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await evaluate("new Promise(resolve=>requestAnimationFrame(resolve))");
    };
    const values = await preferences();
    const modelSelector =
      ".preference-card .preferences-form label:nth-child(3) select";
    const draftReasoning = (profile) =>
      profile.reasoningEffort === "high" ? "low" : "high";
    for (const profile of values.taskProfiles) {
      await task(profile.taskType);
      await setField(
        ".preference-card .preferences-form label:nth-child(2) select",
        "gpt-6-astra",
      );
      await setField(modelSelector, draftReasoning(profile));
    }
    for (const label of [
      "Work permissions",
      "Monitoring and work limits",
      "Common instructions",
      "Repository build and validation",
      "Support diagnostics",
      "GitHub connections",
    ]) {
      await category(label);
      assert.ok(
        await evaluate(
          "[...document.querySelectorAll('.settings-categories button')].some(b=>b.getAttribute('aria-pressed')==='true')",
        ),
      );
    }
    await setField('input[type="password"]', "unsaved-nonsecret-fixture");
    await click("Activity");
    await click("Settings");
    await category("GitHub connections");
    assert.equal(
      await evaluate(
        "document.querySelector('input[type=\"password\"]').value",
      ),
      "",
    );
    await category("AI connections");
    for (const profile of values.taskProfiles) {
      await task(profile.taskType);
      assert.equal(
        await evaluate(
          `document.querySelector(${JSON.stringify(modelSelector)}).value`,
        ),
        draftReasoning(profile),
      );
    }
    const first = values.taskProfiles[0];
    await task(first.taskType);
    await click("Discard task draft");
    assert.equal(
      await evaluate(
        `document.querySelector(${JSON.stringify(modelSelector)}).value`,
      ),
      first.reasoningEffort ?? "",
    );
    await setField(
      ".preference-card .preferences-form label:nth-child(2) select",
      "gpt-6-astra",
    );
    await setField(modelSelector, draftReasoning(first));
    await click("Save task profile");
    await waitFor(
      async () =>
        (await preferences()).taskProfiles.find(
          (p) => p.taskType === first.taskType,
        ).revision > first.revision,
      "native task save commits only selected profile",
    );
    for (const profile of values.taskProfiles.slice(1)) {
      await task(profile.taskType);
      assert.equal(
        await evaluate(
          `document.querySelector(${JSON.stringify(modelSelector)}).value`,
        ),
        draftReasoning(profile),
      );
      assert.equal(
        (await preferences()).taskProfiles.find(
          (p) => p.taskType === profile.taskType,
        ).revision,
        profile.revision,
      );
    }
    await capture("settings-independent-task-drafts");
    await task(first.taskType);
    assert.equal(
      await evaluate(
        "Boolean(document.querySelector('.preference-card .preferences-form textarea'))",
      ),
      false,
    );
    const beforeInvalidOptions = await preferences();
    const current = beforeInvalidOptions.taskProfiles.find(
      (profile) => profile.taskType === first.taskType,
    );
    const rejected = await evaluate(
      `window.prmonitor.saveTaskProfile(${JSON.stringify({ expectedSettingsRevision: beforeInvalidOptions.settingsRevision, profile: { taskType: current.taskType, providerId: current.providerId, modelId: current.modelId, enabled: current.enabled, providerOptions: [] } })})`,
    );
    assert.equal(rejected.ok, false);
    assert.deepEqual(await preferences(), beforeInvalidOptions);
    assertions.push(
      "supported model/reasoning controls replace ignored provider JSON; malformed typed options leave every saved profile and revision unchanged",
    );
    assertions.push(
      "all four task drafts survive category and destination navigation; discard/save affects only the selected task; other saved revisions remain unchanged; leaving GitHub settings clears the unsaved credential field",
    );
  }
  if (stage === "retained-restart") {
    const previous = JSON.parse(
      await fs.readFile(path.join(root, "retained-work.json"), "utf8"),
    );
    const saved = await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).readRetainedWork(userData);
    assert.deepEqual(saved.reviews, previous.reviews);
    assert.deepEqual(saved.results, previous.results);
    await waitFor(() => visible("PR inbox"), "ordinary retained restart");
    assertions.push(
      "cold restart after actual native Shutdown preserves saved review and synchronization records",
    );
  }
  if (stage === "publication-uncertain") {
    const before = await evaluate(
      "window.prmonitor.readReviewBundlePublication('guarded-final-review')",
    );
    assert.ok(before.ok && before.value.publication.candidate);
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedUncertainPublication(userData, before.value.publication.candidate);
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await waitFor(
      () => visible("Guarded final review with complete saved changes"),
      "historical uncertain review",
    );
    await evaluate(
      "[...document.querySelectorAll('.workspace-panes button')].find(b=>b.textContent.trim()==='Publication').click()",
    );
    await waitFor(
      () => visible("Reconcile publication state"),
      "uncertain publication recovery control",
    );
    assert.equal(await visible("Publish approved Review Bundle"), false);
    assert.equal(await visible("Approve exact publication"), false);
    const read = await evaluate(
      "window.prmonitor.readReviewBundlePublication('guarded-final-review')",
    );
    assert.equal(read.value.publication.status, "RECOVERING");
    assert.equal(read.value.publication.canPublish, false);
    assert.equal(read.value.publication.canReconcile, true);
    await capture("guarded-publication-uncertain");
    assertions.push(
      "historical approval plus uncertain outcome rehydrates through real persistence; native review exposes reconciliation and withholds approve/publish; opening the target causes no repeated external effect",
    );
  }
  if (stage === "add-success") {
    const github = await evaluate(
      "window.prmonitor.readGithubSettings().then(r=>r.value.settings.profiles.find(p=>p.serverUrl==='https://github.com'||p.host==='github.com'))",
    );
    assert.ok(github?.id);
    openTarget("MANAGED_PR_SETTINGS", "shell-pr-1");
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea'))",
        ),
      "existing PR edit before successful Add",
    );
    await setField(
      'form[aria-label="Edit pull request configuration"] textarea',
      "Uncommitted A context survives successful Add.",
    );
    const prBefore = await evaluate(
      "window.prmonitor.readManagedPr('shell-pr-1').then(r=>r.value.managedPr)",
    );
    for (const [number, back] of [
      [73, "Back to PR inbox"],
      [74, "PRs"],
    ]) {
      await click("Add PR");
      await waitFor(
        () =>
          evaluate(
            "Boolean(document.querySelector('form[aria-label=\"Add a pull request\"]'))",
          ),
        "successful Add form",
      );
      await evaluate(
        `(()=>{const select=document.querySelector('form[aria-label="Add a pull request"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(github.id)});select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.optional-pr-settings').open=true;})()`,
      );
      await setField(
        'form[aria-label="Add a pull request"] input[inputmode="url"]',
        `https://github.com/fixture/added/pull/${number}`,
      );
      await setField(
        'form[aria-label="Add a pull request"] textarea',
        `New PR ${number} configuration`,
      );
      await click("Add Pull Request");
      const added = await waitFor(
        () =>
          evaluate(
            `window.prmonitor.readManagedPrs().then(r=>r.value.value.managedPrs.find(p=>p.owner==='fixture'&&p.repositoryName==='added'&&p.number===${number}))`,
          ),
        "submitted Add persists new PR",
      );
      await waitFor(
        () =>
          evaluate(
            "[...document.querySelectorAll('form[aria-label=\"Add a pull request\"] button')].some(b=>b.textContent.trim()==='Add Pull Request'&&!b.disabled)",
          ),
        "successful Add settled",
      );
      await click(back);
      await waitFor(
        () =>
          evaluate(
            `document.querySelector('.pr-detail-heading p')?.textContent===${JSON.stringify(`fixture/added #${number}`)}`,
          ),
        "new selected PR rendered after Add return",
      );
      await evaluate(
        "document.getElementById('pr-detail-tab-settings').click()",
      );
      await waitFor(
        () =>
          evaluate(
            `document.querySelector('form[aria-label="Edit pull request configuration"] textarea')?.value===${JSON.stringify(`New PR ${number} configuration`)}`,
          ),
        "new PR owns displayed settings",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.pr-detail-heading p')?.textContent",
        ),
        `fixture/added #${number}`,
      );
      await click("Review");
      await waitFor(
        () => visible("No saved review exists for this pull request yet."),
        "new PR does not inherit old saved work",
      );
      await evaluate(
        "document.getElementById('pr-detail-tab-settings').click()",
      );
      await setField(
        'form[aria-label="Edit pull request configuration"] textarea',
        `Saved new PR ${number} configuration`,
      );
      await click("Save new configuration revision");
      await waitFor(
        () =>
          evaluate(
            `window.prmonitor.readManagedPr(${JSON.stringify(added.id)}).then(r=>r.value.managedPr.configuration.context===${JSON.stringify(`Saved new PR ${number} configuration`)})`,
          ),
        "new PR settings actually saved",
      );
      if (number === 74) await capture("submitted-add-settings");
    }
    assert.deepEqual(
      (
        await evaluate(
          "window.prmonitor.readManagedPr('shell-pr-1').then(r=>r.value.managedPr)",
        )
      ).configuration,
      prBefore.configuration,
    );
    openTarget("MANAGED_PR_SETTINGS", "shell-pr-1");
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea')?.value==='Uncommitted A context survives successful Add.'",
        ),
      "original PR draft restored after submitting Add",
    );
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('.pr-detail-heading p')?.textContent==='owner/base #1'",
        ),
      "original PR identity returns before draft capture",
    );
    await evaluate("document.getElementById('pr-detail-tab-settings').click()");
    await capture("submitted-add-original-draft");
    assertions.push(
      "actual Add metadata GET and persistence, Back/sidebar return, selected identity, empty saved work and Settings save belong to each new PR; original PR persisted configuration and unsaved draft remain independent",
    );
  }
  if (stage === "conditional-review") {
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedConditionalGate(userData);
    openTarget("REVIEW_BUNDLE", "setup-saved-review");
    await waitFor(
      () => visible("Saved review acceptance fixture"),
      "conditional proposal review",
    );
    await reviewPane("Review");
    const workspace = () =>
      evaluate(
        "window.prmonitor.readReviewBundle('setup-saved-review').then(r=>r.value.workspace)",
      );
    const original = await workspace();
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.review-bundle-workspace button')].find(b=>!b.closest('[hidden]')&&b.textContent.trim()==='Continue to implementation').disabled",
      ),
      true,
    );
    await click("Accept recommendation");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.review-action-message')].some(e=>!e.closest('[hidden]')&&e.textContent.includes('question needs'))",
        ),
      "empty answer guard",
    );
    assert.equal((await workspace()).version, original.version);
    const field = async (label, value) => {
      await waitFor(
        () =>
          evaluate(
            `[...document.querySelectorAll('.review-bundle-workspace textarea')].some(e=>!e.closest('[hidden]')&&e.closest('label')?.textContent.includes(${JSON.stringify(label)}))`,
          ),
        `conditional field ${label}`,
      );
      await evaluate(
        `(()=>{const e=[...document.querySelectorAll('.review-bundle-workspace textarea')].find(e=>!e.closest('[hidden]')&&e.closest('label')?.textContent.includes(${JSON.stringify(label)}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    };
    await field(
      "Override instructions",
      "Saved instruction belongs to this proposal item.",
    );
    await click("Save entry instruction");
    await waitFor(
      () =>
        evaluate(
          "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation.proposalInputs.some(i=>i.kind==='SAVE_ENTRY_INSTRUCTION'&&i.text==='Saved instruction belongs to this proposal item.'))",
        ),
      "proposal instruction durably saved",
    );
    await field(
      "Question answer",
      "Answer the fixture question without contacting a provider.",
    );
    const instructionMessage = await evaluate(
      "[...document.querySelectorAll('.review-action-message')].find(e=>!e.closest('[hidden]'))?.textContent",
    );
    await click("Save question answer");
    await waitFor(
      () =>
        evaluate(
          `[...document.querySelectorAll('.review-action-message')].some(e=>!e.closest('[hidden]')&&e.textContent.trim()!==''&&e.textContent!==${JSON.stringify(instructionMessage)})&&[...document.querySelectorAll('.review-bundle-workspace button')].some(b=>!b.closest('[hidden]')&&b.textContent.trim()==='Save question answer'&&!b.disabled)`,
        ),
      "pending question save settles with visible refusal",
    );
    assert.equal(
      (await workspace()).version,
      original.version + 1,
      "pending no-change decision must not accept a standalone question answer",
    );
    await click("Accept recommendation");
    await waitFor(
      () => ipcAudit.some((r) => r.type === "review-bundle.decision.record"),
      "decision IPC received",
    );
    const decisionResult = ipcAudit
      .filter((r) => r.type === "review-bundle.decision.record")
      .at(-1);
    assert.equal(decisionResult.ok, true, JSON.stringify(decisionResult));
    await waitFor(
      async () => (await workspace()).items[0].decision.decision === "accepted",
      "accepted proposal with explicit answer",
    );
    await field(
      "Question answer",
      "Revised answer remains a separately saved proposal input.",
    );
    await click("Save question answer");
    await waitFor(
      () =>
        evaluate(
          "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation.proposalInputs.some(i=>i.kind==='APPLY_QUESTION_ANSWER'))",
        ),
      "proposal answer durably saved",
    );
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.review-decision-controls select')].some(e=>!e.closest('[hidden]'))",
        ),
      "decision controls return after owning read",
    );
    await evaluate(
      "(()=>{const select=[...document.querySelectorAll('.review-decision-controls select')].find(e=>!e.closest('[hidden]'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'no_change');select.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await click("Override recommendation");
    await waitFor(
      async () =>
        (await workspace()).items[0].decision.decision === "overridden",
      "overridden proposal decision",
    );
    const after = await workspace();
    assert.equal(after.items[0].decision.finalDisposition, "no_change");
    assert.deepEqual(
      after.items[0].recommendation,
      original.items[0].recommendation,
    );
    await reviewPane("Conversation and revisions");
    await click("Ask read-only question");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.review-action-message')].some(e=>!e.closest('[hidden]')&&e.textContent.includes('Enter a question'))",
        ),
      "empty conversation refused without AI",
    );
    assert.equal(
      (
        await evaluate(
          "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation)",
        )
      ).turns.length,
      0,
    );
    await evaluate(
      "[...document.querySelectorAll('.review-conversation-modes input')].find(e=>!e.closest('[hidden]')&&e.value==='REVIEW_REVISION').click()",
    );
    await waitFor(
      () => visible("Request explicit revision"),
      "explicit revision mode reachable",
    );
    await reviewPane("Review");
    await click("Activity");
    openTarget("REVIEW_BUNDLE", "setup-saved-review");
    await waitFor(
      () => visible("Saved review acceptance fixture"),
      "conditional proposal return",
    );
    assert.equal((await workspace()).items[0].decision.decision, "overridden");
    await capture("conditional-proposal-decisions");
    assertions.push(
      "proposal empty-answer guard, saved entry instruction/answer through F21 persistence, Accept/Override through owning F18 versioned commands, immutable original recommendation, empty conversation guard and explicit revision mode exercised in production renderer/preload/main without provider contact",
    );
  }
  if (stage === "conditional-provider") {
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedConditionalGate(userData);
    openTarget("REVIEW_BUNDLE", "setup-saved-review");
    await waitFor(
      () => visible("Saved review acceptance fixture"),
      "controlled provider question target",
    );
    await reviewPane("Review");
    await evaluate(
      "(()=>{const select=document.querySelector('.review-decision-controls select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'question');select.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.review-decision-controls label')].some(e=>e.textContent.includes('Question answer')&&e.querySelector('textarea'))",
        ),
      "controlled question answer input",
    );
    await evaluate(
      "(()=>{const e=[...document.querySelectorAll('.review-decision-controls label')].find(e=>e.textContent.includes('Question answer')).querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Existing human answer for the controlled transfer fixture.');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await click("Override recommendation");
    await waitFor(
      () =>
        evaluate(
          "window.prmonitor.readReviewBundle('setup-saved-review').then(r=>r.value.workspace.items[0].decision.finalDisposition==='question')",
        ),
      "owned question disposition committed",
    );
    await waitFor(
      () => evaluate("Boolean(document.querySelector('.workspace-panes'))"),
      "controlled question workspace restored",
    );
    await reviewPane("Conversation and revisions");
    await setField(
      ".review-conversation-panel textarea",
      "Use the controlled fixture to explain this saved question.",
    );
    await click("Ask read-only question");
    const answer =
      "Owned deterministic answer transferred from the controlled provider port.";
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.review-bundle-workspace button')].some(e=>e.textContent.trim()==='Ask read-only question'&&!e.disabled)",
        ),
      "controlled provider command settled",
    );
    if (globalThis.__controlledConversationFailure)
      throw Error(
        `CONTROLLED_CONVERSATION_FAILURE:${JSON.stringify(globalThis.__controlledConversationFailure)}`,
      );
    if (ipcAudit.at(-1)?.ok === false)
      throw Error(`CONTROLLED_IPC_REFUSAL:${JSON.stringify(ipcAudit)}`);
    await waitFor(() => {
      if (
        globalThis.__controlledConversationResult &&
        globalThis.__controlledConversationResult.status !== "COMPLETED"
      )
        throw Error(
          `CONTROLLED_CONVERSATION_RESULT:${JSON.stringify(globalThis.__controlledConversationResult)}`,
        );
      if (globalThis.__controlledConversationFailure)
        throw Error(
          `CONTROLLED_CONVERSATION_FAILURE:${JSON.stringify(globalThis.__controlledConversationFailure)}`,
        );
      const refused = ipcAudit.find((item) => !item.ok);
      if (refused)
        throw Error(`CONTROLLED_IPC_REFUSAL:${JSON.stringify(refused)}`);
      return visible(answer);
    }, "controlled read-only answer reaches real renderer");
    const before = await evaluate(
      "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation)",
    );
    assert.equal(before.turns.at(-1).answer, answer);
    assert.equal(before.turns.at(-1).usage.totalTokens, 12);
    assert.equal(before.turns.at(-1).usage.inputTokens, 5);
    assert.equal(before.turns.at(-1).usage.outputTokens, 7);
    await click("Use as answer");
    await waitFor(
      () =>
        evaluate(
          `window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation.proposalInputs.some(i=>i.kind==='APPLY_QUESTION_ANSWER'&&i.text===${JSON.stringify(answer)}))`,
        ),
      "latest answer saved through real F21 proposal input command",
    );
    assert.deepEqual(globalThis.__controlledProviderContracts, [
      "READ_ONLY_CONVERSATION",
    ]);
    await capture("controlled-provider-answer-transfer");
    for (const outcome of ["FAILED", "INVALID"]) {
      globalThis.__controlledReadOnlyOutcome = outcome;
      await setField(
        ".review-conversation-panel textarea",
        `Owned ${outcome.toLowerCase()} provider case.`,
      );
      await click("Ask read-only question");
      await waitFor(
        () =>
          evaluate(
            `window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>{const t=r.value.conversation.turns.at(-1);return t?.userMessage===${JSON.stringify(`Owned ${outcome.toLowerCase()} provider case.`)}&&t.status==='NEEDS_ATTENTION'})`,
          ),
        `actual ${outcome} provider result records required attention`,
      );
      assert.equal(
        globalThis.__controlledConversationResult.providerStatus,
        "failed",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.review-conversation-panel textarea').value",
        ),
        "",
      );
      assert.equal(
        await evaluate(
          "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation.capabilities.canAsk)",
        ),
        true,
      );
    }
    globalThis.__controlledReadOnlyOutcome = undefined;
    await setField(
      ".review-conversation-panel textarea",
      "Explicit retry after the owned provider failures.",
    );
    await click("Ask read-only question");
    await waitFor(
      () =>
        evaluate(
          "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation.turns.at(-1)?.status==='COMPLETED')",
        ),
      "explicit read-only retry succeeds without losing failed history",
    );
    assert.equal(
      await evaluate(
        "window.prmonitor.readReviewBundleConversation('setup-saved-review').then(r=>r.value.conversation.turns.filter(t=>t.status==='NEEDS_ATTENTION').length)",
      ),
      2,
    );
    await capture("controlled-provider-failed-invalid-retry");
    assert.equal(globalThis.__controlledProviderContracts.length, 4);
    assertions.push(
      "actual F15 normalized provider failure and invalid structured output persist two failed read-only turns; an explicit successful retry preserves both failures and restores actionable conversation state",
    );
    assertions.push(
      "test-owned production main sources with only deterministic F15 provider-port substitution: real renderer/preload/IPC/F16/F17/F21/persistence record the read-only answer, usage and explicit answer transfer; no actual Codex process, model contact, code mutation or publication",
    );
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedConditionalGate(userData, "guarded-final-review");
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await reviewPane("Files and changes");
    await click("Refresh evidence");
    await waitFor(
      () => ipcAudit.at(-1)?.type === "review-bundle.worktree.refresh",
      "owned revision worktree refreshed",
    );
    const work = await evaluate(
      "window.prmonitor.readReviewBundle('guarded-final-review').then(r=>r.value.workspace)",
    );
    const dirtySourceBytes = await fs.readFile(
      path.join(work.worktree.canonicalPath, "source.ts"),
    );
    let sourceBytes = dirtySourceBytes;
    await reviewPane("Conversation and revisions");
    await evaluate(
      "[...document.querySelectorAll('.review-conversation-modes input')].find(e=>!e.closest('[hidden]')&&e.value==='REVIEW_REVISION').click()",
    );
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('.review-acknowledgement input'))",
        ),
      "unattributed revision acknowledgement",
    );
    await evaluate(
      "document.querySelector('.review-acknowledgement input').click()",
    );
    await setField(
      ".review-conversation-panel textarea",
      "Exercise the owned controlled turn budget without changing code.",
    );
    globalThis.__controlledProviderNeedsMore = true;
    const conversation = () =>
      evaluate(
        "window.prmonitor.readReviewBundleConversation('guarded-final-review').then(r=>r.value.conversation)",
      );
    const waitConversation = (predicate, context) =>
      waitFor(async () => {
        if (globalThis.__controlledConversationFailure)
          throw Error(
            `CONTROLLED_CONVERSATION_FAILURE:${JSON.stringify(globalThis.__controlledConversationFailure)}`,
          );
        if (ipcAudit.at(-1)?.ok === false)
          throw Error(
            `CONTROLLED_IPC_REFUSAL:${JSON.stringify(ipcAudit.at(-1))}`,
          );
        return predicate(await conversation());
      }, context);
    const revisionAuditStart = ipcAudit.length;
    await click("Request explicit revision");
    await waitFor(
      () =>
        ipcAudit
          .slice(revisionAuditStart)
          .some((item) => item.type === "review-bundle.revision.request"),
      "controlled revision command settled",
    );
    const initialRevision = await conversation();
    if (
      !initialRevision.capabilities.canStartNewOperation ||
      initialRevision.activeOperation?.remainingBudget !== 0
    )
      throw Error(
        `CONTROLLED_REVISION_REFUSAL:${JSON.stringify({ result: globalThis.__controlledConversationResult, status: initialRevision.activeOperation?.status, budget: initialRevision.activeOperation?.remainingBudget, nextAction: initialRevision.activeOperation?.permittedNextAction, providerInvocations: globalThis.__controlledProviderContracts.length })}`,
      );
    await waitConversation(
      (c) =>
        c.capabilities.canStartNewOperation &&
        c.activeOperation.remainingBudget === 0,
      "one-turn revision stops at the real budget boundary",
    );
    const exhausted = await conversation();
    assert.equal(exhausted.activeOperation.status, "EXHAUSTED");
    assert.equal(globalThis.__controlledProviderContracts.length, 5);
    await setField(".review-budget-field input", "2");
    const newAuditStart = ipcAudit.length;
    await click("Start new AI Work budget");
    await waitFor(
      () =>
        ipcAudit
          .slice(newAuditStart)
          .some(
            (item) =>
              item.type === "review-bundle.conversation.start-new-operation",
          ),
      "new budget command settled",
    );
    const resumed = await conversation();
    assert.equal(resumed.activeOperation.status, "NEEDS_ATTENTION");
    assert.equal(resumed.activeOperation.remainingBudget, 1);
    assert.equal(resumed.activeOperation.permittedNextAction, "REVIEW");
    assert.equal(
      globalThis.__controlledContinuationResult.reason,
      "AI_INVALID_EVIDENCE",
    );
    assert.equal(resumed.capabilities.canContinue, false);
    assert.notEqual(
      resumed.activeOperation.operationId,
      exhausted.activeOperation.operationId,
    );
    assert.equal(globalThis.__controlledProviderContracts.length, 6);
    assert.ok(
      globalThis.__controlledContinuationResult.deterministicProblems?.length,
    );
    assert.deepEqual(
      await fs.readFile(path.join(work.worktree.canonicalPath, "source.ts")),
      sourceBytes,
    );
    // The preceding dirty fixture establishes the strict provider boundary.
    // Start the cancellation/continuation case from a clean owned checkpoint;
    // unrelated edits correctly block Continue and are not bypassed.
    childProcess.execFileSync(
      "git",
      ["restore", "--worktree", "--", "source.ts"],
      {
        cwd: work.worktree.canonicalPath,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    sourceBytes = await fs.readFile(
      path.join(work.worktree.canonicalPath, "source.ts"),
    );
    assert.equal(
      childProcess
        .execFileSync("git", ["status", "--porcelain"], {
          cwd: work.worktree.canonicalPath,
          encoding: "utf8",
          windowsHide: true,
        })
        .trim(),
      "",
      "owned clean checkpoint Git status",
    );
    const cleanRefresh = await evaluate(
      `window.prmonitor.refreshReviewBundleWorktree('guarded-final-review', ${resumed.bundleVersion})`,
    );
    assert.equal(cleanRefresh.ok, true);
    assert.equal(
      cleanRefresh.value.workspace.worktree.condition.classification,
      "CLEAN",
      "actual F13 clean checkpoint condition",
    );
    await reviewPane("Discard and re-evaluate");
    await click("Discard Review Bundle");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('#f22-worktree-choice'))"),
      "fresh clean worktree preview",
    );
    await click("Close preview");
    await waitFor(
      () => evaluate("!document.querySelector('#f22-worktree-choice')"),
      "clean preview cancelled without discard",
    );
    await reviewPane("Conversation and revisions");
    const cancelReady = await conversation();
    // Create another exhausted operation through the public IPC boundary, then
    // start a real explicitly budgeted background intent with one spare turn.
    const firstBackground =
      await evaluate(`window.prmonitor.requestReviewBundleRevision({
      schemaVersion:1,intentId:'owned-exhaust-intent',bundleId:'guarded-final-review',mode:'REVIEW_REVISION',
      message:'Exercise the owned budget boundary without changing files.',expectedBundleVersion:${cancelReady.bundleVersion},
      expectedEvidenceRevision:${JSON.stringify(cancelReady.evidenceRevision)},acknowledgeUnattributedChanges:true,
      idempotencyKey:'owned-exhaust-intent',createdAt:new Date().toISOString()
    })`);
    assert.equal(firstBackground.ok, true);
    const backgroundExhausted = await conversation();
    assert.equal(backgroundExhausted.activeOperation.status, "EXHAUSTED");
    assert.equal(globalThis.__controlledProviderContracts.length, 7);
    globalThis.__controlledProviderWaitForCancel = true;
    await evaluate(`(()=>{window.__controlledActiveRevision = window.prmonitor.startNewReviewBundleOperation({
      schemaVersion:1,intentId:'owned-cancel-intent',bundleId:'guarded-final-review',mode:'REVIEW_REVISION',
      message:'Wait for explicit Cancel without changing files.',expectedBundleVersion:${backgroundExhausted.bundleVersion},
      expectedEvidenceRevision:${JSON.stringify(backgroundExhausted.evidenceRevision)},acknowledgeUnattributedChanges:true,
      priorOperationId:${JSON.stringify(backgroundExhausted.activeOperation.operationId)},selectedBudget:2,
      idempotencyKey:'owned-cancel-intent',createdAt:new Date().toISOString()
    });return true;})()`);
    await waitConversation(
      (c) =>
        c.capabilities.canCancel &&
        c.activeOperation.status === "WORKING" &&
        globalThis.__controlledProviderContracts.length === 8,
      "actual active provider exposes Cancel",
    );
    await click("Back to PR inbox");
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.review-bundle-workspace')].some(e=>!e.closest('[hidden]'))",
        ),
      "active provider target closed",
    );
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await reviewPane("Conversation and revisions");
    const cancelAuditStart = ipcAudit.length;
    await click("Cancel AI Work");
    await waitFor(
      () =>
        ipcAudit
          .slice(cancelAuditStart)
          .some((item) => item.type === "review-bundle.conversation.cancel"),
      "Cancel command settled",
    );
    const cancelledResponse = await evaluate(
      "window.__controlledActiveRevision",
    );
    assert.equal(
      cancelledResponse.ok,
      true,
      `background intent settlement: ${cancelledResponse.error?.code}`,
    );
    const cancelState = await conversation();
    assert.equal(cancelState.activeOperation.status, "NEEDS_ATTENTION");
    assert.equal(cancelState.activeOperation.remainingBudget, 1);
    assert.equal(cancelState.capabilities.canCancel, false);
    assert.equal(
      cancelState.capabilities.canContinue,
      true,
      JSON.stringify({
        gate: cancelState.f22?.status,
        state: cancelState.state,
        condition: cancelState.worktreeCondition?.classification,
        conditionActions: cancelState.worktreeCondition?.permittedNextActions,
        gateCondition: cancelState.f22?.worktreeCondition?.classification,
        hold: cancelState.f22?.hold.active,
        gateReason: cancelState.f22?.reason?.code,
        continueOld: cancelState.f22?.actions.continueOldWork,
        nextAction: cancelState.activeOperation.permittedNextAction,
        result: globalThis.__controlledCancelResult,
      }),
    );
    assert.deepEqual(globalThis.__controlledCancelResult, {
      status: "NEEDS_ATTENTION",
      reason: "AI_TURN_CANCELLED",
      turnStatus: "CANCELLED",
      providerStatus: "cancelled",
    });
    assert.equal(globalThis.__controlledProviderContracts.length, 8);
    globalThis.__controlledProviderWaitForCancel = false;
    const continueAuditStart = ipcAudit.length;
    await click("Continue AI Work");
    await waitFor(
      () =>
        ipcAudit
          .slice(continueAuditStart)
          .some((item) => item.type === "review-bundle.conversation.continue"),
      "Continue command settled",
    );
    const continued = await conversation();
    assert.equal(
      continued.activeOperation.operationId,
      cancelState.activeOperation.operationId,
    );
    assert.equal(continued.activeOperation.status, "EXHAUSTED");
    assert.equal(continued.activeOperation.remainingBudget, 0);
    assert.equal(continued.capabilities.canStartNewOperation, true);
    assert.deepEqual(globalThis.__controlledProviderContracts, [
      ...Array(4).fill("READ_ONLY_CONVERSATION"),
      ...Array(5).fill("REVIEW_IMPLEMENTATION"),
    ]);
    assert.deepEqual(
      await fs.readFile(path.join(work.worktree.canonicalPath, "source.ts")),
      sourceBytes,
    );
    await capture("controlled-provider-budget-cancel");
    // Start through the foreground renderer this time: Cancel must become
    // reachable while its initiating request is still awaiting the provider.
    globalThis.__controlledProviderWaitForCancel = true;
    const foregroundAuditStart = ipcAudit.length;
    await click("Start new AI Work budget");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('button')].some(e=>!e.closest('[hidden]')&&e.textContent.trim()==='Cancel AI Work'&&!e.disabled)",
        ),
      "foreground working request exposes enabled Cancel without navigating away",
    );
    await waitFor(
      () => globalThis.__controlledProviderContracts.length === 10,
      "foreground request reaches the actual waiting provider",
    );
    const foregroundActive = await conversation();
    assert.equal(foregroundActive.activeOperation.status, "WORKING");
    assert.equal(globalThis.__controlledProviderContracts.length, 10);
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('button')].find(e=>!e.closest('[hidden]')&&e.textContent.trim()==='Request explicit revision').disabled",
      ),
      true,
      "other foreground mutations remain disabled while provider runs",
    );
    await click("Cancel AI Work");
    await waitFor(
      () =>
        [
          "review-bundle.conversation.cancel",
          "review-bundle.conversation.start-new-operation",
        ].every((type) =>
          ipcAudit
            .slice(foregroundAuditStart)
            .some((item) => item.type === type && item.ok),
        ),
      "foreground cancel and initiating request settle successfully once",
    );
    const foregroundCancelled = await conversation();
    assert.equal(
      foregroundCancelled.activeOperation.operationId,
      foregroundActive.activeOperation.operationId,
    );
    assert.equal(foregroundCancelled.activeOperation.status, "NEEDS_ATTENTION");
    assert.equal(foregroundCancelled.activeOperation.remainingBudget, 1);
    assert.equal(foregroundCancelled.capabilities.canContinue, true);
    assert.deepEqual(globalThis.__controlledCancelResult, {
      status: "NEEDS_ATTENTION",
      reason: "AI_TURN_CANCELLED",
      turnStatus: "CANCELLED",
      providerStatus: "cancelled",
    });
    assert.deepEqual(
      await fs.readFile(path.join(work.worktree.canonicalPath, "source.ts")),
      sourceBytes,
    );
    globalThis.__controlledProviderWaitForCancel = false;
    await capture("controlled-provider-foreground-cancel");
    // Restore the next journey's original owned dirty fixture after proving
    // that both stopped and continued providers preserved the clean checkpoint.
    await fs.writeFile(
      path.join(work.worktree.canonicalPath, "source.ts"),
      dirtySourceBytes,
    );
    assertions.push(
      "controlled provider and remote-read ports with actual F11 hold/F13 worktree/F16/F17/F21: one-turn budget exhaustion, distinct explicitly budgeted operation stops at actual deterministic-evidence guard with remaining budget; an explicitly budgeted background public IPC operation exposes active Cancel in the reopened renderer, persists cancelled turn evidence, and real Continue consumes exactly its one remaining turn without worktree mutation",
      "foreground renderer Start new budget exposes enabled Cancel while its request is still pending, keeps other mutation buttons disabled, and both commands settle successfully with one cancelled turn and unchanged worktree bytes without navigating away",
    );
  }
  if (stage === "conditional-activity") {
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedConditionalActivity(userData);
    await click("Activity");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('.activity-viewer'))"),
      "historical activity destination",
    );
    const selectActivity = async (selector, value) => {
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    };
    const viewSelector = ".activity-viewer > label select";
    await selectActivity(viewSelector, "ALL");
    await evaluate("document.querySelector('.activity-advanced').open=true");
    await setField(".activity-advanced input", "native-activity-history");
    await click("Apply filters");
    const rows = () =>
      evaluate("document.querySelectorAll('.activity-entry').length");
    await waitFor(
      async () => (await rows()) === 50,
      "first real 50-row history page",
    );
    assert.ok(await visible("PRMonitor recorded an event."));
    assert.ok(
      await visible("PRMonitor could not finish checking interrupted work."),
    );
    assert.ok(await visible("The outcome of saved work is not known."));
    assert.ok(await visible("The work outcome is not known."));
    assert.ok(await visible("Work failed."));
    const firstIds = await evaluate(
      "[...document.querySelectorAll('.activity-entry h3')].map(e=>e.id)",
    );
    await click("Load older activity");
    await waitFor(
      async () => (await rows()) === 65,
      "older real history merges without duplicates",
    );
    const allIds = await evaluate(
      "[...document.querySelectorAll('.activity-entry h3')].map(e=>e.id)",
    );
    assert.equal(new Set(allIds).size, 65);
    assert.deepEqual(allIds.slice(0, 50), firstIds);
    await selectActivity(viewSelector, "PR_WORK");
    await waitFor(
      async () =>
        (await rows()) === 50 && !(await visible("Unclassified event")),
      "PR view isolates historical scope",
    );
    await click("Load older activity");
    await waitFor(
      async () => (await rows()) === 63,
      "PR history excludes application and unknown records",
    );
    await selectActivity(viewSelector, "APPLICATION");
    await waitFor(
      async () => (await rows()) === 1,
      "application recovery isolates its single historical record",
    );
    assert.ok(
      await visible("PRMonitor could not finish checking interrupted work."),
    );
    await selectActivity(viewSelector, "ALL");
    await waitFor(async () => (await rows()) === 50, "all history restored");
    await selectActivity(
      ".activity-filters > label:nth-of-type(2) select",
      "ERROR",
    );
    await click("Apply filters");
    await waitFor(
      async () => (await rows()) === 2,
      "error filter preserves PR and application failure records",
    );
    await selectActivity(
      ".activity-filters > label:nth-of-type(3) select",
      "RECOVERY",
    );
    await click("Apply filters");
    await waitFor(
      async () => (await rows()) === 1,
      "severity and recovery stage combine",
    );
    await evaluate(
      "document.querySelector('.activity-event-details').open=true;document.querySelector('.activity-event-details details').open=true",
    );
    assert.ok(
      await evaluate(
        "[...document.querySelectorAll('.activity-event-details p')].some(e=>e.textContent.startsWith('Exact time (UTC):')&&e.querySelector('time[datetime]'))",
      ),
    );
    assert.ok(
      await evaluate(
        "document.querySelector('.activity-event-details pre').textContent.includes('owned-historical-activity')",
      ),
    );
    await capture("conditional-activity-history");
    await setField(".activity-advanced input", "native-activity-no-match");
    await click("Apply filters");
    await waitFor(
      () => visible("No activity matches these filters"),
      "filtered empty historical activity",
    );
    await setField(".activity-advanced input", "native-activity-history");
    await click("Apply filters");
    await waitFor(
      async () => (await rows()) === 1,
      "saved history before real read failure",
    );
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).withConditionalActivityReadFailure(userData, async () => {
      await click("Refresh activity");
      await waitFor(
        () => visible("Showing last-known activity. The latest read failed."),
        "real SQLite failure preserves last-known history",
      );
      assert.equal(await rows(), 1);
      assert.ok(
        await visible(
          "PRMonitor could not read activity. Select Refresh activity to try again.",
        ),
      );
      await capture("conditional-activity-read-failure");
    });
    await click("Refresh activity");
    await waitFor(
      () =>
        evaluate(
          "!document.querySelector('.activity-viewer [role=alert]')&&!document.querySelector('.activity-status').textContent.includes('last-known')",
        ),
      "restored real SQLite read clears error on explicit retry",
    );
    assert.equal(await rows(), 1);
    await selectActivity(".activity-filters > label:nth-of-type(2) select", "");
    await selectActivity(
      ".activity-filters > label:nth-of-type(3) select",
      "WORKTREE",
    );
    await setField(".activity-advanced input", "");
    await click("Apply filters");
    await waitFor(
      () =>
        evaluate(
          "!document.querySelector('.activity-status').textContent.includes('Loading')&&document.querySelectorAll('.activity-entry').length>0",
        ),
      "live worktree Activity query ready",
    );
    const eventIds = () =>
      evaluate(
        "[...document.querySelectorAll('.activity-entry h3')].map(e=>e.id)",
      );
    const beforeLive = await eventIds();
    const liveWork = await evaluate(
      "window.prmonitor.readReviewBundle('guarded-final-review').then(r=>r.value.workspace)",
    );
    const inspected = await evaluate(
      `window.prmonitor.refreshReviewBundleWorktree('guarded-final-review', ${liveWork.version})`,
    );
    assert.equal(inspected.ok, true);
    await waitFor(
      async () => (await eventIds()).some((id) => !beforeLive.includes(id)),
      "actual F13 producer arrives through live Activity subscription without Refresh",
    );
    const afterLive = await eventIds();
    assert.equal(new Set(afterLive).size, afterLive.length);
    assert.equal(afterLive.length, beforeLive.length + 1);
    await capture("conditional-activity-live");
    assertions.push(
      "historical observations seeded through real Activity writer: PR/application/unknown isolation, failure/uncertain/recovery copy, real 50/65-row pagination without duplicates, combined severity/stage/correlation filters, UTC/raw disclosures and filtered empty state; real SQLite table-unavailable failure retains last-known rows and explicit Refresh recovers after restoring all unchanged rows; actual F13 worktree inspection adds exactly one unique live event through production renderer/preload/IPC subscription without Refresh",
    );
  }
  if (stage === "conditional-f22") {
    await (
      await import(pathToFileURL(path.join(root, "fixtures.mjs")).href)
    ).seedConditionalGate(userData, "guarded-final-review");
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await waitFor(
      () => visible("Guarded final review with complete saved changes"),
      "controlled held final review",
    );
    await reviewPane("Discard and re-evaluate");
    const read = () =>
      evaluate(
        "window.prmonitor.readReviewBundle('guarded-final-review').then(r=>r.value.workspace)",
      );
    const initial = await read();
    assert.equal(initial.f22.hold.active, true);
    const bytes = await fs.readFile(
      path.join(initial.worktree.canonicalPath, "source.ts"),
    );
    await click("Discard Review Bundle");
    await waitFor(
      () => ipcAudit.at(-1)?.type === "review-bundle.discard.preview",
      "first authoritative remote observation settled",
    );
    assert.equal(ipcAudit.at(-1).reason, "STALE_GATE_REVISION");
    assert.equal((await read()).f22PendingAction, undefined);
    assert.deepEqual(
      await fs.readFile(path.join(initial.worktree.canonicalPath, "source.ts")),
      bytes,
    );
    // The first real observation advances the historical fixture's gate. Its
    // stale intent is refused; the next explicit click uses the refreshed gate.
    await click("Discard Review Bundle");
    await waitFor(() => {
      const response = ipcAudit.at(-1);
      if (
        response?.type.includes("discard") &&
        (response.ok === false ||
          response.outcome === "REJECTED" ||
          response.outcome === "ATTENTION")
      )
        throw Error(`CONTROLLED_F22_REFUSED:${JSON.stringify(response)}`);
      return evaluate(
        "Boolean(document.querySelector('#f22-worktree-choice'))",
      );
    }, "actual discard preview with owned dirty worktree");
    assert.equal(
      await evaluate("document.querySelector('#f22-confirm-choice').disabled"),
      true,
    );
    assert.equal(
      await evaluate("document.activeElement.id"),
      "f22-choice-heading",
    );
    await evaluate(
      "(()=>{const e=document.querySelector('#f22-worktree-choice');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'CLEAR_AI_ONLY');e.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    assert.equal(
      await evaluate("document.querySelector('#f22-confirm-choice').disabled"),
      true,
    );
    await evaluate("document.querySelector('#f22-confirmation').click()");
    await waitFor(
      () => evaluate("!document.querySelector('#f22-confirm-choice').disabled"),
      "explicit choice confirmation enables guarded control",
    );
    await click("Close preview");
    await waitFor(
      async () => !(await read()).f22PendingAction,
      "close preview persists bounded cancellation",
    );
    assert.deepEqual(
      await fs.readFile(path.join(initial.worktree.canonicalPath, "source.ts")),
      bytes,
    );
    await click("Discard Review Bundle");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('#f22-worktree-choice'))"),
      "second distinct discard preview",
    );
    await evaluate(
      "(()=>{const e=document.querySelector('#f22-worktree-choice');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'KEEP_AND_CANCEL');e.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await click("Confirm action choice");
    await waitFor(
      async () => !(await read()).f22PendingAction,
      "Keep and Cancel persists without destructive authorization",
    );
    assert.deepEqual(
      await fs.readFile(path.join(initial.worktree.canonicalPath, "source.ts")),
      bytes,
    );
    assert.equal((await read()).f22.hold.active, true);
    await globalThis.__controlledF22ObserveMoved();
    await click("Back to PR inbox");
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.review-bundle-workspace')].some(e=>!e.closest('[hidden]'))",
        ),
      "review route returned to inbox",
    );
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await waitFor(
      () => visible("Guarded final review with complete saved changes"),
      "remote-head stale review reopened",
    );
    await reviewPane("Files and changes");
    await click("Refresh evidence");
    await waitFor(
      () => ipcAudit.at(-1)?.type === "review-bundle.worktree.refresh",
      "explicit refresh returns observed gate to renderer",
    );
    await reviewPane("Discard and re-evaluate");
    assert.equal((await read()).f22.actions.reevaluate, true);
    await click("Re-evaluate at current head");
    await waitFor(() => {
      if (globalThis.__controlledF22Failure)
        throw Error(
          `CONTROLLED_F22_FAILURE:${JSON.stringify(globalThis.__controlledF22Failure)}`,
        );
      const response = ipcAudit.at(-1);
      if (
        response?.type === "review-bundle.reevaluate.preview" &&
        (response.ok === false ||
          response.outcome === "REJECTED" ||
          response.outcome === "ATTENTION")
      )
        throw Error(`CONTROLLED_F22_REFUSED:${JSON.stringify(response)}`);
      return evaluate(
        "Boolean(document.querySelector('#f22-worktree-choice'))",
      );
    }, "actual re-evaluation preview after observed head movement");
    assert.equal(
      await evaluate("document.querySelector('#f22-confirm-choice').disabled"),
      true,
    );
    await click("Close preview");
    await waitFor(
      async () => !(await read()).f22PendingAction,
      "re-evaluation cancellation persists",
    );
    assert.equal((await read()).f22.hold.active, true);
    assert.deepEqual(
      await fs.readFile(path.join(initial.worktree.canonicalPath, "source.ts")),
      bytes,
    );
    assert.deepEqual(globalThis.__controlledProviderContracts, []);
    await capture("conditional-discard-cancel");
    assertions.push(
      "test-owned main with controlled remote-read port: actual durable F11 eligibility/claim/hold and F13 owned Git worktree; stale-gate refusal and discard/re-evaluation previews focus choices and require confirmation; Close preview and Keep Worktree and Cancel preserve source bytes and active hold; no clear, model, commit/push or publication effect",
    );
    await click("Discard Review Bundle");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('#f22-worktree-choice'))"),
      "final owned discard preview",
    );
    await setField("#f22-worktree-choice", "CLEAR_ALL");
    assert.equal(
      await evaluate("document.querySelector('#f22-confirm-choice').disabled"),
      true,
    );
    await evaluate("document.querySelector('#f22-confirmation').click()");
    await evaluate("document.querySelector('#f22-confirm-choice').click()");
    await waitFor(
      async () => !(await read()).f22.hold.active,
      "confirmed owned discard releases hold",
    );
    const discarded = await read();
    assert.equal(discarded.f22PendingAction, undefined);
    assert.notDeepEqual(
      await fs.readFile(path.join(initial.worktree.canonicalPath, "source.ts")),
      bytes,
    );
    const status = childProcess
      .execFileSync("git", ["status", "--porcelain"], {
        cwd: initial.worktree.canonicalPath,
        encoding: "utf8",
        windowsHide: true,
      })
      .trim();
    assert.equal(status, "");
    assert.deepEqual(globalThis.__controlledProviderContracts, []);
    await capture("conditional-discard-complete");
    assertions.push(
      "confirmed Clear All runs actual guarded F13 cleanup only in the owned worktree, archives the bundle and releases its real F11 hold; retained read remains available and Git status is clean; no provider or publication effect",
    );
  }
  if (stage === "conditional-settings") {
    await click("Settings");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.settings-categories button')].some(b=>b.textContent.trim()==='Common instructions')",
        ),
      "instruction category ready",
    );
    await evaluate(
      "[...document.querySelectorAll('.settings-categories button')].find(b=>b.textContent.trim()==='Common instructions').click()",
    );
    await waitFor(
      () => visible("Common Instructions"),
      "conditional instruction settings",
    );
    const inputs =
      '.preference-section[aria-labelledby="common-instructions-heading"]';
    const recordsBefore = (await preferences()).commonInstructionProfiles;
    const selectedBefore = (await preferences()).selectedCommonInstructionIds;
    await setField(
      `${inputs} .preferences-form input:not([type="checkbox"])`,
      "Default unselected instruction",
    );
    await setField(
      `${inputs} .preferences-form textarea`,
      "Default instruction initially has no selected authority.",
    );
    await click("Create instruction");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.instruction-list article h4')].some(e=>e.textContent==='Default unselected instruction')",
        ),
      "default unselected instruction renders without reload",
    );
    assert.deepEqual(
      (await preferences()).selectedCommonInstructionIds,
      selectedBefore,
    );
    await evaluate(
      "[...document.querySelectorAll('.instruction-list article')].find(e=>e.querySelector('h4')?.textContent==='Default unselected instruction').querySelector('button').click()",
    );
    await setField(
      `${inputs} .preferences-form textarea`,
      "Edited default unselected instruction",
    );
    await evaluate(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(inputs + ' .preferences-form input[type="checkbox"]')})].find(e=>e.closest('label').textContent.includes('Use for new tasks'));if(!e.checked)e.click();})()`,
    );
    await click("Save instruction revision");
    await waitFor(async () => {
      const saved = await preferences();
      return saved.commonInstructionProfiles.some(
        (p) =>
          p.name === "Default unselected instruction" &&
          p.revision === 2 &&
          p.instructionText === "Edited default unselected instruction" &&
          saved.selectedCommonInstructionIds.includes(p.profileId),
      );
    }, "default instruction edited and selected in same session");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.instruction-list article')].some(e=>e.querySelector('h4')?.textContent==='Default unselected instruction'&&[...e.querySelectorAll('button')].some(b=>b.textContent.trim()==='Delete'&&!b.disabled))",
        ),
      "default instruction delete available",
    );
    await evaluate(
      "[...document.querySelectorAll('.instruction-list article')].find(e=>e.querySelector('h4')?.textContent==='Default unselected instruction').querySelectorAll('button')[1].click()",
    );
    await waitFor(
      async () =>
        !(await preferences()).commonInstructionProfiles.some(
          (p) => p.name === "Default unselected instruction",
        ),
      "only default fixture instruction deleted",
    );
    assert.deepEqual(
      (await preferences()).commonInstructionProfiles,
      recordsBefore,
    );
    assert.deepEqual(
      (await preferences()).selectedCommonInstructionIds,
      selectedBefore,
    );
    await click("New");
    for (const name of ["Owned instruction A", "Owned instruction B"]) {
      await setField(
        `${inputs} .preferences-form input:not([type="checkbox"])`,
        name,
      );
      await setField(
        `${inputs} .preferences-form textarea`,
        `Instruction text for ${name}`,
      );
      await evaluate(
        `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(inputs + ' .preferences-form input[type="checkbox"]')})].find(e=>e.closest('label').textContent.includes('Use for new tasks'));if(!e.checked)e.click();})()`,
      );
      await click("Create instruction");
      await waitFor(
        async () =>
          (await preferences()).commonInstructionProfiles.some(
            (p) => p.name === name,
          ),
        "owned instruction persisted",
      );
      await click("New");
    }
    const created = (await preferences()).commonInstructionProfiles.filter(
      (p) => p.name.startsWith("Owned instruction"),
    );
    assert.equal(created.length, 2);
    const instructionButton = async (name, text) => {
      await waitFor(
        () =>
          evaluate(
            `(()=>{const a=[...document.querySelectorAll('.instruction-list article')].find(e=>e.querySelector('h4')?.textContent===${JSON.stringify(name)});return [...(a?.querySelectorAll('button')??[])].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);})()`,
          ),
        `instruction control ready: ${name} ${text}`,
      );
      return evaluate(
        `(()=>{const a=[...document.querySelectorAll('.instruction-list article')].find(e=>e.querySelector('h4')?.textContent===${JSON.stringify(name)});const b=[...a.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(b.disabled)throw Error('CONDITIONAL_CONTROL_DISABLED');b.click();})()`,
      );
    };
    await instructionButton("Owned instruction B", "Move up");
    await click("Save selected order");
    await waitFor(
      async () =>
        (await preferences()).selectedCommonInstructionIds[0] ===
        created.find((p) => p.name === "Owned instruction B").profileId,
      "instruction order committed",
    );
    await instructionButton("Owned instruction A", "Move up");
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('.instruction-list article h4')?.textContent==='Owned instruction A'",
        ),
      "reordered card and move guards follow draft order",
    );
    await setField(
      `${inputs} .preferences-form input:not([type="checkbox"])`,
      "Unselected order fixture",
    );
    await setField(
      `${inputs} .preferences-form textarea`,
      "Preserve the existing unsaved order.",
    );
    await click("Create instruction");
    await waitFor(
      () => visible("Unselected order fixture"),
      "unselected card appears beside unsaved order",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.instruction-list article h4')?.textContent",
      ),
      "Owned instruction A",
    );
    assert.equal(
      (await preferences()).selectedCommonInstructionIds[0],
      created.find((p) => p.name === "Owned instruction B").profileId,
    );
    await instructionButton("Unselected order fixture", "Delete");
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.instruction-list article h4')].some(e=>e.textContent==='Unselected order fixture')",
        ),
      "unselected order fixture deleted",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.instruction-list article h4')?.textContent",
      ),
      "Owned instruction A",
    );
    await click("New");
    await instructionButton("Owned instruction B", "Move up");
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('.instruction-list article h4')?.textContent==='Owned instruction B'",
        ),
      "instruction order restored before revision",
    );
    await instructionButton("Owned instruction A", "Edit");
    await setField(
      `${inputs} .preferences-form textarea`,
      "Revised owned instruction A",
    );
    await click("Save instruction revision");
    await waitFor(
      async () =>
        (await preferences()).commonInstructionProfiles.some(
          (p) =>
            p.name === "Owned instruction A" &&
            p.instructionText === "Revised owned instruction A" &&
            p.revision === 2,
        ),
      "instruction revision persisted",
    );
    const retainedA = (await preferences()).commonInstructionProfiles.find(
      (p) => p.name === "Owned instruction A",
    );
    await instructionButton("Owned instruction B", "Delete");
    await waitFor(
      async () =>
        !(await preferences()).commonInstructionProfiles.some(
          (p) => p.name === "Owned instruction B",
        ),
      "only owned instruction deleted",
    );
    assert.deepEqual(
      (await preferences()).commonInstructionProfiles.find(
        (p) => p.name === "Owned instruction A",
      ),
      retainedA,
    );
    await capture("conditional-instruction-settings");
    assert.deepEqual(
      (await preferences()).commonInstructionProfiles.filter((p) =>
        recordsBefore.some((before) => before.profileId === p.profileId),
      ),
      recordsBefore,
    );
    assertions.push(
      "default-unselected instruction appears without reload; create/delete preserve unsaved card order and persisted selection; edit/select/delete preserve unrelated profiles",
      "real isolated instruction create/select/order/edit/delete commands preserve versioned ownership; no instruction authorizes external effects",
    );
    await evaluate(
      "[...document.querySelectorAll('.settings-categories button')].find(b=>b.textContent.trim()==='Repository build and validation').click()",
    );
    await waitFor(
      () => visible("Repository Build & Validation"),
      "repository guidance category",
    );
    const repositoriesBefore = (await preferences()).repositories;
    const guidance =
      '.preference-section[aria-labelledby="repository-guidance-heading"]';
    for (const [index, value] of [
      "github-com",
      "owned-fixture",
      "guidance",
      "github-com/owned-fixture/guidance",
    ].entries())
      await setField(
        `${guidance} .preferences-form label:nth-of-type(${index + 1}) input`,
        value,
      );
    await setField(
      `${guidance} textarea`,
      "Review the fixture build expectations. This prose authorizes no command or publication.",
    );
    await click("Save repository guidance");
    await waitFor(
      async () =>
        (await preferences()).repositories.some(
          (r) =>
            r.repository.key === "github-com/owned-fixture/guidance" &&
            r.buildInstructions.startsWith("Review the fixture"),
        ),
      "repository guidance durably saved",
    );
    assert.deepEqual(
      (await preferences()).repositories.filter((r) =>
        repositoriesBefore.some(
          (before) => before.repository.key === r.repository.key,
        ),
      ),
      repositoriesBefore,
    );
    await capture("conditional-repository-guidance");
    assertions.push(
      "repository guidance save uses real typed IPC and persistence, preserves other repository records and grants no execution or publication authority",
    );
  }
  if (stage === "restart") {
    assert.equal(read.ready, true);
    await waitFor(() => visible("No pull requests yet"), "ready restart inbox");
    assert.equal(await visible("Set up PRMonitor"), false);
    await capture("ready-restart");
    await click("Settings");
    await evaluate(
      "[...document.querySelectorAll('.settings-categories button')].find(button => button.textContent.trim() === 'Setup').click()",
    );
    await waitFor(
      () => visible("Set up PRMonitor"),
      "settings setup inspection",
    );
    assertions.push(
      "ready data cold-starts into empty inbox; Settings > Setup inspects readiness",
    );
    await click("Activity");
    await waitFor(
      () => visible("No PR activity yet"),
      "genuine empty default PR Activity",
    );
    await capture("activity-pr-work-empty");
    await click("View application diagnostics");
    await waitFor(
      () => evaluate("document.querySelectorAll('.activity-entry').length > 0"),
      "genuine startup diagnostics",
    );
    await capture("activity-application-diagnostics-empty-profile");
    assertions.push(
      "empty ready profile has no PR activity; genuine startup diagnostics are separately accessible without inventing PR work",
    );
  }
  if (stage === "lost-auth") {
    assert.equal(
      read.checks.find((c) => c.id === "ai-access").status,
      "incomplete",
    );
    window.webContents.reload();
    await waitFor(
      () => visible("Set up PRMonitor").catch(() => false),
      "renderer recreation setup",
    );
    assertions.push(
      "recreated renderer recomputes incomplete readiness and resumes setup",
    );
    window.webContents.send("prmonitor:ipc:v1:event", {
      schemaVersion: 1,
      type: "open-target",
      target: {
        schemaVersion: 1,
        kind: "REVIEW_BUNDLE",
        id: "setup-saved-review",
        requestId: "route-setup-e2e-review-target",
      },
    });
    await waitFor(
      () => visible("Setup needs attention"),
      "review precedence banner",
    );
    assert.equal(await visible("Set up PRMonitor"), false);
    await waitFor(
      () => visible("Please explain the expected behavior."),
      "saved review content",
    );
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('.review-bundle-workspace textarea')].find(e => e.closest('label')?.textContent.toLowerCase().includes('answer'));
      if (!input) throw Error('E2E_ANSWER_UNAVAILABLE');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Unsaved answer stays here.');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await capture("incomplete-explicit-review-target");
    window.webContents.send("prmonitor:ipc:v1:event", {
      schemaVersion: 1,
      type: "open-target",
      target: {
        schemaVersion: 1,
        kind: "HOME",
        requestId: "route-setup-e2e-home",
      },
    });
    await waitFor(() => visible("Set up PRMonitor"), "home returns to setup");
    await click("Return to saved target");
    await waitFor(
      () => visible("Please explain the expected behavior."),
      "return to saved content",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.review-bundle-workspace textarea')].find(e => e.closest('label')?.textContent.toLowerCase().includes('answer'))?.value",
      ),
      "Unsaved answer stays here.",
    );
    assertions.push(
      "lost local auth resumes setup; a durable saved review opens with the attention banner; HOME and return preserve content and an unsaved answer without mutation",
    );
  }
  if (stage === "conditional-publication") {
    const fixtures = await import(
      pathToFileURL(path.join(root, "fixtures.mjs")).href
    );
    await evaluate("window.prmonitor.readReviewBundle('guarded-final-review')");
    await fixtures.seedConditionalGate(userData, "guarded-final-review");
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await reviewPane("Publication");
    const publication = () =>
      evaluate(
        "window.prmonitor.readReviewBundlePublication('guarded-final-review').then(r=>{if(!r.ok)throw Error(r.error.code);return r.value.publication})",
      );
    const ready = await publication();
    assert.equal(
      ready.canApprove,
      true,
      JSON.stringify(ready.reasons.map((r) => r.code)),
    );
    assert.equal(ready.candidate.responses.length, 1);
    assert.equal(ready.canPublish, false);
    const bytes = await fs.readFile(
      path.join(
        root,
        "worktrees",
        "publication-guarded-review-operation",
        "worktree",
        "source.ts",
      ),
    );
    const before = { ...globalThis.__controlledPublicationCalls };
    await click("Approve exact publication");
    assert.deepEqual(
      globalThis.__controlledPublicationCalls,
      before,
      "missing acknowledgements cannot invoke effects",
    );
    await evaluate(
      "document.querySelectorAll('.review-publication-acknowledgements input').forEach(e=>{if(!e.checked)e.click()})",
    );
    await click("Approve exact publication");
    await waitFor(
      () => ipcAudit.at(-1)?.type === "review-bundle.publication.approve",
      "fresh approval gate refusal settled",
    );
    assert.equal(ipcAudit.at(-1).ok, true, JSON.stringify(ipcAudit.at(-1)));
    assert.equal(
      ipcAudit.at(-1).reason,
      "CANDIDATE_CHANGED",
      JSON.stringify(ipcAudit.at(-1)),
    );
    assert.equal(await visible("were approved and durably locked"), false);
    await click("Activity");
    await waitFor(
      () => evaluate("Boolean(document.querySelector('.activity-viewer'))"),
      "leave refused candidate",
    );
    openTarget("REVIEW_BUNDLE", "guarded-final-review");
    await reviewPane("Publication");
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('.review-publication-acknowledgements input'))",
        ),
      "fresh candidate after guarded refusal",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.review-publication-acknowledgements input').checked",
      ),
      false,
      "changed candidate requires fresh acknowledgement",
    );
    assert.deepEqual(globalThis.__controlledPublicationCalls, before);
    await evaluate(
      "document.querySelectorAll('.review-publication-acknowledgements input').forEach(e=>{if(!e.checked)e.click()})",
    );
    await click("Approve exact publication");
    await waitFor(
      async () => (await publication()).canPublish,
      "exact candidate is durably approved",
    );
    const approved = await publication();
    assert.equal(approved.canApprove, false);
    assert.ok(approved.publication.approvalId);
    assert.deepEqual(
      globalThis.__controlledPublicationCalls,
      before,
      "approval alone has no publication effect",
    );
    await click("Publish approved Review Bundle");
    await waitFor(
      async () => (await publication()).canReconcile,
      "uncertain push exposes reconciliation without blind retry",
    );
    const uncertain = await publication();
    assert.equal(uncertain.status, "RECOVERING");
    assert.equal(uncertain.canPublish, false);
    assert.equal(globalThis.__controlledPublicationCalls.commit, 1);
    assert.equal(globalThis.__controlledPublicationCalls.push, 1);
    assert.equal(globalThis.__controlledPublicationCalls.post, 0);
    await capture("conditional-publication-uncertain");
    await click("Reconcile publication state");
    await waitFor(
      async () => (await publication()).canRetryResponses,
      "reconciled code and failed response expose response-only retry",
    );
    const partial = await publication();
    assert.equal(partial.publication.codePublished, true);
    assert.equal(partial.publication.responses.failed, 1);
    await click("Retry responses only");
    await waitFor(
      async () => (await publication()).status === "PUBLISHED",
      "response-only retry reaches terminal publication",
    );
    assert.deepEqual(globalThis.__controlledPublicationCalls, {
      commit: 1,
      push: 1,
      reconcilePush: 1,
      post: 2,
      reconcileResponse: 0,
    });
    const final = await publication();
    assert.equal(final.publication.responses.posted, 1);
    assert.equal(final.canPublish, false);
    assert.equal(final.canRetryResponses, false);
    const replay = await evaluate(
      `window.prmonitor.publishReviewBundlePublication({bundleId:'guarded-final-review',idempotencyKey:${JSON.stringify(final.publication.idempotencyKey)}})`,
    );
    assert.equal(replay.ok, true);
    assert.equal(globalThis.__controlledPublicationCalls.post, 2);
    assert.equal(
      (
        await evaluate(
          "window.prmonitor.readReviewBundle('guarded-final-review').then(r=>r.value.workspace)",
        )
      ).f22.hold.active,
      false,
    );
    assert.deepEqual(
      await fs.readFile(
        path.join(
          root,
          "worktrees",
          "publication-guarded-review-operation",
          "worktree",
          "source.ts",
        ),
      ),
      bytes,
    );
    await capture("conditional-publication-response-retry");
    assertions.push(
      "isolated profile and owned Git worktree with only deterministic F23 Git/response and F22 remote-read effect ports: actual exact approval guards, durable candidate/approval, uncertain push reconciliation, failed-response-only retry, terminal replay, released F11 hold and unchanged source bytes; no real commit, push or response publication",
    );
  }
  if (stage === "conditional-sync") {
    const readSync = (id) =>
      evaluate(
        `window.prmonitor.readSynchronizationReviewResult(${JSON.stringify(id)}).then(r=>{if(!r.ok)throw Error(r.error.code);return r.value.result})`,
      );
    const awaitSync = (id) =>
      waitFor(
        () =>
          evaluate(
            `Boolean(document.querySelector('.synchronization-result-card[data-sync-operation="${id}"]'))`,
          ),
        "selected synchronization result",
      );
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-1");
    await awaitSync("guarded-sync-1");
    await waitFor(() => visible("Submit answer"), "owned conflict controls");
    const before = await readSync("guarded-sync-1");
    const source = path.join(
      root,
      "worktrees",
      "sync-guarded-sync-1",
      "worktree",
      "source.ts",
    );
    const bytes = await fs.readFile(source);
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Submit answer').disabled",
      ),
      true,
      "blank conflict answer cannot submit",
    );
    assert.equal(
      (await readSync("guarded-sync-1")).sourceVersion,
      before.sourceVersion,
      "blank input cannot write a retry",
    );
    for (const [button, kind, input] of [
      ["Submit answer", "USER_ANSWER", "Keep the owned source behavior."],
      ["Submit direction", "USER_DIRECTION", "Preserve the owned PR behavior."],
      ["Confirm manual edit", "MANUAL_EDIT_CONFIRMED", undefined],
      ["Retry resolution", "RETRY_RESOLUTION", undefined],
    ]) {
      const current = await readSync("guarded-sync-1");
      if (input) await setField(".synchronization-review textarea", input);
      await click(button);
      await waitFor(
        async () =>
          (await readSync("guarded-sync-1")).sourceVersion >
          current.sourceVersion,
        `saved ${kind} retry intent`,
      );
      const latest = await readSync("guarded-sync-1");
      assert.equal(
        latest.conflictResolution.consultationHistory.at(-1).kind,
        kind,
      );
      await waitFor(
        () =>
          evaluate(
            "![...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Refresh results')?.disabled",
          ),
        "retry projection refreshed",
      );
    }
    assert.deepEqual(
      globalThis.__controlledProviderContracts,
      [],
      "historical handoff has no active AI operation; retries preserve intent without starting a new budget",
    );
    assert.deepEqual(await fs.readFile(source), bytes);
    await click("Refresh remote freshness");
    await click("Refresh worktree evidence");
    await setField(".synchronization-choice select", "CLEAR_ALL");
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Apply worktree choice').disabled",
      ),
      true,
    );
    await setField(".synchronization-choice select", "KEEP_AND_CANCEL");
    await click("Apply worktree choice");
    assert.deepEqual(
      await fs.readFile(source),
      bytes,
      "Keep and Cancel retains owned source bytes",
    );
    await capture("conditional-sync-conflict-controls");
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-2");
    await awaitSync("guarded-sync-2");
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.synchronization-review button')].some(b=>b.textContent.trim()==='Approve publication')",
        ),
      "owned ready synchronization result",
    );
    await click("Refresh remote freshness");
    await click("Refresh worktree evidence");
    const ready = await readSync("guarded-sync-2");
    assert.equal(
      ready.capabilities.approvePublication,
      true,
      JSON.stringify(ready.reason),
    );
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Refresh results').disabled",
        ),
      "fresh synchronization evidence settled in renderer",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Approve publication').disabled",
      ),
      true,
    );
    await evaluate(
      "[...document.querySelectorAll('.synchronization-review label')].find(e=>e.textContent.includes('complete bounded diff')).querySelector('input').click()",
    );
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.synchronization-review label')].find(e=>e.textContent.includes('complete bounded diff')).querySelector('input').checked",
        ),
      "exact synchronization diff acknowledged",
    );
    await click("Approve publication");
    await waitFor(
      async () => (await readSync("guarded-sync-2")).capabilities.publish,
      "approved synchronization candidate",
    );
    assert.equal(globalThis.__controlledSyncCalls.commit, 0);
    await click("Publish merge");
    await waitFor(
      async () =>
        globalThis.__controlledSyncCalls.push === 1 &&
        (await readSync("guarded-sync-2")).capabilities.reconcile,
      "uncertain synchronization push",
    );
    assert.equal(globalThis.__controlledSyncCalls.commit, 1);
    assert.equal(globalThis.__controlledSyncCalls.push, 1);
    await click("Reconcile publication");
    await waitFor(
      async () => (await readSync("guarded-sync-2")).status === "PUBLISHED",
      "reconciled synchronization publication",
    );
    assert.equal(globalThis.__controlledSyncCalls.commit, 1);
    assert.equal(globalThis.__controlledSyncCalls.push, 1);
    const final = await readSync("guarded-sync-2");
    const replay = await evaluate(
      `window.prmonitor.publishSynchronizationPublication({operationId:'guarded-sync-2',idempotencyKey:${JSON.stringify(final.publication.idempotencyKey)}})`,
    );
    assert.equal(replay.ok, true);
    assert.equal(globalThis.__controlledSyncCalls.push, 1);
    await capture("conditional-sync-publication");
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-1");
    await awaitSync("guarded-sync-1");
    await waitFor(
      () => visible("Submit direction"),
      "return to independent conflict result",
    );
    await click("Refresh worktree evidence");
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('.synchronization-choice select'))",
        ),
      "owned conflict worktree choices refreshed",
    );
    await setField(".synchronization-choice select", "CLEAR_AI_ONLY");
    await click("Apply worktree choice");
    await waitFor(
      async () => !(await fs.readFile(source)).equals(bytes),
      "actual attributed worktree clear",
    );
    await waitFor(
      async () =>
        (await readSync("guarded-sync-1")).worktree.condition.classification ===
        "CLEAN",
      "owned clear completed and clean evidence persisted",
    );
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Refresh results').disabled",
        ),
      "clear projection settled before next explicit choice",
    );
    await fs.writeFile(source, "export const ownedManualEdit = true;\n");
    await click("Refresh worktree evidence");
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Refresh results').disabled",
        ),
      "manual edit evidence settled",
    );
    assert.equal(
      (await readSync("guarded-sync-1")).capabilities.clearAll,
      false,
      "unattributed manual edit remains protected from Clear All",
    );
    await fs.writeFile(source, bytes);
    await click("Refresh worktree evidence");
    await waitFor(
      async () => (await readSync("guarded-sync-1")).capabilities.clearAll,
      "exact original attributed snapshot exposes Clear All",
    );
    await waitFor(
      () =>
        evaluate(
          "![...document.querySelectorAll('.synchronization-review button')].find(b=>b.textContent.trim()==='Refresh results').disabled",
        ),
      "attributed evidence settled",
    );
    await setField(".synchronization-choice select", "CLEAR_ALL");
    await evaluate(
      "[...document.querySelectorAll('.synchronization-choice label')].find(e=>e.textContent.includes('Clear All is destructive')).querySelector('input').click()",
    );
    await click("Apply worktree choice");
    await click("Discard result");
    await waitFor(
      async () => (await readSync("guarded-sync-1")).status === "DISCARDED",
      "discarded result remains readable",
    );
    assert.equal(
      (await readSync("guarded-sync-1")).conflictResolution.consultationHistory
        .length,
      before.conflictResolution.consultationHistory.length + 4,
    );
    openTarget("SYNCHRONIZATION_RESULT", "guarded-sync-3");
    await awaitSync("guarded-sync-3");
    await waitFor(
      () => visible("Submit direction"),
      "independent re-evaluation result",
    );
    await click("Refresh worktree evidence");
    await waitFor(
      () =>
        evaluate(
          "Boolean(document.querySelector('.synchronization-choice select'))",
        ),
      "owned re-evaluation worktree choices refreshed",
    );
    await setField(".synchronization-choice select", "CLEAR_AI_ONLY");
    await click("Re-evaluate from current refs");
    await waitFor(
      async () =>
        (await readSync("guarded-sync-3")).reason.code ===
        "F27_REEVALUATION_STARTED",
      "durable re-evaluation handoff acknowledgement",
    );
    assert.equal((await readSync("guarded-sync-3")).status, "DISCARDED");
    assert.equal(globalThis.__controlledSyncCalls.reevaluate, 1);
    assert.equal(
      (await readSync("guarded-sync-3")).capabilities.publish,
      false,
    );
    assert.ok(
      (await readSync("guarded-sync-3")).conflictResolution.consultationHistory
        .length > 0,
    );
    await capture("conditional-sync-reevaluation");
    assertions.push(
      "actual F27 re-evaluation records intent before the controlled preparation port, acknowledges exactly one replacement handoff and preserves the discarded old result/history; this port acknowledgement does not claim a newly prepared F25 batch",
    );
    assertions.push(
      "isolated synchronization profile with actual F13/F25/F26/F27 services: blank-input refusal, four versioned historical conflict retry intents without a new AI budget, remote/worktree refresh, destructive acknowledgement guard, Keep and Cancel byte preservation, Clear AI and confirmed Clear All of owned worktree, terminal discard retaining history; exact approval and uncertain push reconciliation use controlled Git effect ports with one commit/push and safe replay",
    );
  }
  if (stage === "conditional-preferences") {
    await click("Settings");
    const category = async (name, heading) => {
      await waitFor(
        () =>
          evaluate(
            `[...document.querySelectorAll('.settings-categories button')].some(b=>b.textContent.trim()===${JSON.stringify(name)})`,
          ),
        "settings category available",
      );
      await evaluate(
        `[...document.querySelectorAll('.settings-categories button')].find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`,
      );
      await waitFor(() => visible(heading), "settings category loaded");
    };
    await category("AI connections", "AI connections");
    const initial = await preferences();
    const taskSection =
      '.preference-section[aria-labelledby="task-profiles-heading"]';
    const task = await evaluate(
      `document.querySelector(${JSON.stringify(taskSection + " .preference-grid select")}).value`,
    );
    await evaluate(
      "[...document.querySelectorAll('summary')].find(e=>e.textContent.trim()==='Advanced task choices').parentElement.open=true",
    );
    const profile = initial.taskProfiles.find(
      (value) => value.taskType === task,
    );
    const invalid = await evaluate(
      `window.prmonitor.saveTaskProfile(${JSON.stringify({ expectedSettingsRevision: initial.settingsRevision, profile: { taskType: profile.taskType, providerId: profile.providerId, modelId: profile.modelId, enabled: profile.enabled, providerOptions: [] } })})`,
    );
    assert.equal(invalid.ok, false);
    assert.deepEqual(await preferences(), initial);
    const reasoning = `${taskSection} .preference-card .preferences-form label:nth-child(3) select`;
    const changedReasoning =
      profile.reasoningEffort === "high" ? "low" : "high";
    await setField(
      `${taskSection} .preference-card .preferences-form label:nth-child(2) select`,
      "gpt-6-astra",
    );
    await setField(reasoning, changedReasoning);
    globalThis.__controlledProviderUnavailable = true;
    await click("Save task profile");
    await waitFor(
      async () =>
        (await preferences()).settingsRevision > initial.settingsRevision,
      "unavailable profile durably classified",
    );
    assert.equal(
      (await preferences()).taskProfiles.find((p) => p.taskType === task)
        .availability,
      "UNSUPPORTED",
    );
    assert.deepEqual(
      (await preferences()).taskProfiles.filter((p) => p.taskType !== task),
      initial.taskProfiles.filter((p) => p.taskType !== task),
    );
    globalThis.__controlledProviderUnavailable = false;
    const unavailable = await preferences();
    await setField(reasoning, profile.reasoningEffort ?? "");
    await click("Save task profile");
    await waitFor(
      async () =>
        (await preferences()).settingsRevision > unavailable.settingsRevision,
      "explicit provider revalidation",
    );
    assert.equal(
      (await preferences()).taskProfiles.find((p) => p.taskType === task)
        .availability,
      "AVAILABLE",
    );
    await category("Work permissions", "Work permissions");
    const policySection =
      '.preference-section[aria-labelledby="policy-heading"]';
    const originalPolicy = (await preferences()).policy.preset;
    for (const preset of [
      "READ_ONLY",
      "AUTONOMOUS_WORKTREE",
      "AUTONOMOUS_WORKTREE_WITH_NETWORK",
      "INTERACTIVE_APPROVALS",
      "FULL_ACCESS",
      originalPolicy,
    ]) {
      if ((await preferences()).policy.preset === preset) continue;
      await setField(`${policySection} select`, preset);
      await click("Save permissions");
      await waitFor(
        async () => (await preferences()).policy.preset === preset,
        "explicit policy save",
      );
      assert.equal((await preferences()).policy.publicationAuthority, false);
      assert.equal(
        (await preferences()).policy.writableRootScope,
        "OPERATION_OWNED",
      );
    }
    const saved = await preferences();
    for (const input of [
      { expectedSettingsRevision: saved.settingsRevision, preset: "UNKNOWN" },
      { expectedSettingsRevision: 0, preset: "READ_ONLY" },
    ]) {
      const refused = await evaluate(
        `window.prmonitor.savePolicy(${JSON.stringify(input)})`,
      );
      assert.equal(refused.ok, false);
      assert.deepEqual(await preferences(), saved);
    }
    await category("Monitoring and work limits", "Operational Preferences");
    const operational =
      '.preference-section[aria-labelledby="operational-heading"]';
    for (const [index, value] of [
      [1, "0"],
      [2, path.join(root, "nonexistent-owned-worktree-root")],
      [3, "0"],
      [4, "0"],
    ]) {
      const selector = `${operational} .preferences-form label:nth-of-type(${index}) input`;
      const original = await evaluate(
        `document.querySelector(${JSON.stringify(selector)}).value`,
      );
      await setField(selector, value);
      await click("Save operational preferences");
      await waitFor(
        () =>
          evaluate(
            "Boolean(document.querySelector('.preferences-panel [role=alert]'))",
          ),
        "invalid operational input refused visibly",
      );
      await waitFor(
        () =>
          evaluate(
            "![...document.querySelectorAll('.preferences-panel button')].find(b=>b.textContent.trim()==='Save operational preferences').disabled",
          ),
        "operational command settled",
      );
      assert.deepEqual(await preferences(), saved);
      await setField(selector, original);
    }
    await setField(
      `${operational} .preferences-form label:nth-of-type(1) input`,
      String(saved.operational.maxAiWorkTurns + 1),
    );
    await click("Save operational preferences");
    await waitFor(
      async () =>
        (await preferences()).settingsRevision > saved.settingsRevision,
      "valid operational retry saved",
    );
    assert.deepEqual(globalThis.__controlledProviderContracts, []);
    await capture("conditional-settings-failures-retry");
    assertions.push(
      "isolated actual F16 typed commands and persistence: malformed typed provider options leave preferences unchanged; disabled provider is classified and explicitly revalidated without invocation; all policy presets retain operation-owned scope and no publication authority, with original policy restored; invalid/stale policy, turn budget, missing worktree root and invalid monitoring timers fail without changing saved preferences, followed by a valid explicit retry",
    );
  }
  assert.equal(
    forbidden.length,
    0,
    "setup attempted a model, publication, or network side effect",
  );
  assertions.push(
    "no Codex subprocess, Git commit/push, or renderer network request; only allowlisted fake GitHub GET fixture traffic",
  );
  await finish(undefined, assertions);
}
start().catch((error) => finish(error));
