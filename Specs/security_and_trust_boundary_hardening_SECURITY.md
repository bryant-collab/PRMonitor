# F29 Security and Trust-Boundary Evidence

This is the versioned review index for F29. It is descriptive evidence, not a
runtime authorization file. Feature owners remain authoritative for GitHub,
Git/worktree truth, validation truth, provider invocation, workflow state,
publication, and recovery.

## Security contract

F29 uses the main process as the only privileged application authority. Values
crossing a boundary are treated as untrusted until they pass a bounded typed
contract, current operation/identity checks, and the owning feature's
authorization. Uncertainty fails closed and leaves a safe reason that can be
reconciled or reviewed. AI and renderer contexts never receive publication
authority.

| Data class | Examples | Allowed destinations | Retention rule |
| --- | --- | --- | --- |
| Public/remote metadata | server, repository, PR number, branch identity | deterministic GitHub adapter, bounded read models | immutable snapshots where needed for reproducibility |
| Private source/context | worktree paths, diffs, PR intent, validation summaries | operation-owned worktree, approved provider task context, review UI | bounded to the owning operation and result history |
| Privileged control/state | approvals, policy snapshots, SHAs, idempotency state | main process and durable repositories | versioned and revalidated before effects |
| Credential/secret | GitHub token, provider credential, authorization header | host secure-store or the single scoped adapter request | never plaintext SQLite, IPC, AI context, diagnostics, or evidence |

## Boundary matrix

| Boundary | Owner | Allowlist / mitigation | Stable denial | Executable evidence | Residual limitation |
| --- | --- | --- | --- | --- | --- |
| Renderer / IPC | F04 | Context isolation, sandbox, typed channels, bounded payloads, live session | `IPC_SCHEMA_REJECTED` | CT-F29-02; `f29-security.test.ts` | A compromised renderer remains a local OS process risk. |
| URLs / routes | F06 + F04 | HTTPS configured origin, exact PR identity, view-only `prmonitor:` routes | `ROUTE_IDENTITY_AMBIGUOUS` | CT-F29-03; `f29-security.test.ts` | Remote text remains untrusted context. |
| Filesystem / worktrees | F13 | Canonical current path, expected type, operation owner, revision check | `PATH_OUTSIDE_OPERATION` | CT-F29-04; F13 path tests | The local user can alter filesystem links. |
| Git | F13 | Structured argv, no shell, allowlisted verbs, option separation, no force | `GIT_ARGUMENT_REJECTED` | CT-F29-04; F13 Git tests | Repository hooks/configuration can still attempt local OS actions. |
| Validation / child process | F00 + F14 | Trusted structured command, owned cwd, explicit environment, bounded output/time | `PROCESS_COMMAND_REJECTED` | CT-F29-05; validation-contract tests | Validation executes repository-controlled code by design. |
| SQLite | F03 | Main-process app-data path, canonical path admission, no renderer override | `DATABASE_PATH_REJECTED` | CT-F29-05; persistence tests | Local application-data write access can damage state. |
| Credentials | F05 | Opaque SQLite reference, host secure-store access only, synthetic scans | `CREDENTIAL_BOUNDARY_VIOLATION` | CT-F29-06; F05 tests | Host secure-store availability remains an OS concern. |
| Provider / policy | F15-F17 | Normalized schemas, policy floor, worktree-only scope, no publication API | `POLICY_BOUNDARY_VIOLATION` | CT-F29-07/08; F15/F17 tests | No app-level contract can sandbox every local-process action. |
| Diagnostics / recovery | F09 + F28 | Bounded redacted reasons, durable evidence, no automatic broadening | `REDACTION_FAILURE` | CT-F29-09; F28 tests | Diagnostics never replace owning workflow authority. |
| Dependencies / runtime | F29 + F30 | Lockfile, supported runtime, provider import isolation, audit threshold | `DEPENDENCY_GATE_FAILED` | CT-F29-10; `f29-security-gate.mjs` | Signing/updater/absolute supply-chain guarantees are F30 scope. |

## Effective quality gate

The effective default is Critical and High production dependency findings block
the gate. A non-default threshold requires an explicit versioned policy,
named ownership, and time-bounded risk acceptance before F30 can proceed. The
`f29-security-gate.mjs` reads `F29_QUALITY_GATE_THRESHOLD` (default `high`) and
records the equivalent blocked-severity policy. A non-default threshold also
requires `F29_QUALITY_GATE_POLICY_VERSION`, `F29_QUALITY_GATE_OWNER`, and a
future `F29_QUALITY_GATE_RISK_ACCEPTANCE_UNTIL` date. The gate records the
lockfile/runtime identity, production dependency inventory, provider import
graph, dynamic-load scan, secret/effect scans, test results, application-
criteria trace, and both specification-linter reports.

## Defense-in-depth limits

The MVP does not promise an absolute OS, network, anti-malware, or provider
process sandbox. Validation may execute repository-controlled code inside its
declared structured boundary. Provider and process code may attempt actions
available to the user's local account. Publication remains deterministic,
non-force, idempotent, and explicitly human-approved. F29 hardens these
boundaries and fails closed when its evidence is incomplete; it does not add a
security-specific workflow state machine.

## Reproducible commands

```text
npm ci
npm run security:gate
npm run check
npm audit --omit=dev --audit-level=high
npm run lint:prd-plan -- Specs/security_and_trust_boundary_hardening_PRD.md Specs/security_and_trust_boundary_hardening_PLAN.md
npm run lint:application-coverage -- Specs/application_overview.md Specs/security_and_trust_boundary_hardening_PRD.md
```

All security fixtures use temporary repositories, fake adapters, publication
spies, and synthetic secrets. No live GitHub or provider credential is needed.

## Recorded F29 run

Recorded 2026-09-28 on the supported Windows runtime:

- `npm ci`: pass from the committed lockfile. npm's aggregate install audit
  reported five development-tree advisories; the required production-only
  audit below reported zero vulnerabilities, so no production release-blocking
  finding was present under the configured policy.
- `npm run security:gate`: pass; Node 24.19.0, npm 11.17.0, lockfile v3,
  production package count 9, Codex SDK 0.155.1, default Critical/High policy,
  isolated provider import, no renderer/shared leaks, and no dynamic loading.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `npm run check`: pass; packaged desktop artifact, smoke check, 261 desktop
  tests, 43 validation-contract tests, and 17 spec-linter tests.
- PRD/plan lint: 104 covered, 0 missing, 1 needs-review.
- Application-coverage lint: 16 covered, 4 not-applicable, 57 needs-review,
  0 missing; result was PASS WITH REVIEW.
- `git diff --check`: pass.
