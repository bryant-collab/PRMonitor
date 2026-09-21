<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal is to provide the AI and the user with a visible and testable result when the work is complete.
-->

# Plan: F05 Secure GitHub Server Profiles and Authentication

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `Specs/secure_github_server_profiles_and_authentication_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-20 and F05 PRD revision 2026-09-20
>
> **Entry/readiness gates:** F03 persistence health, migration, transaction, and GitHub-server repository contracts are green. F04 main-process ownership, validated IPC, renderer-session lifecycle, and lifecycle recovery seams are available. The pinned Electron runtime can report host secure-storage availability on a supported Windows test host. Test infrastructure provides injectable clocks, cancellation, HTTP transport, secure-store fakes, restart/fault injection, bounded redaction assertions, and secret-shaped fixture scans. No real GitHub credential or credentialed network access is required for default build/check/test commands.
>
> This PLAN cannot change product requirements. Resolve contradictions in the owning PRD before implementation and rerun both specification linters. This feature does not check the checklist item; implementation and approval are separate.

## Implementation Boundary

F05 extends the main-process application under `apps/desktop/src/main` and `apps/desktop/src/shared`. It adds a canonical GitHub server-profile contract, a host-backed secure credential-store adapter, a narrow GitHub credential broker, durable credential-operation coordination, a deterministic read-only connection tester, and the server-settings read model/IPC commands needed by the renderer.

The feature consumes F03's SQLite and transaction boundary and adds only additive F05 migration/repository records through that boundary. The renderer receives safe server/profile state and submits a token only through the dedicated one-time credential route defined by F04. The credential broker is the only F05 surface that may read the active token, and it exposes request-scoped access only to deterministic GitHub infrastructure.

F05 does not implement general GitHub REST resources, PR URL parsing, polling, pagination, Git remote authentication, worktrees, AI, validation commands, notifications, publication, or remote mutation. F06 owns the general GitHub REST client and consumes the F05 authentication contract. F23/F27 own explicit publication authorization and effects.

## Readiness Gates

- F03 `initializePersistence`, schema health, transaction commit-before-effect behavior, and the existing safe GitHub server repository are available in the main process.
- F04's IPC allowlist can represent one dedicated secret-submission operation with a strict schema, no echo response, no event broadcast, and no generic secret-shaped payload logging; all other F04 IPC remains secret-free.
- The supported Electron runtime's host-backed secure storage has been validated on Windows using synthetic data. The implementation refuses unavailable or weak backends and does not use a plaintext fallback.
- The canonical endpoint rules are agreed: GitHub.com uses `https://api.github.com`; standard GHES uses the same HTTPS origin with `/api/v3`; cross-origin redirects, TLS bypasses, HTTP, and arbitrary API hosts are rejected.
- F03 migration/repository changes have a versioned schema and recovery plan for server credential status, active/candidate revisions, credential operation intent, test outcomes, and cleanup/recovery state.
- The test harness can terminate the process between each durable/external transition and can prove that synthetic token values, authorization headers, ciphertext, and raw error bodies do not appear in committed evidence or ordinary diagnostics.

## Proposed Vertical Slices

1. **Canonical server profiles and safe persistence/read model**
   - **Blocked by:** F03 repository/transaction contracts and F04 main-process composition; no credential-store implementation is required.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-08; FR-01.1-FR-01.5, FR-06.1, FR-06.3-FR-06.5, FR-07.1-FR-07.4; NFR-02, NFR-04-NFR-08; INV-01-INV-03, INV-05-INV-09; AC-01-AC-02, AC-09, AC-18.
   - **Implementation:** Define versioned shared `ServerProfile`, canonical identity, server-kind, safe status, verification metadata, and reason contracts. Normalize HTTPS GitHub.com/GHES origins and derive the documented API base. Add an additive F03 migration and repositories for canonical server uniqueness, safe active/candidate credential revisions, verification metadata, and bounded F05 operation references; do not add token fields. Add a main-process read model and an initial settings view that can create/rename/list an unverified profile without accepting or displaying a secret. A display-name edit preserves the canonical identity and active credential; changing the canonical origin creates a newly verified identity rather than silently reusing the old credential.
   - **Visible result:** The settings screen can add `github.com` or a GHES origin, displays the canonical web/API identities and an unverified status, rejects unsafe or duplicate identities, survives a renderer close/reopen, and shows safe reason data.
   - **Durable records / external effects:** Writes only canonical server metadata, profile versions, safe status/reason fields, and migration/repository records. No secure-store, network, Git, AI, validation, or publication effect occurs.
   - **Failure / cancellation / restart:** Malformed URLs, insecure schemes, ambiguous paths, duplicate identities, oversized fields, and conflicting versions fail before persistence. A failed migration preserves the F03 recovery behavior. A profile can remain unverified and visible; no profile read model contains a token, credential bytes, or store path.
   - **Exact evidence:** Canonicalization truth table for GitHub.com/GHES, case/trailing-slash/duplicate matrix, userinfo/query/fragment/path/scheme rejection corpus, API-base derivation table, optimistic-concurrency race, safe read-model schema scan, restart/reopen fixture, accessible form labels/focus test, additive migration fixture, and `git diff --check`.
   - **Exit criterion:** AC-01, AC-02, AC-09, and AC-18 pass; F05 has one versioned safe profile/read-model contract and no persistence path that can hold token material.

2. **Host-backed credential store and one-time credential submission**
   - **Blocked by:** Slice 1, F04 validated IPC/session contracts, and the Windows safe-storage readiness gate.
   - **Stories / requirements / acceptance criteria:** US-02, US-07-US-08; FR-02.1-FR-02.5, FR-05.1-FR-05.6, FR-06.2, FR-07.1-FR-07.4; NFR-01, NFR-03-NFR-05, NFR-08; INV-01-INV-04, INV-06, INV-08; AC-03, AC-04, AC-09, AC-16-AC-18.
   - **Implementation:** Add a `SecureCredentialStore` port and the Windows MVP adapter backed by Electron `safeStorage`, with explicit availability/weak-backend checks. Store each candidate under a versioned opaque reference outside SQLite; expose create/read-for-authorized-request/retire/cleanup ports but no generic renderer read. Add a strict one-time preload/main IPC route for credential submission with bounded input, no echo result, no telemetry, no broadcast, and renderer-control clearing. Any connection-test or later deterministic GitHub infrastructure process/request receives an explicitly constructed environment/capability and never inherits unrelated parent-process environment secrets. Add static dependency rules so AI, validation, Git, notification, activity, and renderer read-model modules cannot import the store or broker.
   - **Visible result:** A developer can enter a masked synthetic token for an unverified profile, submit it, see only a pending/accepted safe result, and confirm that the token is not present in the renderer read model, IPC response, activity event, or persisted SQLite record. A backend-unavailable state explains why saving is blocked.
   - **Durable records / external effects:** The host secure store receives a synthetic candidate value in tests and a real user token only in the product flow. SQLite receives an opaque reference/revision and safe operation metadata; no plaintext or ciphertext is written to SQLite.
   - **Failure / cancellation / restart:** Unavailable, weak, not-ready, oversized, malformed, or failed store operations do not fall back to plaintext. Renderer destruction drops only the reply; main-process store work follows its operation contract. Store exceptions are bounded/redacted. A fake-store failure cannot leave a profile marked verified.
   - **Exact evidence:** Windows `safeStorage` synthetic round trip with no value/ciphertext output; availability and weak-backend matrix; masked-input/clear-after-submit test; dedicated IPC allowlist and no-echo test; oversized/secret-shaped payload corpus; renderer disconnect fixture; forbidden-import/static boundary report; SQLite/read-model/activity secret scan; safe error serialization test; keyboard/screen-reader form check.
   - **Exit criterion:** AC-03, AC-04, AC-09, and AC-16-AC-18 pass; a token can enter the application only through the intentional narrow path and can leave it only through the deterministic GitHub credential boundary.

3. **Persist-before-effect credential operations and recovery**
   - **Blocked by:** Slices 1-2 and F03 commit-before-effect/idempotency contracts.
   - **Stories / requirements / acceptance criteria:** US-05-US-06; FR-02.6, FR-04.1-FR-04.5, FR-06.3-FR-06.4; NFR-02-NFR-03, NFR-06-NFR-08; INV-02-INV-06, INV-09; AC-05, AC-10, AC-12-AC-15.
   - **Implementation:** Add F05-owned durable credential-operation records with operation ID, idempotency identity, profile/version, candidate and active revisions, canonical endpoint snapshot, phase, safe reason, timestamps, and cleanup/recovery state. Implement the coordinator sequence: persist intent, write candidate reference, invoke the test service, activate only after deterministic success, then retire/clean the old reference. Use candidate references so a process stop cannot silently replace the known active credential. Add startup reconciliation and explicit Retry/Clean Up actions; never auto-activate a store write whose verification is unknown.
   - **Visible result:** Replacing a verified token produces a durable pending operation; a successful candidate becomes active exactly once, while a failed/cancelled/uncertain candidate leaves the prior credential active and exposes a recovery action.
   - **Durable records / external effects:** Persists intent before the secure-store write and later before any test request. External effects are candidate store write, activation/reference update, and retirement/cleanup. Every phase and external effect has a correlation and idempotency identity.
   - **Failure / cancellation / restart:** Faults before commit roll back the intent transaction. Faults after commit remain visible. A stop between write/test/activation/cleanup leaves the candidate inactive unless a later explicit, successful test proves it. Replaying an operation returns or reconciles the existing outcome, never creates multiple active references. Cancellation and shutdown do not claim verification.
   - **Exact evidence:** Commit-before-store and commit-before-network fault table; duplicate operation replay; crash/restart at every phase; candidate-versus-active reference matrix; old-credential-preserved-on-failed-replacement test; cleanup uncertain/outcome recovery test; stale profile-version race; cancellation/timeout test; no-auto-activation assertion; durable readback after renderer closure.
   - **Exit criterion:** AC-05, AC-10, AC-12, AC-13, AC-14, and AC-15 pass; F05 has restart-safe credential lifecycle semantics and downstream code cannot invent its own activation/retry behavior.

4. **Deterministic read-only connection testing and credential broker**
   - **Blocked by:** Slice 3, canonical endpoint contract, and the injectable HTTP transport.
   - **Stories / requirements / acceptance criteria:** US-03-US-04, US-07; FR-03.1-FR-03.7, FR-05.1-FR-05.6, FR-07.1-FR-07.4; NFR-01-NFR-03, NFR-06-NFR-08; INV-01, INV-04-INV-08; AC-05-AC-08, AC-11, AC-16-AC-17.
   - **Implementation:** Add a strict main-process HTTP transport and connection-test service. Resolve only a verified profile/candidate operation, issue the read-only authenticated identity request against the canonical API base, reject insecure transport/certificate failures/cross-origin redirects, bound time and response size, and validate status/body/server identity deterministically. Construct the request environment explicitly rather than inheriting parent environment variables. Normalize 2xx success, 401/403/rate-limit, 404/protocol, DNS/network, TLS, timeout, cancellation, redirect, malformed-body, and unexpected failures into safe reason data. The downstream credential contract returns stable safe states for missing, unverified, expired/rejected, unavailable, and verified credentials. Add a request-scoped credential broker port that binds server ID, canonical origin, active/candidate revision, and correlation identity and is callable only by deterministic GitHub infrastructure.
   - **Visible result:** **Test Connection** shows verified account metadata on a valid fake response and actionable non-secret remediation for each failure class. A clean test proves a success requires the current candidate/current server response and cannot be supplied by a model claim or cached prior success.
   - **Durable records / external effects:** Persists test intent and bounded result metadata. The only network effect is a read-only identity request to the configured GitHub server; fake transport tests make no network call. No GitHub mutation or publication capability is reachable.
   - **Failure / cancellation / restart:** A non-2xx, malformed, redirected, cross-origin, certificate, timeout, cancellation, or process-interrupted request never verifies the candidate. Raw authorization headers and response bodies are redacted before reason persistence. A request whose outcome is uncertain remains unverified and requires explicit retry.
   - **Exact evidence:** HTTP request-shape test proving method/read-only endpoint/header placement/no URL token; redirect and cross-origin leak test; TLS/HTTP rejection matrix; response-size bound; status/body/schema classification table; timeout/cancellation/abort test; fake broker capability-scope test; cache/model-claim negative test; redaction scan over errors/headers/body; test-side-effect assertion that no mutation endpoint is called; correlation/restart readback.
   - **Exit criterion:** AC-05-AC-08, AC-11, AC-16, and AC-17 pass; the F06 REST client can consume one provider-neutral authenticated-request contract without seeing secure-store details.

5. **End-to-end server settings, reconnection, rotation, and removal**
   - **Blocked by:** Slices 1-4 and F04 renderer recreation behavior.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; FR-01.1-FR-07.4; NFR-01-NFR-08; INV-01-INV-09; AC-01-AC-18.
   - **Implementation:** Connect the settings UI to the main-process commands and read model for add/rename/test/replace/retry/clean up/remove. Hydrate after renderer recreation from SQLite and secure-store metadata, expose verified/attention/recovery statuses, and show safe account/verification metadata. Implement explicit profile removal as a durable operation that retires the active reference and reports uncertain cleanup without deleting history or silently deleting another profile. Add the F06 handoff adapter/fake consumer proving only a verified, server-bound credential can be used.
   - **Visible result:** A developer can configure a GHES profile, verify it, close/reopen the window and reconnect without re-entering the token, replace the token without losing a working profile on failure, and remove it with a visible cleanup result.
   - **Durable records / external effects:** Uses the profile, operation, test, and cleanup repositories; host secure-store writes/reads/retirements and read-only test requests are the only external effects. No PR or publication data is fetched.
   - **Failure / cancellation / restart:** UI closure does not cancel main-process operations. Reopen uses current durable state. Removal/rotation is idempotent and profile-scoped. A missing or expired token marks attention and offers retry/replacement without loops. A secure-store cleanup uncertainty remains visible and cannot be reported as complete.
   - **Exact evidence:** Electron settings-flow smoke with fake store/transport; restart/reconnect fixture; rotation success/failure/cancellation matrix; removal and cleanup recovery matrix; duplicate-profile UI test; current-state hydration test; F06 fake-consumer authorization test; accessibility/error-state review; no-token read-model/IPC/activity/SQLite scan; no-publication side-effect assertion.
   - **Exit criterion:** All user-facing F05 acceptance criteria pass end to end, APP-AC-01 is primary-complete within the declared F05 boundary, and F06 has a stable authenticated-request handoff.

6. **Security, fault-injection, and specification handoff**
   - **Blocked by:** Slices 1-5 and all F05 readiness gates.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; all FRs, NFRs, and INVs; APP-AC-01; AC-01-AC-18.
   - **Implementation:** Run the complete conformance suite across profile parsing, secure storage, IPC, operation lifecycle, connection testing, recovery, UI read models, and downstream capability scoping. Review dependency imports and packaged output for credential leakage or unauthorized store access. Document the Windows backend, migration version, operation/recovery contract, F06 handoff, F13 Git-credential separation, F23/F27 publication boundary, F29 hardening follow-ups, and clean-machine limitations.
   - **Visible result:** A machine-readable and human-reviewable evidence report proves a GHES profile can be configured and verified without secrets entering SQLite, renderer state/read models, AI context, logs, or publication paths, and shows every failure/recovery state with a next action.
   - **Durable records / external effects:** Keeps only declared test-owned databases, safe fixtures, bounded reports, and ignored build outputs. It does not alter `checklist.md`, publish a spec, contact a real GitHub server, or use a real credential.
   - **Failure / cancellation / restart:** Any secret leak, weak-store fallback, duplicate active reference, unverified activation, cross-origin authorization, lost operation record, unsafe IPC route, raw error, or missing handoff evidence blocks the gate. A cancelled run leaves no success marker and is rerunnable from owned fixtures.
   - **Exact evidence:** `npm run build`, `npm test`, `npm run check`; Windows safe-storage smoke; persistence migration/transaction report; IPC and forbidden-import report; secret/ciphertext/header/raw-error scan; endpoint/redirect/TLS report; crash/restart/idempotency report; accessibility report; F06 handoff conformance; `git diff --check`; `npm run lint:prd-plan -- Specs/secure_github_server_profiles_and_authentication_PRD.md Specs/secure_github_server_profiles_and_authentication_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/secure_github_server_profiles_and_authentication_PRD.md`.
   - **Exit criterion:** All F05 requirements have direct evidence, APP-AC-01 has no definite missing/invalid coverage, no unresolved security boundary or product decision remains hidden, and the F05 checklist item remains unchecked pending implementation approval and integration.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/secure_github_server_profiles_and_authentication_PRD.md`; this PLAN does not add general GitHub resource, PR, polling, Git-worktree, AI, validation, notification, or publication behavior.
- F03 remains authoritative for SQLite, migrations, transaction acknowledgement, safe codecs, server metadata, and durable operation history. F05 may add an additive migration/repository contract but never bypasses F03 with ad hoc database access.
- F04 remains authoritative for main-process ownership, renderer lifecycle, IPC validation, and window recreation. The credential submission route is a narrow documented exception for intentional secret entry; it has no generic method dispatch, no echo, no event fan-out, and no authority beyond the F05 coordinator.
- The `SecureCredentialStore` is the only module that touches host-protected credential material. Its Windows MVP backend uses Electron `safeStorage`; unavailable/weak backends fail closed. No plaintext token, ciphertext, store path, or reusable secret is part of a shared domain record or renderer read model.
- The GitHub credential broker is deterministic infrastructure only. F06 owns GitHub REST resources, pagination, conditional requests, and remote identity; it must bind each request to the F05 server identity and credential revision and must not expose raw token handling elsewhere.
- F05 does not supply credentials to Git subprocesses. F13/F25 must define any separate Git remote-authentication behavior without reusing the F05 secret read path or passing a GitHub API token to an AI provider.
- F05 does not grant publication authority. F23/F27 own human approval, publication state, commit/push/comment effects, and uncertain-outcome reconciliation; an authenticated connection test remains read-only.
- F16/F18/F21/F26 may use GitHub data in AI context only through later deterministic services and sanitized prepared inputs. No F05 credential capability or raw token may cross the AI-provider boundary.
- F29 owns final threat-model hardening and F30 owns packaging/clean-machine release evidence. F05 must still provide the concrete secure-store, IPC, endpoint, redaction, and recovery evidence those features consume.
- The F05 checklist item remains unchecked. This specification phase produces no application code, does not change `checklist.md`, and does not claim that a profile form or auth contract alone completes the feature.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
| --- | --- |
| FR-01 | 1, 5, 6 |
| FR-02 | 2-5, 6 |
| FR-03 | 4-6 |
| FR-04 | 3-6 |
| FR-05 | 2, 4-6 |
| FR-06 | 1, 2, 5, 6 |
| FR-07 | 2, 4-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-09 | 1-6 |
| APP-AC-01 | 1-6 |
