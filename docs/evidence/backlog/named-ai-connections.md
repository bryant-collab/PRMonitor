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

Windows Codex now uses the supported empty-environment, host-file-tool path.
The provider's native sandbox readiness/setup APIs can change security settings,
so they are never called. The filtered child environment sets
CODEX_EXEC_SERVER_URL=none, and launch rejects any environments.toml in the
existing store (it takes precedence over that setting). Thread start selects no
environments, runtime roots or capability roots. New and cold-resumed thread
responses must report environments:[]; null or a native/remote selection fails
before input. Resume uses only supported resume fields. Every turn explicitly
selects no environments. Native command, patch, image, permission, extension,
search and agent tools remain disabled. Upstream v0.156 tests establish that
empty environments remove native environment-backed registrations.

Only operation-owned, conversation/turn-bound PRMonitor file callbacks execute.
They validate exact arguments, canonical paths, single-linked files, Git
administration exclusions, byte limits and cancellation. Read-only tasks cannot
write; edits require one literal match; writes handle partial OS writes and
remove only an exclusively created file on precommit failure. Bounded call-ID
caching prevents duplicate mutations and rejects changed replay arguments.
Native approval requests stay rejected. This is a file-tool restriction, not
disabling sandbox assertions or proving absolute OS isolation. Windows-native
provider acceptance has not run.

Claude Code now uses the pinned official Agent SDK with the selected native
program and existing subscription store. Its isolated policy helper returns
only bounded nonsecret decisions from provider-owned managed settings resolution.
Managed hooks/launch commands/billing overrides block invocation; no configured
hook is bypassed. Restricted/safe mode, explicit file tools, disabled permission
prompts, empty MCP/plugins and scoped PreToolUse callbacks constrain each task.
The prompt remains held until subscription identity, model/effort and
hooks_applied:true are confirmed. Registration metadata does not prove live hook
execution. A captured owned child bounds bytes before SDK decoding and awaits
TERM/KILL cleanup before releasing connection ownership.

GitHub Copilot now uses the pinned official SDK with the selected CLI, existing
user OAuth on github.com, explicit service model and source-qualified file tools.
API keys, gh CLI credentials, provider-qualified/BYOK models and auto-selection
are rejected. Managed hook discovery must be complete and have no enabled hooks.
Config discovery, MCP/custom tools, skills, memory, scheduling, host Git operations
and remote sessions are disabled. Resumes reapply the complete restrictions and
disable pending work; the returned session/model must match. No public JSON schema
option is invented: final JSON is validated by the existing strict host contract.
Cancellation bounds pending SDK promises, abort/disconnect and stop; normal stop
awaits the child. The pinned SDK force-stop fallback sends SIGKILL but does not
await process close; actual fallback reaping remains a native acceptance item.

Both pinned SDKs use the explicitly supplied environment without merging parent
environment values. Their types and dependencies are isolated in a private
workspace with Zod 4; application contracts retain Zod 3. No renderer/shared
SDK import, credential copy, CLI auto-download, real sign-in or live provider call
was introduced. Search callbacks reject linked or excessively large/deep
subtrees; use an explicitly scoped file/directory when broader search is denied.
Provider settings/hook discovery are snapshots, not proof against later
administrator-policy changes; F29 residual local-process and filesystem-race
limits continue to apply.

Sources used for the permission findings:

- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/protocol/src/protocol.rs#L1222
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/exec-server/src/environment.rs#L178
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/core/src/tools/spec_plan_tests.rs#L1298
- https://github.com/openai/codex/blob/rust-v0.156.0/codex-rs/tui/src/temporary_structured_request.rs
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

The final desktop suite passed 527 tests in 54 files, including the last
adapter/path/replay/helper and late-metadata state regressions. Final aggregate
and exact-commit CI results are recorded after the final source boundary. Desktop
typechecks, ESLint, production build, isolated built helper and the production
dependency audit passed; the audit reported zero vulnerabilities. SDK import
isolation and nested dependency inventory remain enforced. Artifact inspection verifies the packaged private runtime and nested Zod 4
files, and the extracted production policy helper returns the same bounded
nonsecret decision. The original content regex falsely classified the pinned
SDK's compiled GITHUB_TOKEN schema export getter as a credential value. The
checker now distinguishes only simple zero-argument property getters; original
assignment checks remain, quoted keys are covered, and recognizable token
literals are detected independently. Tests deny literals, calls, expressions,
member/block getters and assignments after a permitted getter. No vendor file
is excluded from inspection. This is credential-shaped content detection, not
a proof that every arbitrary secret encoding can be recognized.

Native smoke stopped at
SANDBOX_SETUP_FAILED / HELPER_OWNERSHIP_OR_MODE in this cloud environment. No
sandbox assertion was disabled and no ownership or security setting was changed.

The Windows journey was updated for the shared setup steps, advanced task
controls, dirty-only saves, hidden-form credential clearing and filtered full
selection. Final Windows native CI is required; a green unit suite does not
establish that journey. Physical Windows DPI, screen-reader interaction, real
subscription access and user-machine runtime readiness remain unverified.

No merge, release, deployment, paid service, real-user app-data change or security
mutation is authorized by this draft. There is no checklist.md item to close. Required native user-PC acceptance:
read-only version/auth metadata; subscription model access; fresh and cold-resumed
file tasks; outside/link/read-only/Git-denial sentinels; cancellation and forced
cleanup; and absence of setup/elevation/ACL changes. Confirm the PC runtime is
reachable with a fresh harmless command before attempting any of these. An
earlier runtime-ownership failure does not establish its current availability.
