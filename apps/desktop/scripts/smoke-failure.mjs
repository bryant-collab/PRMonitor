// Emit only fixed diagnostic labels. Child output may contain private paths or
// other uncontrolled text and must never be copied into a CI error message.
export function classifySmokeFailure(stderr) {
  if (
    /No usable sandbox|SUID sandbox helper binary|Failed to move to new namespace|zygote_host_impl_linux/iu.test(
      stderr,
    )
  )
    return "SANDBOX_SETUP_FAILED";
  if (/Missing X server|The platform failed to initialize/iu.test(stderr))
    return "DISPLAY_SETUP_FAILED";
  if (/GPU process isn't usable/iu.test(stderr)) return "GPU_PROCESS_FAILED";
  return "UNCLASSIFIED";
}

export function classifySandboxSubreason(stderr) {
  if (
    /SUID sandbox helper binary|must be owned by root|mode 4755/iu.test(stderr)
  )
    return "HELPER_OWNERSHIP_OR_MODE";
  if (
    /Failed to move to new namespace|Operation not permitted.*namespace|namespace.*Operation not permitted/iu.test(
      stderr,
    )
  )
    return "NAMESPACE_PERMISSION";
  if (/No usable sandbox/iu.test(stderr)) return "NO_USABLE_SANDBOX";
  return "UNCLASSIFIED";
}

export function classifyApplicationSmokeReason(stderr) {
  for (const reason of [
    "SMOKE_RUNTIME_PATHS_INVALID",
    "SMOKE_NONCE_MISSING",
    "READINESS_TIMEOUT",
    "WINDOW_MISSING_AFTER_OPEN",
    "ACCESSIBILITY_PROBE_FAILED",
    "APP_START_FAILED",
  ]) {
    if (
      new RegExp(
        `(?:^|\\n)PRMONITOR_SMOKE_ERROR:${reason}(?::|\\r?\\n|$)`,
      ).test(stderr)
    )
      return reason;
  }
  return "UNCLASSIFIED";
}
