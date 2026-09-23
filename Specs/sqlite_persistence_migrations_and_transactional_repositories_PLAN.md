<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan. There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this feature is a persistence foundation.
-->

# Plan: F03 SQLite Persistence, Migrations, and Transactional Repositories

> **Document status:** Implemented persistence foundation and F15 typed-handoff conformance
>
> **Owning PRD:** `Specs/sqlite_persistence_migrations_and_transactional_repositories_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-23 and F03 PRD/F15 approved ownership split revision 2026-09-23
>
> **Entry/readiness gates:** F01's supported Electron/Node workspace, main-process boundary, test harness, and stable application-data-path input are complete. F02 domain records, state machines, holds, immutable references, staged review decisions, safe reasons, and publication idempotency contracts are available. F00 validation schemas and phase meanings are available. The implementation may add SQLite and main-process persistence code, but it must not require GitHub, Git, an AI provider, a renderer window, or product-service credentials.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F03 adds a main-process persistence package, proposed as `apps/desktop/src/main/persistence`, plus renderer-safe serialized DTO/codec definitions under the F01 shared boundary when later IPC needs them. The package owns SQLite bootstrap, safe connection settings, migration and backup lifecycle, integrity checks, transaction coordination, versioned codecs, and typed repositories. It does not own the domain decisions that F02 reducers make; it stores and atomically commits their results.

The database is authoritative for durable mutable state and historical evidence. A current projection is a query optimization, not a replacement for immutable event versions, transition history, operation records, publication intents, or external-effect evidence. The renderer, provider threads, GitHub SDK, Git processes, worktree files, and activity prose remain outside the authority boundary.

The schema must cover the following conceptual record families from the application overview and F03 PRD:

```text
settings, validation/build profiles/approvals, common instructions,
AI task-profile revisions, execution-policy presets,
GitHub servers, repositories, resource checkpoints, pull requests,
remote event versions, observed-resource versions,
review batches, staged review bundles, bundle items/decisions, holds, transitions,
AI work operations, segments, turns, conversations, usage/report data,
validation runs/steps/manual checks,
branch-sync batches/operations/conflicts/results, merge-base and both-side intent/consultation evidence,
worktrees, diffs, publication intents, per-response outcomes,
activity/audit events, migration/health/backup metadata
```

## Readiness Gates

- F01 root build, typecheck, lint, format, tests, production smoke, and workspace-boundary checks pass from the repository root.
- F02 public domain contracts are available and their conformance tests pass, including append-only history, hold admission, optimistic conflict semantics, synchronization overlays, and publication recovery states.
- F00's validation-profile schema and contract tests pass; F03 stores its snapshots/results but does not reinterpret or regenerate the contract.
- The application-data-path owner provides a stable, validated database path and a separate application-owned backup root. F03 does not derive paths from PR URLs, worktree paths, or renderer input.
- The chosen SQLite driver has a compatibility spike for the pinned Electron/Node runtime, transaction behavior, WAL/journal behavior, backup/restore, busy handling, packaging, and process-termination recovery. Driver selection cannot alter the repository or schema contracts.
- Test infrastructure supports temporary database files, deterministic clocks, process termination/fault injection, concurrent repository calls, and secret-shaped fixture scans without product-service access.

## Proposed Vertical Slices

1. **SQLite compatibility, bootstrap, health, and migration ledger**
   - **Blocked by:** Readiness gates above; the SQLite driver compatibility spike is the only implementation choice that must be resolved before production persistence code starts.
   - **Stories / requirements / acceptance criteria:** US-01-US-03; FR-01.1-FR-01.5; FR-02.1-FR-02.7; FR-08.5-FR-08.6; NFR-01, NFR-03-NFR-05, NFR-07-NFR-09; INV-01, INV-07, INV-10; AC-01-AC-03, AC-18-AC-19.
   - **Implementation:** Add a driver adapter and database bootstrap that accepts only the validated main-process path. Enable foreign keys and the tested crash/durability settings, set a bounded busy timeout, and return structured health data. Add ordered migration definitions, stable IDs, checksums, applied-version metadata, pre-migration backup creation/verification, post-migration integrity and foreign-key checks, and ownership-marked bounded backup retention. Refuse edited historical migration checksums, unsupported schema versions, corrupt files, failed backups, and failed integrity checks. Do not create an empty replacement after a failure.
   - **Visible result:** A deterministic persistence diagnostic reports `healthy`, `upgraded`, or a specific recovery-required state for an empty database, current database, each supported upgrade fixture, corrupt database, checksum mismatch, failed backup, and failed integrity case.
   - **Durable records / external effects:** Creates the SQLite file, migration ledger, health metadata, and verified pre-migration backup. No GitHub, Git, AI, renderer, or publication effect occurs.
   - **Failure / cancellation / restart:** A migration is all-or-nothing. Cancellation before commit leaves the source schema unchanged. A process stop is recovered by SQLite before the next health check. Backup cleanup verifies ownership and containment and refuses uncertain deletion. Reopening a current database is idempotent.
   - **Exact evidence:** Driver/runtime compatibility report; empty/current/upgrade fixture matrix; migration-order and checksum tests; backup reopen plus integrity/foreign-key verification; edited-history rejection; unsupported-version rejection; process-stop recovery test; corruption and failed-backup preservation test; path/ownership/reparse-point cleanup test; safe diagnostic scan; `git diff --check`.
   - **Exit criterion:** AC-01-AC-03 and AC-18 pass, no migration failure can silently reset data, and later slices can obtain a healthy connection or a structured recovery result.

2. **Versioned codecs, transaction coordinator, and commit-before-effect boundary**
   - **Blocked by:** Slice 1 and F02 serialized domain contracts.
   - **Stories / requirements / acceptance criteria:** US-07-US-09; FR-03.1-FR-03.7; FR-05.1, FR-05.6; FR-08.1, FR-08.4-FR-08.6; NFR-01-NFR-03, NFR-05-NFR-08; INV-01-INV-05, INV-08; AC-05-AC-09, AC-16-AC-19.
   - **Implementation:** Define typed repository and transaction ports, validated row/snapshot codecs, schema-version dispatch, content-hash helpers, bounded field sizes, safe reason constructors, correlation IDs, and current-projection/history separation. Implement read/write transaction helpers with commit/rollback, parameterized statements, bounded busy retry, injected failure points, and explicit post-commit semantics. Provide a transaction operation that persists an operation intent and mutable-input snapshot before its consumer starts an external effect.
   - **Visible result:** A fault-injection harness shows atomic commit, rollback, busy retry, stale-version conflict, duplicate replay, cancellation-before-commit, and cancellation-after-commit as distinct deterministic outcomes.
   - **Durable records / external effects:** Adds shared DTO/codec definitions, transaction metadata, and repository infrastructure. Test databases and bounded reports are temporary; no product external side effect is launched.
   - **Failure / cancellation / restart:** A constraint or injected error between any two related writes rolls back the full transaction. A committed transaction remains visible after cancellation or process exit. Stale version/owner updates return a conflict and do not release holds or rewrite terminal history. Unknown schema versions fail closed.
   - **Exact evidence:** Transaction boundary fault table; parameterization/static SQL review; row/snapshot round trips; unknown-version/oversize/malformed-record rejection; busy retry with bounded attempts; commit acknowledgement and process-stop fixtures; compare-and-swap race; duplicate idempotency-key replay; secret/raw-SDK/prompt scan; restart readback.
   - **Exit criterion:** AC-05-AC-09 and AC-16-AC-19 pass, and every downstream repository can use one transaction contract without ad hoc SQL or invented retry semantics.

3. **Settings, validation, server, repository, checkpoint, and managed-PR repositories**
   - **Blocked by:** Slice 2; F00 and F02 contracts.
   - **Stories / requirements / acceptance criteria:** US-01, US-06, US-10-US-11; FR-04.1-FR-04.2; FR-05.1, FR-05.6; FR-08.1-FR-08.5; NFR-03, NFR-05-NFR-08; INV-01, INV-02, INV-06, INV-08; AC-01, AC-05-AC-06, AC-09, AC-15, AC-19.
   - **Implementation:** Add normalized tables and repositories for application settings, F00 validation/build profile/approval/snapshot records, Common Instruction and AI profile revisions, execution-policy presets, GitHub server safe metadata, repositories/default-branch informational metadata, independently scoped resource checkpoints, and managed PRs with base/head repository identities, branches, SHAs, intent/context, override, primary state, and persisted version. Store credential-store references/metadata only; F05 owns secret acquisition. Preserve profile, Build & Validation Instruction, and PR snapshots used by later work.
   - **Visible result:** A repository fixture can create, update, close, reopen, and read settings and a managed PR after a fresh process, while a profile/PR revision snapshot remains unchanged after the source setting is edited.
   - **Durable records / external effects:** Adds tables, indexes, foreign keys, safe references, and query projections. It makes no credential-store, GitHub, Git, or renderer call.
   - **Failure / cancellation / restart:** Duplicate server/repository/PR identities are rejected or return the existing row according to the repository contract. Editing current settings never mutates historical snapshots. A stale PR update returns a conflict. Missing credential references remain actionable metadata, never plaintext fallback.
   - **Exact evidence:** Fresh/current/upgrade repository fixtures; uniqueness and foreign-key matrix; profile/PR snapshot immutability test; resource-checkpoint independence test; safe credential-reference test; stale update race; restart readback; query projection versus history comparison; secret scan.
   - **Exit criterion:** Settings, validation, server, repository, checkpoint, and managed-PR records satisfy FR-04.1-FR-04.2 and all related restart/secret/concurrency evidence passes.

4. **Immutable remote versions, review batches, bundles, holds, and handled associations**
   - **Blocked by:** Slices 2-3 and F02 event/hold/bundle contracts.
   - **Stories / requirements / acceptance criteria:** US-04-US-05, US-08-US-11; FR-04.3-FR-04.4; FR-05.1-FR-05.7; FR-08.1-FR-08.3; NFR-01-NFR-06, NFR-08; INV-02-INV-05, INV-08-INV-09; APP-AC-14, APP-AC-24, APP-AC-69; AC-04, AC-05, AC-07-AC-09, AC-12, AC-19.
   - **Implementation:** Add scoped immutable remote-event/version tables, content-hash uniqueness, resource-observation metadata, review batches, staged Review Bundles/items, per-item human decisions/question answers, hold records, transition history, current projections, and handled-version associations. Commit bundle inputs, proposal/final stage, snapshots, item associations, transition, hold, and projection atomically. Make duplicate version insertion, duplicate bundle association, and replayed decision submission return the existing durable result. Keep versions observed during a hold separate from the active bundle.
   - **Visible result:** A deterministic fixture takes a PR from observed event versions to a persisted proposal-stage Review Bundle, records complete per-item decisions, transitions to implementation/final review, replays the same delivery, observes a new semantic version during a hold, publishes/discards the old bundle, and reconstructs all history after restart without a duplicate automatic operation.
   - **Durable records / external effects:** Creates the core review history and closes the persistence portion of APP-AC-14, APP-AC-24, and APP-AC-69. No remote event is fetched and no notification or AI work starts.
   - **Failure / cancellation / restart:** A failure at each insert boundary rolls back the complete bundle/hold decision. Duplicate/replayed versions are idempotent; changed semantic content creates a new version. Discard/publish does not delete handled history. A stale writer cannot attach a new version to the held bundle or release the hold.
   - **Exact evidence:** Review Bundle atomicity fixture; scoped identity/content-hash matrix; immutable update rejection; duplicate association/decision replay; held-feedback retention; handled-after-publish/discard monotonicity; F02 transition/hold/decision conformance; concurrent bundle admission; restart reconstruction; application-coverage evidence for APP-AC-14/24/69/71/72.
   - **Exit criterion:** AC-04 and AC-07-AC-09 pass, AC-19-AC-23 are represented in persistence evidence, and F11/F18 can persist/recover staged review work without changing F02 semantics.

5. **AI, conversation, validation, worktree, and synchronization evidence repositories**
   - **Blocked by:** Slices 2-3 and the F00/F02 serialized contracts.
   - **Stories / requirements / acceptance criteria:** US-06, US-10-US-11; FR-04.5-FR-04.6; FR-06.1-FR-06.6; FR-08.1-FR-08.5; NFR-01-NFR-06, NFR-08-NFR-09; INV-01-INV-06, INV-08-INV-09; APP-AC-49, APP-AC-55, APP-AC-64; AC-10-AC-15, AC-19.
   - **Implementation:** Add repositories for AI Work Operation/segment/turn/conversation records, task profile and execution-policy snapshots, usage/report metadata, validation runs/steps/manual attestations, operation-owned worktrees/diffs, synchronization batches/results/conflicts, merge-base and source-side/PR-head-side change evidence, ambiguity/user-consultation records, status transitions, structured reasons, and append-only activity/audit events with correlation IDs. Store deterministic observations separately from model-reported fields. Commit the operation segment and consumed-count baseline before a turn; commit each turn exactly once; keep each synchronization result and diagnostic history independent and fully reviewable.
   - **Visible result:** Two fixture consumers—one review operation and one synchronization operation—read the same provider-neutral repositories and show complete evidence after renderer closure/restart, including budgets, reports, validation, worktree, exact source/head/merge-base SHAs, both-side conflict evidence, consultation records, status, and next-action reason data.
   - **Durable records / external effects:** Adds operation/evidence tables, indexes, foreign keys, and read models. It does not invoke an AI provider, run validation, create a worktree, perform a Git merge, or contact GitHub.
   - **Failure / cancellation / restart:** A turn timeout/failure can be stored once with its evidence and stop reason. Restart preserves consumed counts and does not authorize a new turn. One synchronization result can fail or retry without mutating another. Missing optional provider references remain valid deterministic records. Model claims cannot turn deterministic evidence into success.
   - **Exact evidence:** AI operation/turn round trips; budget-not-reset-on-restart fixture; exactly-once turn report test; safe opaque conversation/reference limits; validation-status truth table; sync-result field completeness table including merge-base and both-side conflict evidence; per-result isolation race; exact SHA/worktree snapshot test; APP-AC-49/55/64/77 coverage evidence; provider SDK/prompt/credential import and serialization scan.
   - **Exit criterion:** AC-10-AC-15 pass and the later F14-F18/F24-F27 services can consume one stable evidence contract.

6. **Publication, response, stale-history, and uncertain-outcome repositories**
   - **Blocked by:** Slices 2 and 5, plus F02 publication-phase contracts.
   - **Stories / requirements / acceptance criteria:** US-07-US-09, US-11; FR-07.1-FR-07.8; FR-08.1-FR-08.5; NFR-01-NFR-06; INV-02-INV-06, INV-08-INV-09; APP-AC-68; AC-05-AC-06, AC-12, AC-16-AC-17, AC-19.
   - **Implementation:** Add publication intent, approval reference, baseline/source/head verification snapshot, idempotency key, phase/recovery state, commit/push evidence, per-response pending/posted/failed rows, remote IDs, and stale-bundle history records. Guard phase changes with persisted version/owner. Store synchronization publication independently from Review Bundle publication. Expose no repository method that can be interpreted as provider publication authority.
   - **Visible result:** A fault-injected publication fixture persists approval, prepares an intent, records a known commit or response ID, loses the process/network, reopens in recovery, and reconciles with the same key; response-only failure reaches `PUBLISHED_WITH_ERRORS` without a second code intent.
   - **Durable records / external effects:** Creates publication/effect evidence only. The test uses fakes; no real commit, push, GitHub response, or force push occurs.
   - **Failure / cancellation / restart:** Failure before commit rolls back the publication transaction. Failure after a possible side effect preserves `UNKNOWN`/`RECOVERING` evidence and known IDs. Duplicate retry returns the existing record. A stale writer cannot replace an approved intent or known remote identifier.
   - **Exact evidence:** Explicit-approval-before-intent test; stable-key uniqueness; commit/push/response uncertain-outcome matrix; known-ID preservation; `PUBLISHED_WITH_ERRORS` no-republish guard; separate synchronization/review publication history; restart and UI-closure fixture; no-force-push/autonomous-provider negative test; APP-AC-68 coverage evidence.
   - **Exit criterion:** AC-16-AC-17 pass and F23/F27/F28 can implement deterministic publication/reconciliation without inventing persistence states or idempotency rules.

7. **Cross-consumer restart, migration, security, and F03 handoff**
   - **Blocked by:** Slices 1-6.
   - **Stories / requirements / acceptance criteria:** US-01-US-11; all FRs, NFRs, and INVs; APP-AC-14, APP-AC-24, APP-AC-49, APP-AC-55, APP-AC-64, APP-AC-68, APP-AC-69, APP-AC-77; AC-01-AC-19.
   - **Implementation:** Run one shared conformance suite through thin review and synchronization consumers. Exercise restart after every durable phase, migration backup/restore, busy/locked retry, duplicate delivery, concurrent writers, stale updates, corruption, redaction, bounded fields, and safe diagnostics. Document the driver choice, schema version, repository contracts, health/recovery result, and the exact handoff rules for F04, F10-F18, F23-F29.
   - **Visible result:** A machine-readable persistence evidence report demonstrates that the same database can be reopened and queried by both consumers, that every covered application criterion has an owning repository contract, and that no renderer/provider/network dependency is needed.
   - **Durable records / external effects:** Keeps only declared temporary databases/backups and bounded reports under test-owned paths. It does not change checklist state, publish specs, or call external services.
   - **Failure / cancellation / restart:** A cancelled test run leaves no success marker; rerun starts from a fresh owned fixture. Any mismatch, secret leak, partial commit, missing recovery marker, or cross-result mutation fails the gate. F03 never auto-authorizes continuation, AI work, publication, or a replacement database.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; migration/backup/integrity report; transaction fault report; repository coverage matrix; restart/fault-injection report; concurrency/idempotency report; secret and forbidden-import scan; `git diff --check`; both required specification-linter reports against the final PRD/PLAN.
   - **Exit criterion:** All F03 requirements and mapped criteria have direct evidence, no definite missing or invalid linter mappings remain, and the F15 normalized AI handoff is accepted by typed repositories with no SDK/prompt/credential leakage.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/sqlite_persistence_migrations_and_transactional_repositories_PRD.md`; this PLAN does not add UI, GitHub, Git, AI, validation-execution, notification, or publication requirements beyond durable contracts and evidence.
- F03 must preserve F02's provider-neutral IDs, state transitions, holds, immutable event-version associations, optimistic conflict behavior, synchronization overlays, and publication recovery semantics. A repository is not allowed to introduce a competing state machine.
- F00 validation-profile schemas and status meanings are consumed as versioned contracts. F03 stores snapshots/results and approvals; F14 owns command execution and F16 owns settings UI/trust interaction.
- F04 may expose F03 through validated main-process IPC, but renderer closure cannot cancel a transaction, reset a budget, release a hold, or make a projection authoritative.
- F05 owns secure credential-store access. F03 may store server metadata and an opaque credential reference, but never a token, secret, provider prompt, or uncontrolled environment value.
- F10/F11 own remote observation, normalization, semantic hashing, and eligibility. F03 owns immutable storage, uniqueness, association, and history; it must not infer event meaning from free-form text.
- F13/F14 own Git/worktree and validation effects. F03 records their operation-owned identities, snapshots, outputs, status, and reasons using bounded/versioned codecs.
- F15 owns provider adapters, normalized contracts, and the serializable `AIProviderTurnResult`; F17 owns operation/segment lifecycle, budgets, and continuation decisions; F03 persists the provider-neutral handoff and deterministic observations without importing the SDK or granting publication authority.
- F18-F28 own workflow orchestration and external side effects. F03 supplies commit-before-effect, recovery, idempotency, and per-result isolation; it never calls GitHub, Git, a provider, or a child process as part of a repository write.
- F03's persistence baseline and F15 typed-handoff follow-up are implemented. The typed operation/turn/conversation repositories record the normalized handoff exactly once, reject incompatible replays and unsafe fields, and round-trip it after restart; the production provider adapter remains F15-owned.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
| --- | --- |
| FR-01, FR-02 | 1, 7 |
| FR-03 | 2, 7 |
| FR-04.1-FR-04.2 | 3, 7 |
| FR-04.3-FR-04.4 | 4, 7 |
| FR-04.5-FR-04.7 | 5, 6, 7 |
| FR-05 | 2-7 |
| FR-06 | 5, 7 |
| FR-07 | 6, 7 |
| FR-08 | 2-7 |
| NFR-01-NFR-09 | 1-7 |
| INV-01-INV-10 | 1-7 |
