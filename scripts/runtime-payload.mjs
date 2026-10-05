/** Runtime state belongs to the user's profile or an owned test root, never a package. */
export function forbiddenRuntimePayload(entry) {
  const name = entry.replaceAll("\\", "/").replace(/^\/+/, "");
  return (
    /(?:^|\/)(?:\.env(?:\.|$)|\.prmonitor-(?:runtime|smoke)-owner\.json$|(?:userData|sessionData|runtime-fixtures|setup-e2e|\.cache)(?:\/|$))/iu.test(
      name,
    ) ||
    /\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm)|\.(?:bak|backup))?$/iu.test(name) ||
    /(?:^|\/)(?:Cache|Code Cache|GPUCache|Session Storage|Local Storage|backups)(?:\/|$)/iu.test(
      name,
    )
  );
}
