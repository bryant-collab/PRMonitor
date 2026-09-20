import { execFileSync } from "node:child_process";

const REQUIRED_NODE = "24.19.0";
const REQUIRED_NPM = "11.17.0";
const REQUIRED_GIT = "2.55.0";

function versionWithoutPrefix(value) {
  return (
    value
      .trim()
      .replace(/^v/u, "")
      .match(/^\d+\.\d+\.\d+/u)?.[0] ?? ""
  );
}

function readCommand(command, args) {
  try {
    const executable =
      process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
        ? (process.env.ComSpec ?? "cmd.exe")
        : command;
    const executableArgs =
      executable === command
        ? args
        : ["/d", "/s", "/c", `${command} ${args.join(" ")}`];
    return execFileSync(executable, executableArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
}

const nodeVersion = versionWithoutPrefix(process.version);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmVersion = versionWithoutPrefix(
  readCommand(npmCommand, ["--version"]) ?? "",
);
const gitVersionOutput = readCommand(
  process.platform === "win32" ? "git.exe" : "git",
  ["--version"],
);
const gitVersion = versionWithoutPrefix(
  gitVersionOutput?.match(/git version\s+([^\s]+)/u)?.[1] ?? "",
);

const failures = [];
if (nodeVersion !== REQUIRED_NODE)
  failures.push(
    `Node.js ${REQUIRED_NODE} required (found ${nodeVersion || "unavailable"})`,
  );
if (npmVersion !== REQUIRED_NPM)
  failures.push(
    `npm ${REQUIRED_NPM} required (found ${npmVersion || "unavailable"})`,
  );
if (gitVersion !== REQUIRED_GIT) {
  failures.push(
    `GIT_UNAVAILABLE: Git ${REQUIRED_GIT} required (found ${gitVersion || "unavailable"}); install Git and ensure it is on PATH`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`runtime-check: ${failures.join("; ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `runtime-check: Node.js ${nodeVersion}, npm ${npmVersion}, Git ${gitVersion}\n`,
  );
}
