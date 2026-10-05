/* Observation only: preserve original return values/errors; never record paths or SQL. */
const path = require("node:path");
exports.observeOwnedIo = function (fs, sqlite, root, now = Date.now) {
  const metrics = {};
  const canonicalRoot = path.resolve(root).toLowerCase();
  const owned = (value) => {
    if (typeof value !== "string") return false;
    const relative = path.relative(
      canonicalRoot,
      path.resolve(value).toLowerCase(),
    );
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  };
  const begin = (kind) => {
    const record = (metrics[kind] ??= {
      started: 0,
      completed: 0,
      active: 0,
      longestMs: 0,
      totalMs: 0,
    });
    record.started++;
    record.active++;
    const start = now();
    return () => {
      const elapsed = Math.max(0, now() - start);
      record.completed++;
      record.active--;
      record.longestMs = Math.max(record.longestMs, elapsed);
      record.totalMs += elapsed;
    };
  };
  for (const name of [
    "readFile",
    "writeFile",
    "stat",
    "lstat",
    "readdir",
    "mkdir",
    "rename",
    "realpath",
  ]) {
    const original = fs[name];
    fs[name] = function (...args) {
      if (!owned(args[0])) return original.apply(this, args);
      const complete = begin(`FS_${name.toUpperCase()}`);
      try {
        const result = original.apply(this, args);
        result.then(complete, complete);
        return result;
      } catch (error) {
        complete();
        throw error;
      }
    };
  }
  for (const [owner, name] of [
    ["StatementSync", "run"],
    ["StatementSync", "get"],
    ["StatementSync", "all"],
    ["DatabaseSync", "exec"],
  ]) {
    const prototype = sqlite[owner]?.prototype;
    const original = prototype?.[name];
    if (!original) continue;
    prototype[name] = function (...args) {
      const complete = begin(`SQL_${name.toUpperCase()}`);
      try {
        return original.apply(this, args);
      } finally {
        complete();
      }
    };
  }
  return {
    snapshot: () =>
      Object.fromEntries(
        Object.entries(metrics).map(([key, value]) => [key, { ...value }]),
      ),
  };
};
