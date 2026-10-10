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
Cancellation bounds pending SDK promises, abort/disconnect and stop. Source review
of SDK 1.0.13 confirms that normal stop clears its child handle before attempting
a bounded wait for process exit, and can time out and return errors. PRMonitor's
two-second stop deadline can expire during that wait: force-stop then has no
child handle to kill. When a handle remains, force-stop sends SIGKILL and clears
it without awaiting exit/close; the public stdio API exposes neither
a spawn callback nor a child-close receipt. A resolved mocked force-stop call
does not prove native reaping. This correction does not access private SDK fields,
change transports, open TCP listeners or change provider versions. The approved
supervised-worker design now establishes application-owned Windows Job ownership
before SDK initialization, preserves bounded scope-bound permission callbacks,
and awaits worker close plus zero Job processes before releasing the connection.
Uncertain cleanup quarantines the connection instead of admitting overlapping
work. SDK stop is advisory. Native and packaged worker fixtures passed on hosted
Windows. Fresh independent review and green hosted Windows acceptance allowed
removal of the temporary production admission gate. Architecture, fixture boundaries and exact evidence are in
[Copilot supervised SDK worker](copilot-worker.md). Live user-PC/provider
acceptance remains separate and unverified.

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

The desktop suite passed 530 tests in 54 files before the discovery-mode regression,
which adds one test for 531 total, including the three hidden-panel
regressions. Final verification includes the last
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

Shipping packaging fixtures retain builder diagnostics on stderr so the pinned
logger cannot interleave raw stdout with Node's serialized test results. Provider
fixtures create their roots beneath realpath(Temp), including on Windows where
Temp may use a short-name alias. Canonical-worktree, link-denial and cancellation
assertions remain intact; the application still rejects noncanonical roots.

Hidden Settings and unrelated settings categories do not launch AI program
checks. Opening the AI category discovers executables through filesystem reads,
without CLI execution, auth/model contact, or a compatibility claim. The explicit
Check program and sign-in action performs version/auth checks. Discovery does not overwrite an
unsaved program draft or displaying a saved-program result for that draft. The
effect rejection guards also ignore old failures after hiding, reopening or
editing a launch draft. The native journey retains its production-main setup
stages and existing controlled-provider stages; no extra metadata port is substituted.
Forbidden real subprocess/network assertions remain in force. Production version/auth and provider contracts are exercised
separately by the adapter tests.

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

## Detected-only correction and launch-option review

The primary AI tool dropdown now contains only filesystem-detected programs.
Loading and no-program states disable that dropdown while leaving manual Browse
available. A separate Program type for Browse control selects the provider for a
custom executable. Saved missing/custom connections remain visible in the Saved
connection list and keep their paths, arguments and history until explicitly
edited. Reopening the AI panel refreshes detection; late replies from a hidden
panel cannot restore stale results. Discovery still performs no CLI/auth/model
probe. Browse continues through explicit compatibility validation.

The exact per-provider optional argument allowlist is Codex --no-daemon,
Claude --no-chrome and Copilot --no-color. The Claude option disables browser
integration; Copilot's option changes color output. None changes billing, roots,
approvals, sandbox permissions, hooks, models or session persistence. Unknown,
duplicate and cross-provider flags remain rejected. When an option is selected,
the selected executable must advertise the exact flag in bounded --help output
before any authentication check. Literal SDK forwarding retains every mandatory
safety option. Model, directory, config, logging, token, prompt, plugin, permission,
resume and no-session-persistence overrides remain excluded. In particular,
Claude's no-session-persistence option conflicts with cold-resume behavior;
Copilot no-auto-update is already owned and enforced by the SDK.

Primary references used for this review:

- https://code.claude.com/docs/en/cli-reference
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://github.com/github/copilot-sdk/blob/v1.0.13/nodejs/src/client.ts

The full desktop suite passed 539/539 in 54 files and the SDK/security gates passed.
Focused renderer/connection/provider tests passed 60/60; all five typecheck
stages passed. Tests exercise detected-only choices, missing saved connections,
loading/empty Browse fallback, manual custom-program validation/save, exact help
support, duplicate/cross-provider rejection, and SDK forwarding with safety
settings intact. Final aggregate and exact-head CI results follow the final source
boundary. No live provider authentication or user-PC acceptance is claimed.

The prior review installer is an incomplete candidate from head
74f98e7205e7b50847308d9be12271934f2a96d7: it lacks this dropdown correction.
Artifact 11594584077 expires 2026-10-10T04:25:13Z. Its uploaded ZIP digest is
38bef41f4cf9dfb3b5c35ed194f61d9a0d418f433f72df232f0f396d1970fe5c.
Connector download succeeded, but transfer into the task workspace returned a
proxy 403; the ZIP and installer checksum were not verified or cached locally.
This does not block rebuilding from source. On a disposable Windows build runner
with pinned Git 2.55.0, Node 24.19.0 and npm 11.17.0, check out that exact commit,
run npm ci, npm run check:runtime, npm run build:validation-contract and
npm run build:desktop, set CSC_IDENTITY_AUTO_DISCOVERY=false, then run
npm --workspace @prmonitor/desktop run package:installer. The script uses
--publish never and produces release/PRMonitor-0.1.0-x64.exe. Generate a fresh
SHA-256 using Get-FileHash; rebuilt bytes may differ, so do not reuse the old
artifact checksum. For the corrected candidate, use the final PR head instead.
The existing CI workflow builds, accepts and retains a new unsigned installer
plus its checksum for one day without publishing a release.
