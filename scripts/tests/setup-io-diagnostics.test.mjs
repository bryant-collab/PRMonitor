import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
const require = createRequire(import.meta.url);
const { observeOwnedIo } = require("../../tests/setup-io-diagnostics.cjs");

test("IO observations retain pending promises and thrown objects without exposing path, SQL or values", async () => {
  const root = path.resolve("owned-private-root");
  let resolve,
    elapsed = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const problem = Error("private-database-fixture");
  const fs = Object.fromEntries(
    [
      "readFile",
      "writeFile",
      "stat",
      "lstat",
      "readdir",
      "mkdir",
      "rename",
      "realpath",
    ].map((name) => [name, () => pending]),
  );
  class StatementSync {
    run() {
      throw problem;
    }
    get() {
      return { privateValue: "private-database-fixture" };
    }
    all() {
      return [];
    }
  }
  class DatabaseSync {
    exec() {
      elapsed += 3;
      throw problem;
    }
  }
  const observer = observeOwnedIo(
    fs,
    { StatementSync, DatabaseSync },
    root,
    () => elapsed,
  );
  assert.equal(fs.readFile(path.join(root, "private-file")), pending);
  assert.equal(observer.snapshot().FS_READFILE.active, 1);
  fs.stat(path.resolve("unrelated-private-root", "private-file"));
  assert.equal(observer.snapshot().FS_STAT, undefined);
  const statement = new StatementSync();
  assert.throws(
    () => statement.run("private-SQL-value"),
    (error) => error === problem,
  );
  assert.deepEqual(statement.get(), {
    privateValue: "private-database-fixture",
  });
  elapsed = 11;
  resolve("private-file-contents");
  await pending;
  assert.equal(observer.snapshot().FS_READFILE.active, 0);
  assert.equal(observer.snapshot().FS_READFILE.longestMs, 11);
  assert.equal(observer.snapshot().SQL_RUN.completed, 1);
  assert.throws(
    () => new DatabaseSync().exec("private-COMMIT-statement"),
    (error) => error === problem,
  );
  assert.deepEqual(observer.snapshot().SQL_EXEC, {
    started: 1,
    completed: 1,
    active: 0,
    longestMs: 3,
    totalMs: 3,
  });
  assert.ok(!JSON.stringify(observer.snapshot()).includes("private"));
});
