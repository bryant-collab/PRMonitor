---
name: spec-implementation
description: Use when asked to implement a planned PRMonitor feature; do not use to invent or revise product requirements.
metadata:
  short-description: Implement a pre-created PRMonitor feature
---

# PRMonitor Spec Implementation

Your output is an implemented, tested, integrated feature which conforms to the approved PRD/PLAN. You do not invent or revise product requirements. If you are genuinely unsure about a requirement or are otherwise blocked, stop and provide the user with context and a clear request for the next step. Provide a recommendation if you have one.

## Entry gates

- Work from the repository root and select the next uncompleted feature item from `checklist.md`, unless the user has explicitly specified a feature to implement. Read the `checklist` and take note of the name that comes after the feature ID, as that is the stable slug for the PRD/PLAN pair. NOTE the slug uses underscores instead of spaces.
- Locate the owning PRD and PLAN under `Specs/`. Read both in full, along with
  the selected checklist item, its dependencies, the global implementation
  invariants, and relevant existing code/tests.
- Inspect `git status` before editing. Preserve unrelated user changes and
  avoid broad refactors that are not required by the feature's plan.
- Never put credentials, API keys, local environment values, or real secrets
  in source, fixtures, logs, prompts, structured AI output, or committed
  evidence.

## Implement the plan

Work through ALL of the PLAN's slices in dependency order. You are not done until all slices are fully implemented and successfully tested. For each slice:

1. Restate the slice's visible result, exit criterion, and exact evidence. Keep
   the implementation boundary from the PLAN; if the slice exposes a product
   gap, stop and update the PRD/PLAN through the planning workflow before
   continuing.
2. Implement the smallest complete vertical slice practical for the feature,
   crossing persistence, domain logic, services, UI, and integration seams as
   applicable. Add tests at the service boundaries and for the user-visible
   result. Do not substitute scaffolding or an isolated backend for an
   integrated slice.
3. Preserve the checklist invariants: deterministic code owns polling, state,
   Git, validation, retries, notifications, and publication; AI stays inside
   its authorized operation-owned boundary; and no AI operation receives
   publication authority. Persist intent before external side effects, make
   retries/restarts/idempotency explicit, snapshot mutable inputs, and protect
   user worktree edits.
4. Exercise the slice's failure, cancellation, restart, and uncertain-outcome
   paths where the PRD/PLAN requires them. Use the evidence format named by the
   PLAN rather than treating model prose or a green-looking UI as proof.
5. Run focused tests after the slice and keep earlier behavior passing. Re-run
   the relevant application integration tests whenever a shared contract,
   state transition, persistence schema, IPC boundary, or provider adapter
   changes.

Do not silently broaden authorization, add autonomous publication, force-push,
automatic branch synchronization, webhook requirements, partial patch
acceptance, or automatic stale-branch rebasing when those are outside the MVP
scope. Keep provider SDK types behind the provider adapter and keep credentials
out of AI context and plaintext SQLite fields.

## Final verification and checklist closure

After all slices are implemented:

- Have a fresh subagent verify every PLAN exit criterion and every affected earlier checklist behavior. Use `gpt-5.6-luna` with medium reasoning effort for the bounded verification pass by default; use high effort when the scenario requires complex multi-step reasoning, recovery or failure-path analysis, or when medium leaves a concrete uncertainty. Include the feature's required unit/integration/UI/service-boundary tests and the repository checks required by the PLAN; run `npm run check` when the repository provides it.
- When the completed feature has a GUI or changes user-visible GUI behavior, launch the running desktop application and use the available computer-use skill/tooling to exercise the integrated user journey. Verify the visible result and applicable loading, empty, disabled, validation, error, cancellation, or restart state required by the PRD/PLAN. Automated component tests, DOM assertions, and screenshots do not replace this computer-use pass.
- When that GUI journey invokes AI, configure the application's Codex task profile to use `gpt-5.6-luna` with medium reasoning effort by default and high effort under the same escalation conditions. Verify provider access and the effective model before exercising the flow. Do not substitute a fake provider for the final computer-use pass or silently use a different model. If Luna is unavailable, report the exact prerequisite and leave the checklist item unchecked rather than claiming GUI completion.
- Record the computer-use scenario, provider/model when AI was involved, observable result, and any failed or unverified state in the feature evidence. Keep credentials, tokens, and local environment values out of screenshots, logs, and committed evidence.
- Confirm that the feature is persisted where required, exposed through the UI
  where applicable, integrated into the running desktop application, and
  restart-safe. An isolated package, scaffold, or untested implementation is
  not complete.
- Only then change the selected feature's single top-level checkbox in
  `checklist.md` from `[ ]` to `[x]`. Do not check nested prose, unrelated
  items, or multiple features. If any exit criterion or required test remains
  incomplete, leave the checkbox unchecked and report the exact residual work.

## Completion report

Hand off the feature ID, changed files, completed slices, tests/checks and
their outcomes, any manual verification still required, and the final checkbox
state. The report must distinguish implemented evidence from assumptions or
future work.

## Linting

Note, as the implementor, you are not responsible to run the linters referred to in README.md and those linters do not have to be run to consider the feature complete. Those linters are for another agent and were run before you begam.
