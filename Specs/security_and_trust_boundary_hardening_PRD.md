# F29 - Security and Trust-Boundary Hardening - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the durable state and serialization boundaries that must not contain credentials, uncontrolled paths, or provider objects. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main/preload/renderer lifecycle, typed IPC surface, deep-link inputs, and renderer-isolation baseline that F29 hardens. |
| 3 | F05 - Secure GitHub server profiles and authentication | Owns secure credential storage and GitHub connection configuration; F29 verifies that credentials do not escape that boundary. |
| 4 | F06 - GitHub REST client and remote identity model | Provides typed URL, server, repository, ref, and publication identities that F29 protects from parser and argument confusion. |
| 5 | F09 - Durable activity log and operation diagnostics | Provides activity and diagnostic sinks where F29 enforces bounded, redacted, provider-neutral projections. |
| 6 | F13-F14 - Operation-owned Git worktrees and deterministic validation | Provide canonical worktree ownership, Git state, structured commands, process execution, and validation evidence that F29 threat-tests against traversal, injection, and secret leakage. |
| 7 | F15-F17 - AI provider boundary, task profiles, execution policies, and bounded AI work | Provide provider-neutral requests, policy snapshots, controlled environments, turn budgets, and capability errors that F29 verifies cannot be broadened. |
| 8 | F18-F23 - Review preparation, revisions, stale handling, and publication | Provide proposal/read-only gates, worktree changes, approval records, response plans, and deterministic publication effects that F29 protects from renderer or AI authority leakage. |
| 9 | F24-F27 - Branch synchronization, conflict resolution, review, and publication | Provide synchronization worktrees, merge identities, conflict-resolution turns, and non-force publication that F29 protects from unsafe paths, arguments, and capabilities. |
| 10 | F28 - Restart, sleep, network-loss, and uncertain-outcome recovery | Provides lifecycle reconciliation that must preserve security blocks, policy snapshots, credentials, and evidence across interruption. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F30 - Windows packaging, end-to-end acceptance, and release readiness | Consumes the threat model, security test evidence, dependency inventory, residual-risk record, and packaged-runtime boundary checks before release. |
| 2 | Future provider adapters and platform ports | Must satisfy the same provider, credential, process, path, redaction, and fail-closed contracts or be rejected as unsupported. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-01 | FR-05.1-FR-05.7, FR-08.1-FR-08.5, INV-06 | AC-11-AC-13, AC-20, AC-24 | Shared: F05 owns authentication and secure-store UX; F29 owns secret-boundary verification, safe projections, and fail-closed handling. |
| APP-AC-10 | FR-03.2-FR-03.6, FR-04.1-FR-04.4, INV-05 | AC-06-AC-10, AC-18, AC-24 | Shared: F13 owns worktree creation and Git truth; F29 owns canonical path, opening, argument, and cross-operation escape checks. |
| APP-AC-11 | FR-06.1-FR-06.8, INV-02, INV-07 | AC-14-AC-18, AC-24 | Shared: F15 owns the Codex adapter; F29 owns no-publication-credential, capability, schema, and authority-boundary conformance. |
| APP-AC-12 | FR-06.4-FR-06.8, FR-07.4, INV-07 | AC-15-AC-16, AC-24 | Shared: F15 owns normalized structured results; F29 verifies malformed, oversized, secret-bearing, and unsafe provider output cannot cross into application state. |
| APP-AC-13 | FR-04.1-FR-04.7, FR-08.1-FR-08.4, INV-04 | AC-08-AC-10, AC-22-AC-24 | Shared: F00/F14 own trusted command execution and result truth; F29 owns adversarial invocation, environment, path, and fail-closed tests. |
| APP-AC-28 | FR-02.4-FR-02.6, FR-06.1-FR-06.8, INV-02-INV-04 | AC-04, AC-14, AC-16-AC-18, AC-24 | Shared: F23 owns explicit approval, commit, and push; F29 verifies no renderer/provider path can obtain publication authority or bypass the deterministic gate. |
| APP-AC-29 | FR-02.4-FR-02.6, FR-05.2-FR-05.7, FR-06.1-FR-06.8, INV-02, INV-06 | AC-04, AC-11, AC-14, AC-16-AC-18, AC-20, AC-24 | Shared: F06/F23 own response transport and publication; F29 verifies credentials, raw provider data, and generic IPC cannot reach response posting. |
| APP-AC-39 | FR-03.2-FR-03.6, FR-04.1-FR-04.4, FR-08.1-FR-08.4, INV-05 | AC-06-AC-10, AC-18, AC-22-AC-24 | Shared: F13/F22 own dirty-worktree decisions; F29 ensures opening, validation, Git, recovery, and renderer requests cannot silently cross operation or developer-workspace boundaries. |
| APP-AC-48 | FR-03.2-FR-03.6, FR-06.1-FR-06.8, INV-02, INV-05, INV-07 | AC-06, AC-14, AC-17-AC-19, AC-24 | Shared: F26 owns semantic conflict resolution; F29 verifies it is confined to the exact synchronization worktree and cannot publish or escape its policy. |
| APP-AC-50 | FR-02.4-FR-02.6, FR-03.4-FR-03.6, FR-06.1-FR-06.8, INV-02-INV-04 | AC-04, AC-07, AC-14, AC-16-AC-18, AC-24 | Shared: F27/F23 own SHA revalidation and non-force publication; F29 hardens argument, authorization, and capability boundaries around those operations. |
| APP-AC-63 | FR-06.1-FR-07.6, INV-02, INV-07, INV-09 | AC-14-AC-19, AC-21, AC-24 | Shared: F15 owns provider replacement contracts; F29 verifies SDK isolation, dependency integrity, controlled credentials, and provider-neutral boundary behavior. |
| APP-AC-64 | FR-05.1-FR-05.7, FR-06.4-FR-06.8, FR-08.1-FR-08.4, INV-06, INV-09 | AC-11-AC-20, AC-24 | Shared: F03/F15 own persistence and metadata schemas; F29 verifies safe serialization, redaction, bounded projections, and absence of SDK/secrets. |
| APP-AC-70 | FR-06.2-FR-06.8, FR-08.1-FR-08.5, INV-02, INV-07, INV-08 | AC-14-AC-19, AC-22-AC-24 | Shared: F16/F15 own named policy resolution and provider translation; F29 verifies policy/capability violations fail closed and never grant publication authority. |
| APP-AC-71 | FR-02.4-FR-02.6, FR-06.2-FR-06.8, INV-02-INV-04, INV-07 | AC-04, AC-14-AC-17, AC-24 | Shared: F18/F15 own proposal-stage semantics; F29 verifies the read-only floor cannot be bypassed through IPC, provider output, or policy translation. |
| APP-AC-74 | FR-03.2-FR-04.7, FR-08.1-FR-08.4, INV-04, INV-08 | AC-08-AC-10, AC-22-AC-24 | Shared: F00/F14/F16 own trusted structured command configuration; F29 verifies free-form instructions and AI suggestions never become executable authority. |

F29 does not claim primary ownership of authentication, worktree creation,
validation truth, provider invocation, task-profile selection, review decisions,
conflict semantics, or publication. It hardens the boundaries those features
already own and supplies cross-feature evidence for the shared criteria above.

## Executive Summary

PRMonitor runs unattended on a developer's machine while it reads private source
code, invokes an AI provider, executes repository validation, and prepares
changes that may eventually be published to GitHub. That convenience creates
several trust boundaries: a renderer must not become a privileged controller, a
repository must not turn arbitrary text into an executable command, an AI
provider must not receive GitHub publication credentials, and a malformed or
stale request must not widen authority merely because it came from a valid UI
session.

F29 makes those boundaries explicit, testable, and fail-closed. It adds the
security threat model and data-classification contract, verifies Electron
renderer isolation and schema-validated IPC, hardens URL/path/file/Git/process
inputs, keeps credentials and uncontrolled environments out of persistence and
provider context, rejects provider or policy requests that exceed their
declared capability, and adds dependency-supply-chain and cross-feature security
evidence. When a security check cannot prove that an operation is safe, the
operation stops with a typed reason and preserved evidence; it does not silently
fall back to a broader mode.

This feature is defense in depth. It does not claim that an operating system can
prevent a developer-authorized local process from attempting every possible
action, nor does it replace the owning feature's state machine or publication
approval. It ensures that all supported PRMonitor paths keep the narrowest
authority that the product promises and that the remaining limitations are
visible before release.

## User Stories

### Keep an unattended desktop worker bounded

- **US-01:** **GIVEN** PRMonitor is running with no visible renderer, **WHEN** a background operation is admitted, **THEN** it still uses the same main-process authorization, operation identity, path ownership, policy, credential, and redaction rules as a UI-started operation.
  - **Acceptance Criteria:** AC-01-AC-04, AC-18-AC-20, AC-24.
- **US-02:** **GIVEN** a renderer, deep link, or stale serialized request asks for a privileged action, **WHEN** the main process receives it, **THEN** the request is validated and re-authorized against current durable state before any side effect.
  - **Acceptance Criteria:** AC-03-AC-05, AC-17, AC-22, AC-24.

### Treat external text as data

- **US-03:** **GIVEN** a PR URL, branch/ref, repository path, validation profile, file-opening request, or Git argument contains hostile syntax, **WHEN** PRMonitor parses or forwards it, **THEN** it is rejected or passed only as a bounded structured value and cannot select an unintended host, path, executable, ref, or command.
  - **Acceptance Criteria:** AC-05-AC-10, AC-18, AC-24.
- **US-04:** **GIVEN** a user opens a worktree or file from a notification, Review Bundle, or synchronization result, **WHEN** the action is executed, **THEN** the target is a current canonical path owned by the referenced operation and is never the developer clone, database, credential store, or an arbitrary user-supplied location.
  - **Acceptance Criteria:** AC-06, AC-18, AC-22-AC-24.

### Keep secrets out of the application surfaces that do not need them

- **US-05:** **GIVEN** a GitHub token, provider credential, authorization header, password, or secret-shaped environment value is used by a supported workflow, **WHEN** the workflow persists, logs, displays, or sends context, **THEN** the raw value remains in the approved secure boundary and is absent from SQLite, IPC, activity, prompts, structured output, and retained command evidence.
  - **Acceptance Criteria:** AC-11-AC-13, AC-20, AC-24.
- **US-06:** **GIVEN** redaction or credential isolation cannot prove that a value is safe, **WHEN** the boundary is about to be crossed, **THEN** PRMonitor blocks the operation with an actionable reason rather than emitting the uncertain data.
  - **Acceptance Criteria:** AC-11, AC-15, AC-20, AC-22-AC-24.

### Let AI work locally without granting publication authority

- **US-07:** **GIVEN** the selected provider is asked to inspect or modify an operation-owned worktree, **WHEN** the provider invocation is prepared, **THEN** it receives only the declared worktree, policy, task context, and provider authentication it needs; it receives no GitHub publication credential, publication API, or renderer-controlled command channel.
  - **Acceptance Criteria:** AC-14-AC-16, AC-18-AC-19, AC-24.
- **US-08:** **GIVEN** a provider, model response, or execution policy requests broader filesystem, network, interactive, or publication capability, **WHEN** the request is checked, **THEN** the request is rejected with a policy/capability reason and the effective policy is never silently broadened.
  - **Acceptance Criteria:** AC-15-AC-19, AC-24.
- **US-09:** **GIVEN** the initial Review Proposal is awaiting human item decisions, **WHEN** a renderer or provider attempts a mutation or publication effect, **THEN** the attempt is blocked and no publication intent is created.
  - **Acceptance Criteria:** AC-04, AC-16-AC-17, AC-24.

### Understand and recover from security blocks

- **US-10:** **GIVEN** a security boundary rejects an action, **WHEN** the developer opens the relevant result, **THEN** the UI explains what was blocked, why it matters, what evidence was preserved, and which bounded next action is permitted without exposing sensitive data.
  - **Acceptance Criteria:** AC-20, AC-22-AC-23.
- **US-11:** **GIVEN** the application restarts or recovers after an interrupted operation, **WHEN** it encounters an unresolved path, policy, credential, or redaction condition, **THEN** the security block and evidence remain in force and recovery cannot auto-authorize a broader retry.
  - **Acceptance Criteria:** AC-18-AC-20, AC-22, AC-24.

### Release with explicit security evidence

- **US-12:** **GIVEN** a dependency, import boundary, runtime setting, or cross-feature security test changes, **WHEN** the release gate runs, **THEN** it produces reproducible evidence, blocks definite violations, and records any approved residual risk for F30.
  - **Acceptance Criteria:** AC-01, AC-21, AC-23-AC-25.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** the F29 threat-model artifact is reviewed for an MVP release, **WHEN** the security gate is evaluated, **THEN** it lists assets, actors, trust boundaries, abuse cases, mitigations, owning features, test evidence, and residual limitations for renderer/IPC, URLs/routes, filesystem/Git, validation/processes, database paths, credentials, provider environments/policies, persistence/diagnostics, and dependencies; every in-scope high-risk case has an owner and an executable evidence reference.
- **AC-02:** **GIVEN** the packaged or production-like Electron renderer starts, **WHEN** its web preferences and preload are inspected, **THEN** context isolation is enabled, Node integration and legacy remote access are disabled, navigation and new-window creation are allowlisted, a restrictive content/origin policy is active, and the renderer has no direct filesystem, process, database, provider-SDK, or secure-credential-store access.
- **AC-03:** **GIVEN** an IPC request or event has an unknown channel, malformed or oversized payload, forged correlation/session value, unauthorized action, or unexpected response shape, **WHEN** it crosses the preload/main boundary, **THEN** it is rejected before the owning service or side effect is reached, returns a bounded safe reason, and does not expose credentials, prompts, raw provider errors, SQL, child-process arguments, or arbitrary paths.
- **AC-04:** **GIVEN** a renderer asks to continue AI work, run validation, open/reveal a worktree, discard/re-evaluate, or publish, **WHEN** the main process handles the request, **THEN** it revalidates the persisted operation, current revision/condition, explicit human authorization, and allowed capability; a valid renderer session alone is never sufficient, and a duplicate or stale request creates no second effect.
- **AC-05:** **GIVEN** a deep link, PR URL, remote URL, or route target contains an unsupported scheme, unapproved host, credentials, user-info, encoded traversal, duplicate/conflicting identity, unbounded field, or arbitrary file/command target, **WHEN** F29's route boundary parses it, **THEN** it rejects it without network, filesystem, IPC-action, GitHub, AI, or publication side effects; an accepted GitHub/GHES target preserves the configured server and explicit repository/PR identity.
- **AC-06:** **GIVEN** a file-manager, IDE, or reveal action is requested for a Review Bundle or synchronization result, **WHEN** the target is resolved immediately before opening, **THEN** it is canonical, exists as the expected file/directory, is inside the referenced operation-owned worktree, and still belongs to that operation; relative traversal, symlink/junction escape, UNC/device path, stale owner, developer-clone path, database path, credential-store path, and arbitrary renderer path are rejected.
- **AC-07:** **GIVEN** a Git operation receives a branch, ref, repository, remote, path, commit message, or option derived from remote content, repository content, AI output, or renderer input, **WHEN** the command is prepared, **THEN** it uses a structured argument array without a shell, applies option/path separation and allowlisted operation verbs, binds the exact repository/ref identity and expected SHAs, rejects control/option-injection values, and cannot request force push or another operation's worktree.
- **AC-08:** **GIVEN** validation instructions, a checked-in profile, or an AI-proposed command contains a shell string, invalid schema, untrusted revision, path escape, secret environment request, or missing confirmation, **WHEN** the validation boundary admits it, **THEN** no process starts; only the F00/F14 trusted structured command contract can execute, with canonical operation-worktree containment, controlled environment, bounded output, and real exit-status semantics preserved.
- **AC-09:** **GIVEN** the application opens, creates, migrates, backs up, or recovers SQLite, **WHEN** a database path is resolved, **THEN** it is selected from the approved main-process application-data boundary, canonicalized and checked against symlink/junction/path-escape conditions, inaccessible or substituted paths fail safely, and no renderer or repository value can redirect the authoritative database to a worktree, credential store, arbitrary network share, or attacker-selected file.
- **AC-10:** **GIVEN** PRMonitor launches Git, validation, an AI provider, an OS opener, or another child process, **WHEN** its environment and working directory are constructed, **THEN** they come from an explicit allowlist and current operation identity; parent-process variables are not inherited wholesale, publication credentials and unrelated secure-store values are absent, the working directory is canonical and owned, and process/output limits remain enforced after renderer closure or restart.
- **AC-11:** **GIVEN** a known or synthetic token, password, API key, authorization header, provider credential, cookie, or secret-shaped environment value reaches a log, activity event, error, IPC DTO, notification, SQLite value, validation evidence, provider context, structured result, or test artifact, **WHEN** the value crosses that boundary, **THEN** it is absent or replaced by a bounded redaction marker; if the application cannot prove redaction, the boundary fails closed and retains only a safe reason.
- **AC-12:** **GIVEN** a user configures or rotates a GitHub server credential, **WHEN** the application persists, reconnects, reports an error, or performs recovery, **THEN** the raw credential is handled only by the approved OS secure-store adapter, SQLite contains only an opaque reference and safe metadata, and missing, denied, or corrupt credentials produce an actionable non-secret result without changing publication or AI authority.
- **AC-13:** **GIVEN** a supported workflow needs a provider credential, **WHEN** F29 inspects the provider's controlled environment and request context, **THEN** only the credential needed for the configured provider interaction is present; GitHub API credentials, response-posting credentials, secure-store enumeration, raw prompts, uncontrolled environment values, and publication APIs are absent from provider input and normalized output.
- **AC-14:** **GIVEN** a provider or SDK emits malformed, unknown-field, oversized, secret-bearing, raw-SDK, prose-only, unsafe-path, unsafe-command, or unsupported-capability data, **WHEN** the provider boundary validates it, **THEN** the data is rejected before it can change domain state, start a command, alter a path, create publication intent, or become authoritative evidence; there is no prose fallback.
- **AC-15:** **GIVEN** an AI Execution Policy or provider request asks for a writable path outside the operation worktree, blocked network, unsupported interactive approval, unrestricted environment, additional credential, full-access mode where it is not explicitly allowed, or another capability not proven by the adapter, **WHEN** the policy gate evaluates it, **THEN** it returns `POLICY_UNSUPPORTED` or `POLICY_BOUNDARY_VIOLATION`, does not prompt or silently broaden the policy, and preserves the original snapshot and evidence.
- **AC-16:** **GIVEN** the initial Review Proposal is before complete per-item human decisions, **WHEN** the provider, renderer, or a forged IPC request attempts to edit files, run a mutating command, commit, push, post a response, resolve a conversation, approve a review, or create publication intent, **THEN** the attempt is denied and the proposal remains read-only; the deterministic F18/F23 publication gates remain unchanged.
- **AC-17:** **GIVEN** a request to commit, push, post a response, resolve a conversation, approve a review, or publish a synchronization merge arrives from a renderer or provider context, **WHEN** the application authorizes it, **THEN** only the owning deterministic publication service can proceed after its persisted human approval and fresh target/worktree checks; F29 evidence proves no generic IPC, provider method, model output, or shell path can bypass that gate or select force push.
- **AC-18:** **GIVEN** two operation identities, a stale revision, a missing worktree, a changed owner marker, or a recovery record with uncertain local state exists, **WHEN** any path, process, AI, validation, discard, or publication action is requested, **THEN** the operation is blocked or isolated according to its owner; PRMonitor never substitutes, resets, deletes, overwrites, or reuses another operation's worktree and never auto-retries with broader authority.
- **AC-19:** **GIVEN** the application restarts, wakes, loses its renderer, or recovers from an uncertain provider/process/network outcome, **WHEN** F28 rehydrates the operation, **THEN** security-relevant policy, credential, path-owner, approval, redaction, and capability evidence is preserved; no stopped AI segment, publication effect, validation command, or insecure fallback starts solely because recovery ran.
- **AC-20:** **GIVEN** activity, logs, errors, notifications, read models, recovery summaries, and security-block projections are inspected, **WHEN** they are produced for a developer, **THEN** they are bounded, redacted, provider-neutral, and free of raw prompts, SDK objects, credentials, authorization headers, uncontrolled environment values, arbitrary executable commands, and sensitive filesystem paths; they contain a stable reason, affected operation, preserved evidence summary, and permitted next action.
- **AC-21:** **GIVEN** the dependency graph or provider adapter changes, **WHEN** the configurable supply-chain gate runs, **THEN** installation is reproducible from the lockfile, production dependencies have a recorded inventory and vulnerability result, only the intended provider adapter imports the provider SDK, undeclared runtime installation is absent, and the default policy blocks Critical and High findings; any non-default policy is versioned, explicitly selected, and accompanied by the required risk-acceptance record before release.
- **AC-22:** **GIVEN** a security check blocks an operation, **WHEN** the result is shown after UI closure, restart, or renderer recreation, **THEN** the developer can understand what was blocked, why it matters, what safe evidence remains, and which bounded action is permitted using keyboard navigation, screen readers, forced colors/high contrast, zoom, reduced motion, and narrow windows without color-only meaning or secret disclosure.
- **AC-23:** **GIVEN** the MVP is packaged or handed to F30, **WHEN** its security documentation is reviewed, **THEN** it clearly states that provider/process and repository code may still attempt actions available to the user’s local OS, that validation can execute repository-controlled code within its declared boundary, that no absolute OS/network sandbox is promised for the MVP, that publication remains deterministic and human-approved, and which mitigations are defense in depth.
- **AC-24:** **GIVEN** the F29 cross-feature security suite runs, **WHEN** it exercises hostile routes, paths, refs, commands, environments, secrets, provider outputs, policy requests, renderer messages, restarts, dependency checks, and publication spies, **THEN** it uses temporary repositories and synthetic credentials only, produces reproducible bounded evidence, creates no external publication effect, and fails the security gate on any definite boundary violation.
- **AC-25:** **GIVEN** a F29 change is proposed, **WHEN** the feature is handed to F30, **THEN** the threat model, boundary matrix, test report, dependency inventory, residual-risk record, mapped application-criteria evidence, and both specification-linter reports are versioned and linked to the exact source/lockfile/runtime inputs used.

## Functional Requirements

### FR-01: Threat model, data classification, and security contract

- FR-01.1: F29 SHALL maintain a versioned threat model covering the renderer/preload/main process, deep links and URLs, filesystem and worktrees, Git and validation processes, SQLite, secure credentials, provider processes/policies, diagnostics, recovery, and dependencies.
- FR-01.2: The threat model SHALL identify the relevant actors, assets, trust boundaries, abuse cases, security properties, mitigations, owning feature, test evidence, and residual limitation for each boundary.
- FR-01.3: F29 SHALL classify data crossing boundaries as public/remote metadata, private source/context, privileged control/state, or credential/secret and SHALL define the allowed destinations and retention for each class.
- FR-01.4: Every supported boundary SHALL have an allowlist, validation rule, authorization rule, failure reason, and evidence reference; absence of proof SHALL be treated as unsafe.
- FR-01.5: The security contract SHALL preserve the application overview's deterministic/AI boundary, human publication approval, operation ownership, snapshot, restart, and non-goal invariants.
- FR-01.6: The threat model and boundary matrix SHALL be reviewed as release inputs and SHALL identify which behavior remains owned by F04-F28 rather than duplicating their state machines.

### FR-02: Renderer, preload, IPC, and route isolation

- FR-02.1: The Electron renderer SHALL run with context isolation enabled, Node integration disabled, legacy remote access disabled, and a restrictive navigation/new-window/origin policy appropriate to the packaged application.
- FR-02.2: The preload bridge SHALL expose only the versioned, typed capabilities required by the renderer and SHALL not expose Electron objects, Node modules, database handles, child-process handles, provider SDK objects, secure-store values, or generic method invocation.
- FR-02.3: Every IPC channel, payload, session/correlation identity, user action, response, and event SHALL be validated against an explicit schema and size bound before use or delivery.
- FR-02.4: Main-process handlers SHALL re-authorize privileged actions against current persisted state, revisions, ownership, policy, and explicit user approval; a valid renderer session SHALL not itself grant authority.
- FR-02.5: IPC SHALL not expose arbitrary SQL, filesystem paths, shell commands, Git argument arrays, provider prompts, publication methods, or credential values; handlers SHALL call narrow feature ports instead.
- FR-02.6: Deep-link and notification route parsing SHALL accept only documented bounded target forms, select a view/request target, and never start AI, execute a command, change domain state, release a hold, or publish as a routing side effect.
- FR-02.7: Renderer disappearance, reload, stale replies, and forged subscription identities SHALL not cancel, duplicate, broaden, or authorize main-process work; rejected messages SHALL return bounded safe diagnostics.

### FR-03: URL, filesystem, Git, and external-opening boundary

- FR-03.1: URL and remote-identity parsing SHALL allow only the documented GitHub.com/GHES forms and configured server identity, reject credentials and unsupported schemes, and preserve explicit base/head repository and ref identity.
- FR-03.2: Any user-, repository-, remote-, AI-, or renderer-derived filesystem target SHALL be canonicalized immediately before use and checked for path containment, expected type, operation ownership, and current revision.
- FR-03.3: File-manager, IDE, and reveal actions SHALL accept only current operation-owned worktree paths or explicitly approved application targets; they SHALL reject developer-clone, database, secure-store, arbitrary external, device, and escaping symlink/junction paths.
- FR-03.4: Git operations SHALL use structured argument arrays, no command shell, option/path separation, allowlisted verbs and flags, explicit repository/ref identities, and no force-push or implicit default-branch substitution.
- FR-03.5: Worktree paths, Git arguments, remote names, refs, commit messages, and file paths SHALL reject control characters, unbounded values, option injection, and values that can change the intended operation identity.
- FR-03.6: F29 SHALL verify that a path or operation identity cannot cross from one Review Bundle, synchronization operation, validation run, or provider turn into another, including during recovery.
- FR-03.7: OS shell/file opening SHALL use a narrow main-process adapter with explicit target validation and shall never concatenate untrusted data into a shell command or implicitly execute a file.

### FR-04: Validation, process, and database execution boundary

- FR-04.1: F29 SHALL enforce that validation uses only the F00/F14 versioned structured command contract and explicit trust/confirmation; human-readable instructions and AI suggestions SHALL have no executable authority.
- FR-04.2: All child processes launched by supported PRMonitor workflows SHALL use explicit executable/argument values, `shell: false` or the platform-equivalent no-shell primitive, canonical owned working directories, bounded lifetime, and bounded output.
- FR-04.3: Child environments SHALL be built from an explicit allowlist; parent-process variables SHALL not be inherited wholesale, and GitHub publication credentials, unrelated secure-store values, and uncontrolled secrets SHALL be excluded.
- FR-04.4: Process and validation admission SHALL revalidate path ownership, policy, configuration hash, authorization, and current worktree state immediately before launch and SHALL fail closed on any mismatch.
- FR-04.5: The authoritative SQLite path SHALL be selected and opened only by the main process from the approved application-data boundary; configured or renderer-supplied paths SHALL not redirect it outside that boundary.
- FR-04.6: Database creation, migration, backup, and recovery SHALL canonicalize and validate paths, detect unsupported substitution or escape conditions, and preserve the existing authoritative database rather than silently switching to an untrusted file.
- FR-04.7: F29 security evidence SHALL prove that no validation, Git, provider, or shell/file-opening path can commit, push, post, resolve, approve, merge, or otherwise obtain publication authority.

### FR-05: Credentials, secrets, redaction, and safe diagnostics

- FR-05.1: F29 SHALL keep GitHub API credentials under F05's secure credential-store boundary and SHALL allow SQLite to retain only opaque references and non-secret metadata.
- FR-05.2: Provider, validation, Git, notification, activity, IPC, persistence, and UI projections SHALL receive only the credentials explicitly required for their declared interaction; GitHub publication credentials SHALL never be supplied to an AI provider or validation process.
- FR-05.3: Redaction SHALL run before any secret-shaped value or known credential can be persisted, logged, sent over IPC, displayed, included in AI context, or retained as process/output evidence.
- FR-05.4: Redaction SHALL cover known secret values and recognized sensitive key/value or header forms, while preserving bounded non-secret diagnostic context and never treating a model claim as proof that redaction occurred.
- FR-05.5: If a boundary cannot prove that content is bounded and redacted, it SHALL block the transfer and return a safe `REDACTION_FAILURE` or equivalent reason without retaining the uncertain value.
- FR-05.6: Provider errors, process errors, filesystem errors, and secure-store errors SHALL be normalized to bounded provider-neutral diagnostics; raw prompts, authorization headers, SDK objects, uncontrolled environments, and secret-bearing paths SHALL not cross the boundary.
- FR-05.7: Security and redaction records SHALL preserve correlation, operation identity, reason, and safe evidence needed for recovery and review without retaining credentials or unnecessarily sensitive source content.

### FR-06: AI policy, capability, and publication authority

- FR-06.1: Application services SHALL invoke AI only through the provider-neutral F15 boundary; provider SDK imports, thread objects, event objects, and provider-specific authority SHALL not leak to persistence, renderer, GitHub, validation, or publication code.
- FR-06.2: F29 SHALL verify that each provider invocation uses an immutable F16 task-profile and AI Execution Policy snapshot and that the adapter can enforce every requested sandbox, network, writable-root, approval, environment, and credential setting.
- FR-06.3: A provider request SHALL be rejected before start when its required capability is unsupported, unbounded, interactive without a supported approval channel, outside the operation worktree, or broader than the effective policy.
- FR-06.4: Provider structured output and normalized events SHALL be schema-validated, bounded, redacted, and checked for exact requested identities before they can influence state, commands, paths, validation, or workflow decisions.
- FR-06.5: The Read-only Conversation and Review Proposal safety floors SHALL remain read-only even if a broader default policy, provider option, model response, or renderer request is supplied.
- FR-06.6: The provider boundary SHALL expose no commit, push, response-posting, conversation-resolution, review-approval, merge-publication, secure-store enumeration, or generic shell capability.
- FR-06.7: Publication and response effects SHALL remain behind deterministic F23/F27 services with persisted human approval, fresh state checks, and their existing non-force/idempotency contracts; security validation SHALL reject attempts to bypass those services.
- FR-06.8: A policy or capability failure SHALL never silently retry with a broader policy, alternate credential, full-access mode, or unvalidated provider adapter.

### FR-07: Dependency and runtime supply-chain integrity

- FR-07.1: The lockfile SHALL be authoritative for supported installs, and release/security evidence SHALL use a reproducible `npm ci` installation under the supported Node/npm versions.
- FR-07.2: F29 SHALL record a production dependency inventory, direct/transitive provenance sufficient for review, provider-SDK version, native/runtime components, and the result of the configured vulnerability scan.
- FR-07.3: The F29 quality gate SHALL be configurable, but its default release policy SHALL block Critical and High production dependency findings; every configured threshold SHALL be explicit, versioned, owned, visible to F30, and subject to the required risk-acceptance process before a non-default policy can release.
- FR-07.4: Static import and package-boundary checks SHALL prove that `@openai/codex-sdk` is imported only by the Codex adapter and that no provider SDK, secure-store API, Electron privileged API, or Node process API leaks into renderer-safe/shared modules.
- FR-07.5: The supported runtime SHALL not install packages, load provider adapters, or fetch executable code dynamically from repository content, AI output, arbitrary URLs, or renderer input.
- FR-07.6: Dependency updates SHALL rerun boundary, schema, redaction, no-publication, and packaged-runtime smoke evidence before they are eligible for F30 release acceptance.

### FR-08: Security failure, recovery, observability, and accessibility

- FR-08.1: Security blocks SHALL use stable machine-readable reasons that identify the boundary, operation, failed condition, preserved evidence, retryability, and permitted next action without revealing sensitive data.
- FR-08.2: A security block SHALL stop the affected operation before the unsafe side effect and SHALL not be converted into success by activity text, provider prose, renderer state, or a missing error response.
- FR-08.3: F28 startup, wake, network, renderer, and uncertain-outcome recovery SHALL preserve security blocks, policy/profile snapshots, path ownership, authorization, redaction decisions, and dependency evidence; recovery SHALL not broaden authority or auto-authorize a stopped operation.
- FR-08.4: The UI and activity/read models SHALL distinguish security-blocked, stale, interrupted, unsupported, failed, and retryable states and shall expose what/why/evidence/next-action data through the existing accessible presentation contracts.
- FR-08.5: Security diagnostics SHALL be bounded and redacted at every sink, including logs, activity, notifications, IPC, persisted read models, test reports, and release artifacts.
- FR-08.6: The product documentation SHALL state the MVP's defense-in-depth limits, including repository-controlled code execution during validation, local-process limitations, no absolute OS/network sandbox guarantee, secure-store availability, and the deterministic human publication boundary.

### FR-09: Cross-feature security conformance and release gate

- FR-09.1: F29 SHALL provide contract and integration tests for every boundary in this PRD, using temporary repositories, synthetic credentials, injected adapters, and deterministic clocks/process/network fakes where possible.
- FR-09.2: The security suite SHALL include positive least-privilege cases and adversarial cases for malformed/oversized schemas, path traversal, symlink/junction escape, option injection, shell strings, secret leakage, policy broadening, stale identity, renderer loss, restart, and uncertain outcomes.
- FR-09.3: Security tests SHALL assert absence of unauthorized side effects, including commits, pushes, responses, merges, conversation changes, secure-store enumeration, external opens, arbitrary child processes, and worktree replacement.
- FR-09.4: F29 SHALL publish a bounded evidence bundle containing the threat model, boundary matrix, test results, dependency inventory, lockfile/runtime identity, residual risks, and application-criteria trace for F30.
- FR-09.5: A definite security-test failure, invalid boundary mapping, secret leak, provider-authority leak, path escape, dependency-gate violation, or unresolved release-blocking risk SHALL fail the F29 readiness gate.

## Non-Functional Requirements

- **NFR-01: Least privilege** - Each process, module, IPC channel, provider invocation, and external opener SHALL receive only the minimum capability and data required for its declared operation.
- **NFR-02: Fail closed** - Invalid, stale, unsupported, uncertain, malformed, unredactable, or unowned inputs SHALL stop before the affected side effect; no fallback may silently broaden authority.
- **NFR-03: Data minimization** - Credentials, prompts, SDK objects, uncontrolled environments, raw authorization headers, and arbitrary sensitive paths SHALL not be retained or displayed outside their owning boundary.
- **NFR-04: Determinism and reproducibility** - Given the same versioned input, policy, ownership, and adapter evidence, boundary classification and safe reason are stable and repeatable across renderer closure and restart.
- **NFR-05: Bounded resources** - Message sizes, path lengths, route payloads, process lifetime, output retention, diagnostics, dependency reports, and security evidence SHALL have explicit limits.
- **NFR-06: Auditability** - Every security block and release-gate result SHALL include correlation, operation, revision/policy reference, safe reason, evidence pointer, and permitted action without becoming application state through free-form logs.
- **NFR-07: Platform safety** - Windows path, executable, process-tree, secure-store, shell, and file-manager behavior SHALL be covered by platform-specific adapters and tests without leaking platform privilege into shared/renderer contracts.
- **NFR-08: Accessibility and usability** - Security blocks and remediation guidance SHALL be keyboard reachable, screen-reader understandable, visible in forced colors/high contrast, usable with zoom/reduced motion/narrow windows, and not color-only.
- **NFR-09: Dependency maintainability** - Security checks SHALL be rerunnable on clean checkouts with the supported toolchain, lockfile, and credential-free fixtures; findings and exceptions SHALL be versioned and reviewable.

## Invariants

- **INV-01:** The Electron main process and its durable repositories remain authoritative; renderer memory, deep-link data, activity text, provider state, and UI success indicators never become security or workflow authority.
- **INV-02:** AI providers and provider outputs never have publication authority, secure-store enumeration authority, or access to GitHub publication credentials.
- **INV-03:** No external side effect occurs until the owning deterministic service has persisted intent and passed its explicit authorization, identity, ownership, and current-state checks.
- **INV-04:** Untrusted URLs, routes, repository content, remote text, AI output, renderer input, paths, refs, commands, and environment values are data only until accepted by the owning typed/authorized contract.
- **INV-05:** A path used by a worktree, process, validation, opener, or provider must be canonical, current, and owned by the referenced operation; path containment and ownership are rechecked immediately before use.
- **INV-06:** Secrets and raw authorization material never enter plaintext SQLite fields, prompts, structured AI output, IPC, activity, logs, notifications, validation evidence, release artifacts, or uncontrolled child environments.
- **INV-07:** Execution policies and capabilities can only narrow at downstream boundaries; no provider, model response, renderer request, repository instruction, retry, or recovery path may broaden them.
- **INV-08:** A security uncertainty, redaction failure, unsupported capability, stale identity, or unowned path never becomes a pass, a publication approval, a silent retry, or an implicit fallback.
- **INV-09:** Provider SDKs, secure-store implementations, Electron privileged APIs, Node process APIs, and platform shell APIs remain behind their declared adapters and do not leak into renderer-safe/shared contracts.
- **INV-10:** Review Proposal and Read-only Conversation remain read-only, and no security hardening path can weaken the proposal-before-mutation or complete-diff human approval boundaries.
- **INV-11:** Security evidence is bounded, redacted, immutable where it explains a completed operation, and tied to the exact source, policy, dependency, runtime, and configuration revisions that produced it.
- **INV-12:** F29 hardens existing feature ownership but never replaces a feature's state machine, publication service, credential store, Git truth, validation truth, or recovery authority with a security-specific shadow state machine.

## Out of Scope

- Replacing F05's secure credential-store implementation, GitHub authentication UX, token rotation protocol, or GitHub REST client.
- Reimplementing F04's window lifecycle, F13's worktree/Git truth, F14's validation runner, F15's provider adapter, F16's preference UI, F17's bounded-work policy, F18-F27 workflow state machines, or F28's recovery coordinator.
- An absolute operating-system, network, anti-malware, or provider-process sandbox guarantee for the MVP; F29 documents the defense-in-depth limit and enforces the supported application boundary.
- Semantic prompt-injection detection, model alignment, or a guarantee that repository text cannot persuade an AI provider to attempt an action available to the local process.
- Multi-user access control, remote/shared databases, server-side secret management, enterprise compliance certification, code signing/update policy, or installer hardening owned by F30 or future work.
- Automatically encrypting every local SQLite field beyond the approved secure credential mechanism and the existing application persistence design.
- Dynamic installation or discovery of third-party provider adapters, packages, commands, or executable code from repository content, AI output, or arbitrary network locations.

## Product Decisions

- **PD-01: Main process is the only privileged application authority** - Renderer, route, provider, validation, and activity surfaces may request typed actions, but only main-process feature services can authorize or perform privileged effects.
- **PD-02: Boundary uncertainty fails closed** - An invalid, stale, unsupported, unredactable, or unowned value stops the affected operation and preserves evidence; the product does not silently fall back to a broader mode.
- **PD-03: Open/reveal actions are operation-owned** - The MVP opens only a currently validated Review Bundle or synchronization worktree/file, never an arbitrary path supplied by the renderer or remote content.
- **PD-04: Publication authority remains deterministic** - AI, provider SDKs, renderer IPC, validation commands, and shell/file-opening helpers cannot publish, and all supported publication continues through the existing human-approved deterministic services.
- **PD-05: Security errors are actionable attention states** - A blocked action explains the boundary, reason, evidence, and permitted remediation without exposing the secret or hostile payload that caused the block.
- **PD-06: Configurable quality gate with a Critical/High default** - The quality gate is configurable and its effective policy is recorded with release evidence. By default, Critical and High production dependency findings block release; changing that default requires an explicit versioned policy selection, named ownership, and the applicable documented, time-bounded risk acceptance before F30 can proceed.
- **PD-07: No secret recovery by guessing** - If secure-store access, redaction, policy enforcement, or path ownership cannot be proven after restart, the application preserves the block and requires a bounded user-directed remediation rather than reconstructing or retrying with broader access.
- **PD-08: Residual provider/process risk is disclosed** - The MVP promises supported application-level isolation and no publication credentials, not an absolute guarantee against every action a local user-authorized process could attempt.

## Implementation Decisions

- **IMP-01: Versioned boundary matrix** - Store the threat model, data classifications, allowlists, owner, failure reasons, evidence, and residual-risk references as a versioned security artifact consumed by F30.
- **IMP-02: Typed capability gates** - Build security checks around versioned Zod/provider-neutral schemas and narrow service ports; do not add a generic authorization or service-call channel.
- **IMP-03: Canonical path guard** - Centralize path normalization, case-aware containment, symlink/junction handling, operation ownership, expected type, and current-revision checks for worktrees, database paths, and open/reveal actions.
- **IMP-04: Structured process invocation** - Reuse F00/F14's executable-plus-argument contract and F13's worktree identity; security tests reject shell strings and unauthorized environment inheritance at the process seam.
- **IMP-05: Controlled credential/environment seam** - Reuse F05's secure-store adapter and F15/F14 controlled-environment ports; F29 adds negative assertions and secret scans without copying credentials into application state.
- **IMP-06: Sink-first redaction** - Apply bounded redaction before persistence, IPC, activity, UI, provider context, and test evidence, with a fail-closed result when redaction cannot be proven.
- **IMP-07: Provider import and capability guard** - Keep Codex SDK imports in the adapter, expose only normalized provider contracts, and require unsupported policy/capability requests to terminate before provider start.
- **IMP-08: Security reason vocabulary** - Use stable reasons such as `IPC_SCHEMA_REJECTED`, `ROUTE_UNSUPPORTED`, `PATH_OUTSIDE_OPERATION`, `GIT_ARGUMENT_REJECTED`, `PROCESS_ENVIRONMENT_REJECTED`, `REDACTION_FAILURE`, `CREDENTIAL_BOUNDARY_VIOLATION`, `POLICY_UNSUPPORTED`, `POLICY_BOUNDARY_VIOLATION`, `PUBLICATION_AUTHORITY_DENIED`, `DEPENDENCY_GATE_FAILED`, and `SECURITY_EVIDENCE_INCOMPLETE`.
- **IMP-09: Credential-free conformance harness** - Use temporary repositories, fake secure stores, fake provider/process/network adapters, synthetic secret markers, and publication spies; no security test requires a real GitHub token or provider credential.
- **IMP-10: Lockfile and adapter guard** - Run reproducible installs and dependency evidence from the committed lockfile, and fail static import checks if provider, Electron privileged, Node process, or secure-store APIs cross their allowed module boundary.

## Testing Decisions

- **TST-01: Deep-test the boundary modules** - Test the IPC router/preload bridge, route parser, canonical path/ownership guard, structured process invocation, credential/environment broker, redaction, provider policy gate, and safe diagnostic projector through public contracts.
- **TST-02: Use adversarial table-driven fixtures** - Include encoded traversal, drive-relative/UNC/device paths, case and junction/symlink escape, option injection, shell-like arguments, malformed/oversized schemas, forged renderer sessions, stale revisions, secret-shaped output, provider policy broadening, and duplicate effects.
- **TST-03: Use real Electron and Windows checks where the boundary is platform-owned** - A fake adapter proves pure semantics, but packaged-like renderer isolation, Windows canonical path behavior, process environment behavior, and file-manager targeting require runtime evidence on the supported platform.
- **TST-04: Prove no side effects with spies and temporary repositories** - Security tests assert no child process, external open, Git mutation, secure-store enumeration, commit, push, response, merge, or publication intent occurs after rejection.
- **TST-05: Keep security evidence secret-free** - Test scans inspect SQLite, IPC, activity, logs, provider fixtures, validation evidence, notifications, and reports for synthetic secrets and raw privileged objects; failures preserve only safe diagnostics.
- **TST-06: Defer semantic correctness to owning features** - F29 validates authority, data, capability, and process boundaries; F15/F18/F26 remain responsible for semantic AI output and F23/F27 remain responsible for publication correctness.
- **TST-07: Treat dependency review as a configurable release gate** - Reproducible install, production dependency inventory, vulnerability result, provider import guard, lockfile/runtime identity, and the effective threshold policy are required evidence; the default Critical/High policy blocks those findings, and only an explicitly configured non-default policy may apply its documented risk-acceptance process.

## Proposed Modules

- **MOD-01: Threat Model and Boundary Catalog** - Maintains versioned assets, actors, classifications, boundary owners, mitigations, evidence references, and residual limitations.
- **MOD-02: Security Policy and Authorization Gate** - Evaluates typed capability requests against current operation state, ownership, policy, revisions, and explicit human approval.
- **MOD-03: Secure IPC Router and Preload Bridge** - Enforces channel/payload/session schemas, capability allowlists, bounded responses, renderer isolation, and safe renderer-session lifecycle.
- **MOD-04: Route and URL Normalizer** - Parses deep links, PR URLs, remote identities, and route targets without granting action authority.
- **MOD-05: Canonical Path and Operation Ownership Guard** - Resolves, contains, and revalidates worktree, database, file-opening, and process paths across Windows edge cases.
- **MOD-06: Safe Process/Git Invocation Guard** - Audits structured arguments, executable resolution, no-shell launch, option separation, environment allowlists, and effect restrictions.
- **MOD-07: Credential and Controlled-Environment Broker** - Connects F05/F14/F15 secure seams and proves only declared credentials/environment values reach their owner.
- **MOD-08: Secret Redaction and Safe Projection** - Bounds/redacts diagnostics, provider events, outputs, IPC DTOs, activity, notifications, and release evidence.
- **MOD-09: Provider Policy and Publication Guard** - Checks provider capability/policy translation, read-only floors, no-publication authority, structured output, and deterministic publication handoff.
- **MOD-10: Supply-Chain and Runtime Integrity Gate** - Produces lockfile/runtime/dependency evidence, vulnerability results, import-boundary checks, and dynamic-load/install checks.
- **MOD-11: Security Diagnostics and Conformance Runner** - Produces stable reasons, accessible attention projections, adversarial reports, and the bounded F30 evidence bundle.

## Workflows

### Workflow 1: Admit a renderer request

```text
1. The preload sends a versioned request through an allowlisted channel.
2. F29 validates channel, payload size, session/correlation identity, and schema.
3. The main process resolves the owning operation and asks the owning feature
   service to revalidate state, revision, ownership, policy, and human approval.
4. A valid request receives a bounded provider-neutral result; an invalid or
   stale request stops before the service side effect and records a safe reason.
5. Renderer closure or a lost reply does not change the main-process outcome.
```

### Workflow 2: Open an operation-owned worktree

```text
1. A Review Bundle or synchronization result requests an open/reveal action by
   stable operation identity, not by an arbitrary renderer path.
2. F29 resolves the current persisted path and rechecks canonical containment,
   expected type, owner, worktree revision, and allowed platform action.
3. The OS adapter receives only the validated target and returns a bounded result.
4. A missing, changed, escaping, or unowned path remains preserved and blocked;
   the application never substitutes the developer clone or another operation.
```

### Workflow 3: Prepare a provider or validation process

```text
1. The owning feature supplies an immutable task/policy/validation snapshot and
   an operation-owned worktree reference.
2. F29 validates capability, canonical path, executable/argument structure,
   environment allowlist, credential scope, output limits, and current revision.
3. Only after the owning durable intent and authorization are valid does the
   adapter prepare a no-shell process invocation.
4. Any unsupported capability, redaction uncertainty, secret, path escape, or
   snapshot mismatch returns a typed failure with no process start.
5. Provider and process evidence returns through bounded normalized contracts;
   raw SDK objects and uncontrolled output never become application state.
```

### Workflow 4: Recover a security block

```text
1. F28 loads the preserved operation, policy, credential reference, path owner,
   dependency evidence, and security reason.
2. Recovery may re-read deterministic evidence but cannot broaden policy, replace
   a worktree, restart a stopped AI segment, or retry a publication effect.
3. The UI shows what/why/evidence/next action with no secret disclosure.
4. An explicit user-directed remediation creates a new validated request only if
   the owning feature's state and F29 boundary checks pass again.
```

### Workflow 5: Produce the release security gate

```text
1. Install from the committed lockfile with the supported runtime.
2. Run the boundary/import, dependency, Electron, Windows, redaction, provider,
   process, path, recovery, and publication-spy test suites.
3. Scan the evidence for synthetic secrets, unauthorized effects, raw privileged
   objects, dynamic installs/loads, and unresolved release-blocking findings.
4. Publish the versioned threat model, dependency inventory, reports, residual
   risks, application-criteria trace, and exact source/runtime identities for F30.
```

## Contract-Test Criteria

- **CT-F29-01:** Threat-model and boundary-matrix fixtures cover every F29 scope area, data classification, owner, mitigation, evidence pointer, residual limit, and application-criteria mapping; missing owner/evidence, an unrecorded effective threshold policy, or unresolved release-blocking risk fails the gate.
- **CT-F29-02:** Electron fixtures inspect production-like web preferences, preload exports, navigation/new-window behavior, content/origin policy, renderer session lifecycle, unknown channels, malformed/oversized payloads, forged sessions, stale replies, and privileged-object leakage.
- **CT-F29-03:** Route/URL fixtures cover supported GitHub/GHES forms, server/repository/PR identity, unsupported schemes/hosts, user-info, encoded traversal, duplicate identifiers, oversized routes, notification/deep-link delivery, and zero action side effects.
- **CT-F29-04:** Path/open/Git fixtures cover Windows drive-relative, UNC, device, case, symlink/junction, missing, stale, developer-clone, database, credential-store, cross-operation, and arbitrary renderer paths plus option-injection/control-character/ref/remote/force-flag cases.
- **CT-F29-05:** Process/validation/database fixtures cover shell-string rejection, `shell: false`, executable resolution, argument round-trip, environment allowlists, worktree cwd, output/time bounds, F00 trust/confirmation, database canonicalization/migration/backup paths, and no publication capability.
- **CT-F29-06:** Credential/redaction fixtures use synthetic GitHub/provider/password/header/environment values across secure store, SQLite, IPC, activity, logs, notifications, validation output, provider context, structured results, and reports; known values never survive and redaction uncertainty blocks.
- **CT-F29-07:** Provider/policy fixtures cover read-only proposal/conversation floors, worktree-only paths, unsupported interactive/network/full-access/credential requests, malformed/unknown/secret-bearing structured output, raw SDK objects, no publication methods, and no automatic broadening.
- **CT-F29-08:** Authority/effect fixtures cover forged renderer/provider requests for commit, push, response, conversation resolution, review approval, merge publication, and worktree replacement; only owning deterministic services with explicit approval and fresh identity checks can reach effect spies.
- **CT-F29-09:** Recovery/diagnostic/accessibility fixtures cover renderer loss, restart, sleep/network recovery, stale/unknown paths, policy blocks, credential denial, redaction failure, bounded safe reasons, preserved evidence, keyboard/screen-reader/forced-colors/zoom/narrow-window presentation, and no auto-authorization.
- **CT-F29-10:** Supply-chain and release fixtures cover clean `npm ci`, dependency inventory, the default Critical/High blocking policy, explicitly configured non-default threshold/risk acceptance, lockfile/runtime identity, Codex import isolation, no dynamic install/load, secret scans, `npm run check`, both spec linters, and a complete F30 evidence bundle with no live credentials or external effects.

## Requirement Traceability

| Requirement family | Observable coverage | Named contract tests |
|---|---|---|
| FR-01 | AC-01, AC-20-AC-25 | CT-F29-01, CT-F29-09, CT-F29-10 |
| FR-02 | AC-02-AC-05, AC-16-AC-17, AC-22, AC-24 | CT-F29-02, CT-F29-03, CT-F29-08 |
| FR-03 | AC-05-AC-07, AC-18, AC-22-AC-24 | CT-F29-03, CT-F29-04, CT-F29-09 |
| FR-04 | AC-07-AC-10, AC-18-AC-19, AC-24 | CT-F29-04, CT-F29-05, CT-F29-09 |
| FR-05 | AC-10-AC-13, AC-20, AC-24-AC-25 | CT-F29-06, CT-F29-09, CT-F29-10 |
| FR-06 | AC-13-AC-19, AC-24 | CT-F29-07, CT-F29-08, CT-F29-10 |
| FR-07 | AC-21, AC-23-AC-25 | CT-F29-01, CT-F29-10 |
| FR-08 | AC-18-AC-20, AC-22-AC-25 | CT-F29-01, CT-F29-09, CT-F29-10 |
| FR-09 | AC-01, AC-21, AC-24-AC-25 | CT-F29-01-CT-F29-10 |
| NFR-01-NFR-09 | AC-01-AC-25 | CT-F29-01-CT-F29-10 |
| INV-01-INV-12 | AC-01-AC-25 | CT-F29-01-CT-F29-10 |
