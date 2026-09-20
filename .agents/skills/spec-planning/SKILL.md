---
name: spec-planning
description: Use when asked to create a PRD, SPEC, or PLAN for a PRMonitor feature; do not use for implementing code from an existing spec.
metadata:
  short-description: Create and lint a PRMonitor feature spec
---

# PRMonitor Spec Planning

Your output is one coherent, reviewable PRD/PLAN pair for a single unchecked feature item. It does not implement application code and it does not check the feature off.

## Inputs and guardrails

- If the user didn't specify the feature to implement, then select the next unchecked item from `checklist.md`. Either way, you should read the `checklist`. Take note of the name that comes after the feature ID, as that is the stable slug for the PRD/PLAN pair. NOTE the slug uses underscores instead of spaces.
- Read the selected checklist item, its dependencies and primary application
  criteria, the global invariants, `Specs/application_overview.md`, both files
  under `Specs/Templates/`, and relevant existing PRDs/PLANs. Read `README.md`
  for the current linter commands.
- The linter reads `TYPESAFE_API_KEY` from the same named environment variable. Don't worry, this is a temporary, limited key for the linter and not a real secret. Never put credentials, API keys, local environment values, or real secrets in source, fixtures, logs, prompts, structured AI output, or committed evidence. Read required credentials from approved runtime mechanisms only.

## Workflow

1. **Choose the feature documents.** Identify the feature ID and a stable slug.
   Follow the repository's existing naming convention for the pair `<FeatureSlug>_<TYPE>.md`, keep both documents under `Specs/`, and record the exact owning PRD path in the PLAN.
   If there are no more unchecked items, stop and report that the checklist is complete. If the feature is already planned (it has a PRD and PLAN), stop and report that the checklist item is already planned.

2. **Write the PRD from the product perspective.** Start from
   `Specs/Templates/template_PRD.md`. Define the problem, user outcomes,
   upstream/downstream dependencies, scope, product decisions, and observable
   acceptance criteria. Number requirements as `FR-*`, non-functional
   requirements as `NFR-*`, and invariants as `INV-*`. Include failure,
   cancellation, restart, idempotency, security, accessibility, and platform
   behavior wherever the feature needs them. Every feature requirement must
   map to an observable acceptance criterion or a named contract-test
   criterion.

3. **Map application coverage explicitly.** Populate the PRD's
   **Application Requirements Covered** table with the checklist's listed
   `APP-AC-*` criteria and any other overview criteria the detailed scope
   affects. State whether ownership is primary or shared and describe the
   boundary when another feature owns the rest. Do not claim coverage merely
   because a later feature might integrate it.

4. **Write the implementation PLAN.** Start from
   `Specs/Templates/template_PLAN.md`. Keep product requirements in the PRD;
   put architecture and implementation decisions in the PLAN. Define the
   implementation boundary, readiness gates, and dependency-ordered vertical
   slices. Each slice should state its blockers, stories/requirements/criteria,
   visible result, durable records and external effects, failure/cancellation/
   restart behavior, exact evidence, and exit criterion. Prefer end-to-end
   slices, while allowing a contract-only slice when the feature genuinely
   has no UI or runtime behavior.

5. **Run both specification linters.** From the repository root, run the
   commands documented in `README.md` against the final PRD/PLAN pair:

   ```powershell
   npm run lint:prd-plan -- <path-to-PRD> <path-to-PLAN>
   npm run lint:application-coverage -- Specs/application_overview.md <path-to-PRD>
   ```

   Resolve invalid mappings and every definite `missing` result, then rerun
   both commands. Treat `needs-review` results and unresolved product choices
   as items for human agreement even when the command exits successfully.
   Do not weaken requirements or delete criteria just to satisfy a linter.

6. **Hand off for approval.** Report the two document paths, linter results,
   coverage decisions, unresolved product/implementation choices, and the
   checklist item that remains unchecked. Stop before implementation. If a
   product decision is required, ask for that decision rather than silently
   inventing it. Once the PRD/PLAN is approved, the implementation workflow is
   `.agents/skills/prmonitor-spec-implementation/SKILL.md`.

## Completion standard

The specification phase is complete only when the PRD and PLAN are internally
consistent, application coverage is explicit, both linter workflows have been
run against the final documents, and any required human product decisions are
recorded or surfaced for approval. Code changes, checkbox changes, commits,
and publication are outside this skill.
