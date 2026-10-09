import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Packager } from "app-builder-lib/out/packager.js";
import { WinPackager } from "app-builder-lib/out/winPackager.js";
import { NtExecutable, NtExecutableResource, Resource } from "resedit";
import { assertWindowsBrandingBytes } from "../windows-branding.mjs";

const desktop = fileURLToPath(new URL("../../apps/desktop/", import.meta.url));
const language = { lang: 1033, codepage: 1200 };
const expected = { fileVersion: "0.1.0", productVersion: "0.1.0.0" };

function fixture(edit = () => {}) {
  const executable = NtExecutable.createEmpty(false, false);
  const resources = NtExecutableResource.from(executable);
  const version = Resource.VersionInfo.createEmpty();
  version.lang = language.lang;
  version.setStringValues(language, {
    ProductName: "PRMonitor",
    FileDescription: "PRMonitor",
    InternalName: "PRMonitor",
    OriginalFilename: "",
    FileVersion: expected.fileVersion,
    ProductVersion: expected.productVersion,
  });
  version.setFileVersion(0, 1, 0, 0);
  version.setProductVersion(0, 1, 0, 0);
  version.setStringValue(language, "FileVersion", expected.fileVersion);
  edit(version);
  version.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  return Buffer.from(executable.generate());
}

test("shipping config edits Electron metadata while leaving signing and installation identity unchanged", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prmonitor-pe-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const info = new Packager({
    projectDir: desktop,
    config: path.join(desktop, "electron-builder.yml"),
  });
  await info.validateConfig();
  const packager = new WinPackager(info);
  assert.equal(
    packager.platformSpecificBuildOptions.signAndEditExecutable,
    true,
  );
  assert.equal(packager.platformSpecificBuildOptions.signExecutable, false);
  assert.equal(packager.forceCodeSigning, false);
  assert.equal(packager.appInfo.id, "com.prmonitor.desktop");
  assert.equal(packager.appInfo.productFilename, "PRMonitor");
  assert.equal(packager.appInfo.sanitizedName, "@prmonitordesktop");
  const executable = path.join(directory, "PRMonitor.exe");
  await writeFile(
    executable,
    fixture((version) => {
      version.setStringValues(language, {
        ProductName: "Electron",
        FileDescription: "Electron",
        InternalName: "electron",
        OriginalFilename: "electron.exe",
      });
      version.setFileVersion(44, 4, 3, 0);
      version.setProductVersion(44, 4, 3, 0);
    }),
  );
  assert.throws(() =>
    assertWindowsBrandingBytes(
      fixture((v) => v.setStringValue(language, "ProductName", "Electron")),
      expected,
    ),
  );
  // Exercise the pinned packaging implementation against an inert PE fixture.
  // Disable only icon lookup: this test owns version-resource acceptance.
  packager.getIconPath = async () => null;
  await packager.signApp(
    { appOutDir: directory, outDir: directory, arch: 1 },
    true,
  );
  assertWindowsBrandingBytes(await readFile(executable), {
    fileVersion: packager.appInfo.buildVersion,
    productVersion: packager.appInfo.getVersionInWeirdWindowsForm(),
  });
});

test("PE acceptance rejects missing, stale or signed resources", () => {
  assertWindowsBrandingBytes(fixture(), expected);
  assert.throws(() =>
    assertWindowsBrandingBytes(
      Buffer.from(NtExecutable.createEmpty(false, false).generate()),
      expected,
    ),
  );
  for (const [key, value] of Object.entries({
    ProductName: "Electron",
    FileDescription: "Electron",
    InternalName: "electron",
    OriginalFilename: "electron.exe",
    FileVersion: "44.4.3",
    ProductVersion: "44.4.3.0",
  })) {
    assert.throws(
      () =>
        assertWindowsBrandingBytes(
          fixture((version) => version.setStringValue(language, key, value)),
          expected,
        ),
      new RegExp(key),
    );
  }
  for (const prefix of ["file", "product"])
    assert.throws(
      () =>
        assertWindowsBrandingBytes(
          fixture((version) => {
            version.fixedInfo[`${prefix}VersionLS`] = 1;
          }),
          expected,
        ),
      /numeric Windows/,
    );
  const signed = fixture();
  const parsed = NtExecutable.from(signed);
  const certificateOffset =
    parsed.dosHeader.newHeaderAddress +
    parsed.newHeader.getDataDirectoryOffset() +
    4 * 8;
  signed.writeUInt32LE(1024, certificateOffset);
  signed.writeUInt32LE(8, certificateOffset + 4);
  assert.throws(
    () => assertWindowsBrandingBytes(signed, expected),
    /unsigned|certificate/i,
  );
});
