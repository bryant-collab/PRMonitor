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
