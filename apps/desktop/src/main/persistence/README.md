# F03 persistence boundary

This package is the main-process SQLite authority for durable PRMonitor state.
It uses the pinned Node 24 `node:sqlite` driver, which avoids a native addon and
is available to the supported Electron runtime. The current schema is version 2
with two forward-only migrations. `initializePersistence` requires an absolute
database path and a separate application-owned backup root; it never derives
either path from renderer or PR input.

The boundary provides:

- fail-closed bootstrap, migration checksums, integrity/foreign-key checks,
  verified pre-upgrade backups, bounded cleanup, and structured health results;
- synchronous main-process transactions with bounded busy retry, rollback,
  cancellation-before-commit, commit acknowledgement, and safe fault injection;
- bounded, content-hashed JSON codecs that reject credentials, prompts, SDK
  objects, uncontrolled environment values, oversized fields, and unknown
  record shapes; and
- repositories for settings, configuration snapshots, GitHub identities,
  checkpoints/observations, immutable feedback, review bundles and holds, AI
  evidence, validation, worktrees/diffs, synchronization, publication effects,
  stale history, and activity events.

Repositories persist intent and immutable snapshots but do not invoke GitHub,
Git, validation commands, an AI provider, Electron windows, or publication
effects. Later workflow features own those side effects and use the repository
contracts for restart reconciliation.
