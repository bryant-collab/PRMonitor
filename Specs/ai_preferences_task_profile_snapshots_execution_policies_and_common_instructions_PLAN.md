<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: F16 AI Preferences, Task-Profile Snapshots, Execution Policies, and Common Instructions

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `ai_preferences_task_profile_snapshots_execution_policies_and_common_instructions_PRD.md`
>
> **Last revalidated against:** application overview, F00/F03/F04/F12/F13/F15 contracts, and checklist revision 2026-09-23
>
> **Entry/readiness gates:** F03 exposes revisioned settings, immutable-snapshot, expected-revision, and commit-before-effect repositories; F04 exposes validated main-process IPC, renderer lifecycle seams, and a declared payload bound; F15 exposes provider-neutral task/capability/policy contracts, explicit provider-option bounds, and a fake provider; F00 exposes the validation-profile resolver/trust contract and explicit v1 schema limits; F12 exposes typed polling/quiet configuration; F13 exposes root canonicalization, declared canonical path bounds, and operation-owned worktree scope; F07 exposes explicit repository and PR Intent / Context identity; the F16 bounds module and delegated minimum-bound rule are ready. `npm run check` is green and the semantic spec-linter workspace is runnable without putting credentials in fixtures or evidence.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Implementation Boundary

F16 implements the Preferences and deterministic configuration-resolution layer
inside the Electron application. It adds versioned, renderer-safe schemas and
main-process services for task profiles, named AI Execution Policies, Common
Instruction profiles, repository Build & Validation settings, bounded
operational preferences, and immutable effective task snapshots. It provides
typed ports consumed by F15/F17/F18/F21/F26 and a keyboard-accessible
Preferences surface through F04 IPC.

F16 uses F03 for all durable writes and migrations, F15's capability port for
compatibility admission, F00 for validation source/trust resolution, F12 for
polling/quiet semantics, and F13 for worktree-root validation. It must not
import the Codex SDK or any provider SDK, run an AI turn, create or mutate a
worktree, execute a command, contact GitHub, own scheduler timers, or publish
anything. Provider translation remains F15-owned; operation/segment lifecycle,
budgets, and persistence of external-effect intent remain F17/F03-owned.

### Provider-neutral handoff shapes

The implementation should expose small versioned contracts, with Zod-first
validation and bounded serializable values:

| Contract | Required meaning |
|---|---|
| `AITaskProfileRevision` | Task type, provider/model, optional reasoning effort, bounded provider options, availability/validation state, and immutable profile revision. |
| `AIExecutionPolicyRevision` | Named preset, sandbox/boundary, approval behavior, network setting, operation-owned writable-root scope, controlled-environment rules, task floor, and immutable policy revision. It contains no credentials or publication capability. |
| `CommonInstructionSnapshot` | Ordered selected profile IDs, names, enabled state, immutable revisions, bounded instruction text, and a stable content hash. |
| `BuildValidationContextSnapshot` | Explicit repository identity, human-readable guidance, F00 effective profile/source/trust/hash/authorization metadata, and phase-aware command/manual summaries without inventing execution authority. The complete F00 record remains F00-owned and is referenced by immutable ID/hash where needed. |
| `EffectiveAITaskSnapshot` | Declared task type and phase, the complete F16-owned profile/policy/common/build summaries, applicable PR Intent / Context snapshot, schema version, `boundsRevision`, and safe provenance/revision metadata used by a downstream operation. |
| `OperationalPreferences` | Maximum AI Work Turns, validated worktree-root reference, and typed F12 polling/quiet settings, each with a settings revision and future-only semantics. |

Absolute paths and operation identities are accepted only from the F13/F04
typed boundaries. F16 does not allow a renderer to choose an arbitrary writable
path. A downstream operation persists the returned snapshot through F03 before
calling F15 or another represented external effect.

### Bounds and delegated limits

The implementation uses the exact F16-B01-F16-B08 matrix in the owning PRD.
MOD-09 is the single policy module called by schemas, persistence codecs, IPC,
and snapshot construction. It records `boundsRevision`, rejects over-limit
values with stable bounded reasons, and never truncates authoritative values.
F16 owns B01-B04 and B07-B08. F00, F04, F13, and F15 publish versioned limits
for their delegated values; a valid lower delegated limit becomes the effective
limit, while F16 returns `F16_DELEGATED_BOUND_UNAVAILABLE` when a required bound
is absent, ambiguous, or cannot be enforced at the delegated boundary.

## Proposed Vertical Slices

1. **Revisioned task-profile Preferences and capability validation**
   - **Blocked by:** F03 settings/revision repositories; F04 validated IPC; F15 task-type and capability contracts; F01/F02 shared schema and reason primitives.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-10; FR-01.1-FR-02.4, FR-08.1-FR-08.4; NFR-01-NFR-03, NFR-05, NFR-07-NFR-08; INV-01-INV-03, INV-08-INV-10; AC-01-AC-04, AC-18-AC-23; CT-F16-01, CT-F16-02, CT-F16-08, CT-F16-10.
   - **Visible result:** Preferences shows four independently editable task-profile rows, current revision/availability, provider/model/reasoning fields, bounded provider-option summaries, and actionable compatibility feedback before save. A committed edit survives reload and changes only its own row.
   - **Durable records / external effects:** F03 stores the current profile projection plus immutable revision and expected settings revision. No provider, network, Git, validation, worktree, or publication effect occurs.
   - **Failure / cancellation / restart:** Known incompatible values, unknown task types, oversized/secret-shaped values, missing profiles, stale writers, persistence failures, and renderer closure before commit produce typed non-success results with no partial revision. An unverified model remains visibly gated and never starts a provider.
   - **Exact evidence:** Four-row read-model fixture; supported/unsupported/unknown-catalog capability matrix; revision/independence table; stale-writer and atomic-failure injection; renderer-close/restart round trip; IPC schema and accessibility probe; F16-B01/B02 below-exact-above boundary matrix; no-SDK/no-provider-start scan; CT-F16-01, CT-F16-02, CT-F16-08, and CT-F16-10.
   - **Exit criterion:** AC-01-AC-04 and AC-18-AC-23 pass, and all downstream callers can obtain a declared task-profile revision through a main-process typed port.

2. **Named execution policies, safety floors, and operational preferences**
   - **Blocked by:** Slice 1; F15 policy/capability contracts; F13 root validation; F12 scheduler configuration; F17 maximum-turn consumer contract.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-09; FR-03.1-FR-03.5, FR-07.1-FR-07.4, FR-08.1-FR-08.3; NFR-01-NFR-05, NFR-07-NFR-08; INV-01, INV-03-INV-05, INV-08-INV-10; AC-05-AC-10, AC-18-AC-20, AC-23; CT-F16-03, CT-F16-07, CT-F16-08, CT-F16-10.
   - **Visible result:** Preferences shows the five named policy presets, the effective default, task-floor explanations, maximum-turn control, isolated-worktree root control, and polling/quiet controls. The UI distinguishes unsupported Interactive Approvals from a valid selection and shows the exact typed next action.
   - **Durable records / external effects:** F03 stores policy/operational revisions and F16 records typed handoff metadata. F13/F12/F17 receive values through their ports; no timer, worktree, process, or provider starts because a setting was edited.
   - **Failure / cancellation / restart:** Unsupported policy capabilities fail closed; read-only floors cannot be lowered; invalid roots are rejected without file mutation; values outside 1-10 or one-minute-through-24-hour bounds are rejected; a root change never relocates active worktrees; restart retains committed values.
   - **Exact evidence:** Full preset/task-phase capability matrix; no-broadening and no-publication-authority fixtures; max-turn boundary table; F13 root invalid/valid/future-only table; F12 default/bounds handoff; F16-B06 transport-bound and delegated-bound-missing cases; no-timer/no-worktree/no-provider spies; restart/concurrency evidence; CT-F16-03, CT-F16-07, CT-F16-08, and CT-F16-10.
   - **Exit criterion:** AC-05-AC-10, AC-18-AC-20, and AC-23 pass and F13/F12/F17 can consume one revisioned operational-preference contract without reconstructing settings from the renderer.

3. **Common Instruction profiles and repository Build & Validation settings**
   - **Blocked by:** Slices 1-2; F00 versioned validation/trust contract; F03 repository-keyed settings; F07 explicit repository identity; F15 input-context contract.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-04.1-FR-05.5, FR-08.1-FR-08.3; NFR-01-NFR-05, NFR-08; INV-01, INV-02, INV-06-INV-08; AC-11-AC-15, AC-18-AC-20, AC-23; CT-F16-04, CT-F16-05, CT-F16-08, CT-F16-10.
   - **Visible result:** The Preferences area supports bounded Common Instruction CRUD with enabled/selected/order state and shows a repository-specific Build & Validation editor where prose is visibly separate from F00 structured commands, phases, trust, and source/hash status.
   - **Durable records / external effects:** F03 stores Common Instruction revisions, active selection/order, and repository-keyed guidance/settings. F00 owns structured profile resolution and authorization; no validation command or provider call runs from a save.
   - **Failure / cancellation / restart:** Duplicate selections, missing repository identity, invalid F00 candidates, untrusted changes, oversized/secret-shaped text, stale writes, and persistence faults fail without partial state. An AI-proposed command remains untrusted until the F00 authorization path is used. Existing snapshots retain prior text/revisions after edits.
   - **Exact evidence:** Profile lifecycle/order matrix; exact selected-set inclusion fixture; F16-B03/B04 below-exact-above matrix; application-versus-PR storage scan; F00 source/trust/hash/no-profile matrix with explicit delegated-limit metadata; prose-versus-command authority negative test; restart/old-snapshot readback; IPC and accessibility evidence; CT-F16-04, CT-F16-05, CT-F16-08, and CT-F16-10.
   - **Exit criterion:** AC-11-AC-15, AC-18-AC-20, and AC-23 pass, and F18/F21/F26 can request repository/common-instruction context without importing F00 internals or reading mutable settings directly.

4. **Immutable effective snapshot builder and downstream task routing**
   - **Blocked by:** Slices 1-3; F03 commit-before-effect handoff; F15 normalized request/profile/policy schemas; F17 operation/segment input port; F07 PR Intent / Context snapshot; F13 operation scope.
   - **Stories / requirements / acceptance criteria:** US-07-US-08; FR-02.1-FR-06.5, FR-08.1-FR-08.4; NFR-01-NFR-06, NFR-08; INV-01-INV-10; AC-03-AC-04, AC-06-AC-08, AC-12-AC-13, AC-15-AC-19, AC-22-AC-23; CT-F16-02, CT-F16-03, CT-F16-04, CT-F16-05, CT-F16-06, CT-F16-09, CT-F16-10.
   - **Visible result:** A fake Automatic Review, Review Revision, Read-only Conversation, and Merge Conflict Resolution consumer obtains the same typed `EffectiveAITaskSnapshot` shape. The snapshot visibly identifies task type, profile/policy revisions, provider/model/reasoning, Common Instructions, Build & Validation provenance, PR Intent / Context, task floor, user-readable policy summary, and `boundsRevision`.
   - **Durable records / external effects:** The owning F17/F18/F21/F26 operation persists the complete snapshot through F03 before invoking F15. F16 writes no AI turn, Git, validation, GitHub, or publication effect.
   - **Failure / cancellation / restart:** Missing/disabled/unknown task profiles, policy capability failures, F00 trust failures, F13 scope failures, missing/ambiguous delegated bounds, changed input hashes, stale settings, over-limit snapshots, and serialization errors return typed refusals. A snapshot remains byte-equivalent after restart; editing current Preferences cannot mutate it; only an explicit continuation/re-evaluation requests a new one.
   - **Exact evidence:** Four-task snapshot matrix; proposal/conversation floor tests; full revision/hash/provenance/boundsRevision round trip; F16-B08 below-exact-above and no-truncation cases; PR Intent / Context old/new comparison; F15/F17/F18/F21/F26 thin-consumer tests; persist-before-provider fault injection; changed-Preferences isolation and explicit-new-segment test; CT-F16-06, CT-F16-09, and CT-F16-10.
   - **Exit criterion:** AC-03-AC-04, AC-06-AC-08, AC-12-AC-13, AC-15-AC-19, and AC-22-AC-23 pass, and every AI-capable downstream feature can use the same F16 resolution boundary.

5. **End-to-end Preferences surface, recovery, security, and implementation handoff**
   - **Blocked by:** Slices 1-4 and the final F03/F04/F15/F00/F12/F13 contracts.
   - **Stories / requirements / acceptance criteria:** US-01-US-10; all FRs, NFRs, and INVs; all AC-01-AC-23; CT-F16-01-CT-F16-10; APP-AC-32-APP-AC-37, APP-AC-41-APP-AC-42, APP-AC-54, APP-AC-59-APP-AC-62, APP-AC-64, APP-AC-70-APP-AC-71, APP-AC-74.
   - **Visible result:** A packaged or production-mode desktop fixture can open Preferences, configure all F16 settings, show validation/revision/policy/provenance summaries, save/reload them after renderer closure, and hand an immutable snapshot to fake downstream operations. Keyboard, forced-colors, stale-write, restart, and actionable-error behavior are demonstrated.
   - **Durable records / external effects:** The end-to-end fixture leaves only bounded test-owned settings/revision/snapshot records under a temporary application data path. It uses no real credentials, provider, GitHub server, worktree, command, or publication service.
   - **Failure / cancellation / restart:** Any unresolved migration/transaction, stale revision, policy broadening, task misrouting, secret/SDK leak, command-authority confusion, renderer-owned state, definite linter miss, or invalid application mapping blocks the handoff. Cancellation leaves no success marker and a rerun starts from fresh test-owned state.
   - **Exact evidence:** `npm run check`; F16 unit/contract/integration report; settings/revision/snapshot migration/readback report; capability/policy matrix; F00/F12/F13 handoff report; IPC/accessibility/forced-colors probe; static SDK/publication/credential scan; thin-consumer conformance; `git diff --check`; `npm run lint:prd-plan -- Specs/ai_preferences_task_profile_snapshots_execution_policies_and_common_instructions_PRD.md Specs/ai_preferences_task_profile_snapshots_execution_policies_and_common_instructions_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/ai_preferences_task_profile_snapshots_execution_policies_and_common_instructions_PRD.md`.
   - **Exit criterion:** All F16 requirements have direct acceptance or named contract-test evidence, all mapped application criteria have no definite missing/invalid result, the two specification linters pass with any low-confidence results explicitly dispositioned, and F16 remains unchecked until implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/ai_preferences_task_profile_snapshots_execution_policies_and_common_instructions_PRD.md`; this PLAN does not add provider invocation, validation execution, Git/worktree mutation, scheduler timers, review-bundle decisions, synchronization publication, or publication authority.
- F03 remains the only owner of SQLite migrations and generic transactional persistence. F16 supplies codecs, revision semantics, and repository calls but never writes ad hoc SQL or treats an activity log as state.
- F04 remains the only owner of renderer/main IPC validation and lifecycle authority. Closing/recreating the renderer cannot erase a committed settings change or change an immutable task snapshot.
- F15 remains the only production importer of the Codex SDK. F16 consumes capability descriptors and produces provider-neutral snapshots; it never constructs SDK requests, threads, environments, or credentials.
- F00 remains authoritative for validation schema versions, source precedence, normalized hashes, trust/authorization, phase tags, command safety, and no-profile outcomes. F16 renders and snapshots those results without making prose executable.
- F16-B01-F16-B08 are normative: every F16-owned value is checked below/exactly/above its bound, every delegated F00/F04/F13/F15 value carries an explicit versioned bound, and missing or insufficient metadata fails closed before persistence, IPC, provider start, or prompt construction.
- F12 remains authoritative for polling/quiet timers, batching, pause, sleep/wake, and scheduler recovery. F16 provides Preferences and revisioned typed values only.
- F13 remains authoritative for canonical root validation, operation-owned paths, current worktree state, and root/path safety. F16 never moves or deletes an existing worktree.
- F17 owns the AI Work Operation/segment, maximum consumed-turn budget, timeouts, continuation authorization, and progress decisions. F16 supplies the configured maximum and immutable segment input; a settings edit never resets F17 state.
- F18/F21/F26 choose workflow-specific context and human intent. They must call F16 with an explicit task type and preserve the returned snapshot; they must not bypass it with provider/model/policy values in prompt text.
- All F16 tests use fake capability/F00/F12/F13/F17 consumers and test-owned temporary paths. No test reads or reports credentials, calls a real provider, contacts GitHub, mutates a developer worktree, or executes repository-controlled validation.
- The F16 checklist item remains unchecked during specification and implementation planning. Creating these documents does not claim Preferences, profile resolution, policy snapshots, or downstream AI behavior is implemented.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 4-5 |
| FR-02 | 1, 4-5 |
| FR-03 | 2, 4-5 |
| FR-04 | 3-5 |
| FR-05 | 3-5 |
| FR-06 | 4-5 |
| FR-07 | 2, 5 |
| FR-08 | 1-5 |
| NFR-01-NFR-08 | 1-5 |
| INV-01-INV-10 | 1-5 |
| APP-AC-32-APP-AC-37 | 1-3, 5 |
| APP-AC-41-APP-AC-42 | 3-5 |
| APP-AC-54 | 2, 4-5 |
| APP-AC-59-APP-AC-62 | 1-5 |
| APP-AC-64 | 1, 4-5 |
| APP-AC-70-APP-AC-71 | 2, 4-5 |
| APP-AC-74 | 3-5 |


## Issue 1 supplement: Mandatory setup configuration

Approved scope: [resumable setup on startup](https://github.com/bryant-collab/PRMonitor/issues/1). All four durable independent task profiles must be enabled, validated and AVAILABLE. Provider/model/options/task bounds are rechecked against the registered provider. The effective policy and operational settings must be valid and compatible with each task, including workspace-write for mutating revision/conflict tasks. Defaults need no acknowledgement; optional common instructions, repository overrides and tuning do not gate readiness. Existing profile editors and Apply to All semantics remain authoritative; no setup progress flags or shadow profile state are persisted.

Evidence: the setup readiness/local/provider/IPC/renderer/recovery tests, repository `npm run check`, and six-process production Electron `npm run test:setup`. See `docs/evidence/setup-readiness/README.md` for scenario mapping, retained screenshots, and exact residual manual coverage. Existing F03/F05/F13/F19/F29 owners keep their persistence, credential, filesystem, lifecycle and security rules.
