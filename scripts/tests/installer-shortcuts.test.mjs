import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { UUID } from "builder-util-runtime";
import { Packager } from "app-builder-lib/out/packager.js";
import { WinPackager } from "app-builder-lib/out/winPackager.js";
import { NsisTarget } from "app-builder-lib/out/targets/nsis/NsisTarget.js";
import { nsisTemplatesDir } from "app-builder-lib/out/targets/nsis/nsisUtil.js";

const desktop = fileURLToPath(new URL("../../apps/desktop/", import.meta.url));

test("shipping NSIS config enables Start menu repair and compiles with the pinned installer templates", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-nsis-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const info = new Packager({
    projectDir: desktop,
    config: path.join(desktop, "electron-builder.yml"),
  });
  await info.validateConfig();
  const packager = new WinPackager(info);
  const target = new NsisTarget(packager, directory, "nsis", { refCount: 0 });
  assert.equal(packager.appInfo.id, "com.prmonitor.desktop");
  assert.equal(packager.appInfo.productFilename, "PRMonitor");
  assert.equal(target.options.oneClick, true);
  assert.equal(target.options.perMachine, false);
  assert.equal(target.options.deleteAppDataOnUninstall, false);
  assert.equal(target.options.createStartMenuShortcut, true);
  assert.equal(target.options.createDesktopShortcut, true);
  assert.equal(target.options.guid, undefined);
  const guid = UUID.v5(
    packager.appInfo.id,
    UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"),
  );
  assert.equal(guid, "f8d173c3-d555-534f-936f-68adc6bbdade");
  const defines = {
    APP_ID: packager.appInfo.id,
    APP_GUID: guid,
    UNINSTALL_APP_KEY: guid,
    PRODUCT_NAME: packager.appInfo.productName,
    PRODUCT_FILENAME: packager.appInfo.productFilename,
    APP_FILENAME: packager.appInfo.sanitizedName,
    APP_DESCRIPTION: packager.appInfo.description,
    VERSION: packager.appInfo.version,
    APP_BUILD_DIR: directory,
    UNINSTALLER_OUT_FILE: path.join(directory, "uninstaller-fixture.txt"),
    ESTIMATED_SIZE: "1",
  };
  await target.configureDefines(true, defines);
  assert.equal(defines.SHORTCUT_NAME, "PRMonitor");
  for (const disabled of [
    "DO_NOT_CREATE_START_MENU_SHORTCUT",
    "DO_NOT_CREATE_DESKTOP_SHORTCUT",
    "DELETE_APP_DATA_ON_UNINSTALL",
    "RUN_AFTER_FINISH",
    "INSTALL_MODE_PER_ALL_USERS",
  ])
    assert.equal(disabled in defines, false, disabled);
  const include = await packager.getResource(target.options.include);
  assert.equal(include, path.join(desktop, "installer.nsh"));
  const header = await target.computeCommonInstallerScriptHeader();
  assert.ok(header.includes(`!include "${include}"`));
  const section = await readFile(
    path.join(nsisTemplatesDir, "installSection.nsh"),
    "utf8",
  );
  assert.ok(
    section.indexOf("!insertmacro customInstall") >
      section.indexOf("!insertmacro addDesktopLink"),
  );
  // Compile the actual shipping include/templates with inert text payloads.
  // This checks NSIS integration on Linux too; no Windows binary is executed.
  await writeFile(defines.UNINSTALLER_OUT_FILE, "Not an executable.\n");
  const script = await readFile(
    path.join(nsisTemplatesDir, "installer.nsi"),
    "utf8",
  );
  await target.executeMakensis(
    defines,
    {
      Unicode: "true",
      OutFile: `"${path.join(directory, "compile-fixture.exe")}"`,
    },
    header + script,
  );
  assert.ok(
    (await readFile(path.join(directory, "compile-fixture.exe"))).length > 0,
  );
});
