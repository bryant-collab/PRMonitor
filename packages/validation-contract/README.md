# `@prmonitor/validation-contract`

This package is the F00 deterministic validation contract. It is deliberately
framework-neutral: it imports no Electron, React, SQLite, Git, GitHub, AI SDK,
or process-spawning implementation.

## Contract surface

- `schema.ts` owns version-1 profiles. A profile contains ordered `steps`; a
  command is an executable plus an argument array, and a manual check is a
  tagged `kind: "manual"` step. Unknown version-1 keys are rejected.
- `trust.ts` normalizes defaults, canonicalizes JSON, hashes the exact profile,
  resolves the fixed one-run → saved → checked-in precedence, and evaluates
  explicit approvals/one-run authorizations. AI proposals remain candidates
  until an authorization record exists.
- `execution.ts` provides worktree containment, timeout/output bounds,
  executable/PATHEXT lookup, controlled-environment filtering, runner-neutral
  lifecycle transitions, and the five-second termination coordinator. It never
  launches a process.
- `output.ts` bounds stdout/stderr independently and redacts before returning
  evidence. Raw stream data is never part of an `OutputEvidence` object.
- `evidence.ts` keeps automated exit evidence separate from manual attestations,
  models no-profile warnings, and aggregates statuses without accepting model
  prose as an outcome.
- `snapshot.ts` freezes the pre-launch profile, source, repository identity,
  authorization reference, worktree identity, hash, and effective limits.
- `consumer.ts` exposes the same implementation to review and synchronization;
  the consumer label does not alter policy.

The checked-in interchange artifact is
`Specs/contracts/validation-profile.v1.schema.json`. Run
`npm run generate:validation-schema` to regenerate it; the package tests compare
the committed artifact to the Zod source.

Run `npm run report:validation-contract` for the deterministic fixture report.
It exercises profile parsing, source resolution, trust confirmation content,
bounded/redacted output, no-profile aggregation, and both downstream consumer
labels without spawning a command.

## Downstream handoff

- F01 incorporates this workspace and preserves the public exports and schema.
- F03 persists serialized profiles, authorization records, snapshots, runs,
  output metadata, and manual attestations without reinterpretation.
- F09 records the exported machine reasons as activity data, not as state.
- F13 supplies the operation-owned worktree identity and revision snapshots.
- F14 maps `PreparedCommand`, `ProcessControlPort`, `OutputEvidence`, and the
  lifecycle functions to real child-process execution; it must reuse the path,
  termination, output, and exit-status conformance cases.
- F16 renders `ConfirmationSummary` and `ValidationWarning` rather than
  rebuilding trust policy in the renderer.
- F18 and F23-F25 create snapshots and consume the same resolution, trust,
  path, timeout, redaction, aggregation, and warning behavior through the
  shared API.

The JSON fixtures under `fixtures/` include a valid current snapshot and a
tampered snapshot whose content hash is rejected before execution.

No export grants publication authority. A validation result cannot commit,
push, post a GitHub response, resolve a conversation, approve a review, or
merge a pull request.
