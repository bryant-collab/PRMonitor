import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NtExecutable, NtExecutableResource, Resource } from "resedit";

// Read PE resources only. This never executes a Windows program.
export function assertWindowsBrandingBytes(bytes, version) {
  const executable = NtExecutable.from(bytes, { ignoreCert: true });
  const certificate = executable.newHeader.optionalHeaderDataDirectory.get(4);
  assert.equal(certificate.size, 0, "PRMonitor must remain unsigned");
  assert.equal(certificate.virtualAddress, 0, "Unexpected certificate table");
  const resources = NtExecutableResource.from(executable);
  const entries = Resource.VersionInfo.fromEntries(resources.entries);
  assert.equal(entries.length, 1, "Expected one Windows version resource");
  const info = entries[0];
  const languages = info.getAllLanguagesForStringValues();
  assert.ok(languages.length > 0, "Missing Windows version strings");
  for (const language of languages) {
    const strings = info.getStringValues(language);
    for (const [name, expected] of Object.entries({
      ProductName: "PRMonitor",
      FileDescription: "PRMonitor",
      InternalName: "PRMonitor",
      OriginalFilename: "",
      FileVersion: version.fileVersion,
      ProductVersion: version.productVersion,
    }))
      assert.equal(strings[name], expected, `Wrong Windows ${name}`);
  }
  for (const [prefix, text] of [
    ["file", version.fileVersion],
    ["product", version.productVersion],
  ]) {
    const parts = text.split(".").map((value) => Number.parseInt(value, 10));
    const expected = [parts[0], parts[1], parts[2], parts[3] ?? 0];
    assert.ok(
      expected.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 65535,
      ),
      "Invalid expected Windows version",
    );
    const ms = info.fixedInfo[`${prefix}VersionMS`];
    const ls = info.fixedInfo[`${prefix}VersionLS`];
    assert.deepEqual(
      [ms >>> 16, ms & 65535, ls >>> 16, ls & 65535],
      expected,
      `Wrong numeric Windows ${prefix} version`,
    );
  }
}

export async function assertWindowsBranding(executable, version) {
  assertWindowsBrandingBytes(await readFile(executable), version);
}
