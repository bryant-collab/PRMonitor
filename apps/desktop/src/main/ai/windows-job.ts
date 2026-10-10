import { nativeFFI } from "@prmonitor/provider-runtimes/native";

export interface WindowsJob {
  assign(pid: number, birth: string): void;
  terminate(): void;
  activeProcesses(): number;
  close(): void;
}
let bindings: ReturnType<typeof loadBindings> | undefined;
function loadBindings() {
  if (process.platform !== "win32" || !["x64", "arm64"].includes(process.arch))
    throw new Error("Windows process ownership is unavailable.");
  const kernel = nativeFFI.load("kernel32.dll");
  const bind = (name: string, result: string, args: string[]) =>
    kernel.func("__stdcall", name, result, args);
  return {
    create: bind("CreateJobObjectW", "void *", ["void *", "str16"]),
    set: bind("SetInformationJobObject", "int32", [
      "void *",
      "int32",
      "void *",
      "uint32",
    ]),
    query: bind("QueryInformationJobObject", "int32", [
      "void *",
      "int32",
      "void *",
      "uint32",
      "void *",
    ]),
    assign: bind("AssignProcessToJobObject", "int32", ["void *", "void *"]),
    member: bind("IsProcessInJob", "int32", ["void *", "void *", "void *"]),
    terminate: bind("TerminateJobObject", "int32", ["void *", "uint32"]),
    open: bind("OpenProcess", "void *", ["uint32", "int32", "uint32"]),
    current: bind("GetCurrentProcess", "void *", []),
    times: bind("GetProcessTimes", "int32", [
      "void *",
      "void *",
      "void *",
      "void *",
      "void *",
    ]),
    setHandle: bind("SetHandleInformation", "int32", [
      "void *",
      "uint32",
      "uint32",
    ]),
    getHandle: bind("GetHandleInformation", "int32", ["void *", "void *"]),
    close: bind("CloseHandle", "int32", ["void *"]),
  };
}
function api() {
  return (bindings ??= loadBindings());
}
function check(result: unknown): void {
  if (!result)
    throw new Error("Windows process ownership could not be confirmed.");
}
function birthOf(handle: unknown): string {
  const creation = Buffer.alloc(8);
  check(
    api().times(
      handle,
      creation,
      Buffer.alloc(8),
      Buffer.alloc(8),
      Buffer.alloc(8),
    ),
  );
  return creation.readBigUInt64LE().toString();
}
/** Compared against the opened process handle to reject PID reuse before assignment. */
export function windowsProcessBirth(): string {
  return birthOf(api().current());
}
/** Unnamed, noninheritable, kill-on-close Job. No elevation, ACL or security changes. */
export function createWindowsJob(): WindowsJob {
  const native = api();
  const handle: unknown = native.create(null, null);
  check(handle);
  let assigned = false;
  let closed = false;
  try {
    check(native.setHandle(handle, 1, 0));
    const flags = Buffer.alloc(4);
    check(native.getHandle(handle, flags));
    if (flags.readUInt32LE() & 1)
      throw new Error("Job ownership would be inherited.");
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION has the same 144-byte ABI on x64/ARM64.
    // LimitFlags at offset 16; neither BREAKAWAY_OK nor SILENT_BREAKAWAY_OK is set.
    const limits = Buffer.alloc(144);
    limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    check(native.set(handle, 9, limits, limits.length));
    const actual = Buffer.alloc(144);
    check(native.query(handle, 9, actual, actual.length, null));
    if (actual.readUInt32LE(16) !== 0x2000)
      throw new Error("Job limits changed unexpectedly.");
  } catch (error) {
    native.close(handle);
    throw error;
  }
  return {
    assign(pid, birth) {
      if (
        closed ||
        assigned ||
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        !/^\d{1,20}$/u.test(birth)
      )
        throw new Error("Invalid worker ownership.");
      // SET_QUOTA | TERMINATE | QUERY_LIMITED_INFORMATION. No inheritable handle.
      const candidate: unknown = native.open(0x1101, 0, pid);
      check(candidate);
      try {
        if (birthOf(candidate) !== birth)
          throw new Error("Worker identity changed before assignment.");
        check(native.assign(handle, candidate));
        const member = Buffer.alloc(4);
        check(native.member(candidate, handle, member));
        if (member.readInt32LE() !== 1)
          throw new Error("Worker Job assignment failed.");
        assigned = true;
      } finally {
        check(native.close(candidate));
      }
    },
    terminate() {
      if (!closed) check(native.terminate(handle, 1));
    },
    activeProcesses() {
      if (closed) throw new Error("Job accounting is no longer available.");
      const accounting = Buffer.alloc(48); // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
      check(native.query(handle, 1, accounting, accounting.length, null));
      return accounting.readUInt32LE(40);
    },
    close() {
      if (closed) return;
      check(native.close(handle));
      closed = true;
    },
  };
}
