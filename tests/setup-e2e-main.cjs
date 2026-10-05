/* Electron-only acceptance entrypoint. Never launched against real user data. */
const { app, BrowserWindow, session } = require("electron");
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
const realExit = app.exit.bind(app);
let retryRelaunches = 0;
let retryExits = 0;
let currentStep = "startup";
const timeout = setTimeout(
  () => finish(new Error(`E2E_STAGE_TIMEOUT:${currentStep}`)),
  55000,
);
let finished = false;

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
        error: error?.message,
      },
      null,
      2,
    ),
  );
  realExit(error ? 1 : 0);
}

async function waitFor(operation, label) {
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
  const userData = path.join(
    root,
    stage.startsWith("bootstrap") ? "bootstrap-user-data" : "user-data",
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
      return original.call(this, command, ...args);
    };
  }
  syncBuiltinESMExports();
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, "GET");
    assert.ok(
      [
        "https://api.github.com/user",
        "https://github.example.test/api/v3/user",
      ].includes(String(url)),
      "unexpected main network request",
    );
    network.push("identity-read");
    const response = new Response(
      JSON.stringify({ login: "setup-fixture", name: "Setup fixture" }),
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
    pathToFileURL(path.join(__dirname, "../apps/desktop/out/main/index.js"))
      .href
  );
  let window = await waitFor(
    () => BrowserWindow.getAllWindows().find((item) => !item.isDestroyed()),
    "window",
  );
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
      ]);
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
  const click = (text) =>
    evaluate(
      `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && !e.closest('[hidden]')); if(!b || b.disabled) throw Error('E2E_BUTTON_UNAVAILABLE'); b.click(); })()`,
    );
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
  const assertions = [];
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
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.setup-screen button')].find(b=>b.textContent==='Open PR inbox').disabled",
      ),
      true,
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
        "Boolean(document.querySelector('.preferences-panel, .activity-viewer, .connection-status, .server-form'))",
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
    await click("Select all");
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
    await click("PR inbox");
    await waitFor(
      () =>
        evaluate(
          "document.querySelector('form[aria-label=\"Edit pull request configuration\"] textarea')?.value === 'Unsaved PR context survives navigation.'",
        ),
      "unsaved PR context retained",
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
        if (optionalReferenceScripts.has(details.url)) blockedReferenceScripts++;
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
      "document.querySelector('.setup-screen .profile-actions').scrollIntoView({block:'center'})",
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
    await click("Retry setup checks");
    await waitFor(
      async () =>
        evaluate(
          "[...document.querySelectorAll('.setup-screen button')].some(b=>b.textContent==='Open PR inbox'&&!b.disabled)",
        ),
      "open inbox enabled",
    );
    await click("Open PR inbox");
    await waitFor(() => visible("No pull requests yet"), "empty inbox");
    assert.ok(await visible("Add PR"));
    await capture("completed-empty-inbox");
    assertions.push(
      "GitHub.com and GHES identity fixtures, four independent persisted profiles, and local auth complete all checks; zero PRs allows inbox",
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
  assert.equal(
    forbidden.length,
    0,
    "setup attempted a model, publication, or network side effect",
  );
  assertions.push(
    "no Codex subprocess, Git commit/push, or renderer network request; only fake GitHub GET identity traffic",
  );
  await finish(undefined, assertions);
}
start().catch((error) => finish(error));
