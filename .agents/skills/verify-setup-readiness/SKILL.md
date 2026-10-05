---
name: verify-setup-readiness
description: Verify PRMonitor startup setup, durable configuration, recovery, and explicit-target routing after a related code change using the repository's deterministic Electron journey. Use for this feature's verification, not unrelated application behavior.
---

# Verify startup setup

Run from the repository root. Follow the existing spec-implementation skill and [feature map](references/feature-map.md). This skill verifies issue #1 only; it does not authorize publication, real GitHub credentials, or changes to user data.

## Launch and doctor

Use the repository-pinned Node, npm, Git and lockfile dependencies. Run `npm run check:runtime`, `npm run build:validation-contract`, and `npm run build:desktop`. A missing runtime is a prerequisite failure, not a reason to install or upgrade global tools. Run `npm run check` for the final source boundary; it covers types, lint, formatting, the production Windows artifact smoke, and existing regression suites.

Read `tests/setup-e2e-README.md` before `npm run test:setup`. The runner owns each Electron child and marked temporary data root, sets application paths before importing built production main, and bounds process lifetime. The child confirms marker ownership, reads readiness through the real preload, and waits for a visible setup or inbox. There is no persistent external server to attach to.

## Drive and evidence

Run `npm run test:setup` on Windows. The harness drives real production main, preload, renderer, SQLite and configuration services with controlled GitHub.com/GHES identity fixtures and a fixed nonsecret local-auth fixture. Unexpected network, AI subprocesses and Git publication fail the run. It executes fresh, partial, ready restart, lost-auth, bootstrap failure and repaired-bootstrap journeys.

Require exit zero, each scenario `ok: true`, zero forbidden effects, and owned-state cleanup. Inspect `docs/evidence/setup-readiness/results.json` and the painted screenshots after the run. A ready process alone is insufficient: verify the disabled inbox button while incomplete, persisted progress after restart, empty inbox after completion, explicit target with attention banner, and bounded recovery with Retry. Keep proof outside the temporary data root.

## Cleanup and limits

The runner validates its resolved temporary path, owner marker and absence of reparse points before removing owned state on success or failure. Timeout cleanup uses only the spawned child identity. Never kill by application name or delete another run's data. Read retained results and screenshots after cleanup.

Physical Windows DPI, screen-reader interaction, and real saved-review content are not proved by the zoom and missing-review fixtures. Follow the manual matrix in the evidence report for those surfaces. Report a failing or unreachable mapped path; do not reinterpret it as success. Maintaining this skill is a separate pass within this directory; product corrections need their own authorized scope.
