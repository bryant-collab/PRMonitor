# Named AI connections and shared setup draft

This implements the approved configuration and UI scope: machine-local named
connections, native executable Browse/detection, a supported extra-argument
allowlist (including configurable Codex --no-daemon), one default connection for
all tasks and advanced task overrides. Connection changes and task revisions are
atomic; immutable operation snapshots retain their captured connection. Existing
ignored provider JSON is removed once through versioned persistence, without
rewriting captured history. Models and reasoning are supported choices rather
than arbitrary JSON. New Codex choices use the public rust-v0.156.0 catalog;
legacy choices stay visible and unchanged, and actual model/list support is
checked before the prepared protocol can start a turn.

Setup and Settings share forms. Setup follows GitHub, AI connection, work
permissions, and review/finish; navigation/restarts derive progress from durable
readiness. Ordinary form drafts survive navigation, while unsaved GitHub
credentials are cleared when their form becomes hidden. Saves/discards require
actual changes. PRs, Activity and Settings are primary destinations; PR filters
preserve inspection and full synchronization selection. Add PR has one inbox
entry. All native controls have accessible hover/focus tooltips; essential
validation, billing and blocked-state explanations remain inline.

## Provider boundary and remaining execution acceptance

No real account sign-in, credential-file inspection, model call or billed API
fallback was performed. Existing Codex subscription sign-in is the default.
PRMonitor verifies the provider directory without reading or copying auth files,
does not add forced_login_method to shared-store launches, and consumes login
status privately without projecting raw output (API status can contain partial
key characters). Optional separate browser sign-in uses the provider command in
a verified application-owned CODEX_HOME. Enforcement stays inside that owned
store. Sign-in/turn ownership is serialized by connection; cancellation/timeouts
close the owned child.

The public app-server adapter checks exact authentication method through
getAuthStatus with includeToken:false, requires no exported token, checks account
classification, effective managed requirements, configuration, actual
model/reasoning support and returned thread permissions before sending context.
The provider preflight can refresh its own authentication; it is not described
as an offline or nonmutating check. Custom OpenAI provider/auth/endpoint overrides
are rejected. Resumes reapply explicit policy; requests contain no credentials,
output is bounded, and ungranted approval/external-tool requests or billing-mode
changes are rejected with fixed errors. Subscription never selects API fallback.

Named Codex Linux execution uses the supported read-only or operation-worktree
write sandbox, approval never, explicit network policy and controlled environment.
The earlier blanket filesystem-read blocker exceeded F29 PD-08 and has been
removed: the MVP explicitly documents residual local-process/filesystem risks
and does not promise absolute OS isolation. Synthetic tests verify required
account, environment, policy and writable-root contracts. They do not establish
absolute exclusion of every credential file from filesystem reads.

Native Windows remains blocked under the prohibition on security changes:
windowsSandbox/readiness can refresh Registered Core before returning; elevated
execution provisions/refreshes, and unelevated execution also changes ACLs.
No supported no-setup/no-elevation launch flag was established. No readiness,
provisioning, elevation, ACL change or user-machine mutation was attempted.

Claude Code and GitHub Copilot integration remains in progress, not complete.
Their detected installations are not represented as ready while effective
permissions/authentication are unverified. Claude's supported restricted file-tool
path and SDK settings resolution are being investigated; managed hooks cannot be
claimed disabled by ordinary CLI overrides. Copilot needs an actual supported
adapter rather than detection alone.

Sources used for the permission findings:

- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/protocol/src/protocol.rs#L1222
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/core/src/config/permissions.rs
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/core/src/config/managed_features.rs
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/app-server/src/request_processors/windows_sandbox_processor.rs
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/core/src/windows_sandbox.rs
- https://code.claude.com/docs/en/hooks
- https://github.com/github/copilot-sdk/blob/v1.0.13/nodejs/src/generated/rpc.ts

## Evidence and acceptance

Automated fixtures cover connection/argument/IPC bounds, native Windows npm
payload resolution, abort propagation, atomic multi-task settings and rollback,
legacy SQLite migration and immutable history, stale renderer replies, repeated
Save/sign-in clicks, sign-in cancellation, draft retention, supported choices,
setup gates, tooltip keyboard/hover/Escape behavior, managed-hook rejection,
billing mismatch, permission escalation, model pagination/identity and process
cleanup. Child-process fixtures use only Node and synthetic nonsecret data;
provider/model fixtures perform no real authentication or model contact.

The latest full desktop run passed 504 tests in 50 files. Final exact-head CI
must establish the aggregate result after remaining provider changes. All desktop typechecks, ESLint, formatting, build and Linux packaging
passed on the completed local aggregate attempt. Native smoke stopped at
SANDBOX_SETUP_FAILED / HELPER_OWNERSHIP_OR_MODE in this cloud environment. No
sandbox assertion was disabled and no ownership or security setting was changed.

The Windows journey was updated for the shared setup steps, advanced task
controls, dirty-only saves, hidden-form credential clearing and filtered full
selection. Final Windows native CI is required; a green unit suite does not
establish that journey. Physical Windows DPI, screen-reader interaction, real
subscription access and user-machine runtime readiness remain unverified.

No merge, release, deployment, paid service, real-user app-data change or security
mutation is authorized by this draft. There is no checklist.md item to close; the
additional provider and Windows execution acceptance is explicitly incomplete.
