# F05 Secure GitHub Server Profiles and Authentication - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

### Upstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F03 - SQLite persistence, migrations, and transactional repositories | Provides the main-process database, safe GitHub server metadata/reference storage, transaction boundaries, snapshots, idempotency records, and restart-safe repository contract. |
| 2 | F04 - Persistent Electron shell, IPC boundary, and Windows virtual-desktop spike | Provides the main-process authority, validated IPC, renderer-session lifecycle, and explicit window-close/reopen behavior used by the server settings surface. |

### Downstream Dependencies

| # | Feature | Relationship |
|---|---|---|
| 1 | F06 - GitHub REST client and remote identity model | Consumes the verified server profile and the deterministic, credential-brokered request boundary for authenticated GitHub REST calls. |
| 2 | F07-F12 - Managed PRs and deterministic monitoring | Use verified server profiles to retrieve PRs and feedback without placing credentials in renderer state or AI work. |
| 3 | F23 and F27 - Human-approved publication and synchronization publication | Reuse the same deterministic GitHub authentication boundary for explicitly approved remote effects; F05 does not authorize those effects. |
| 4 | F29-F30 - Security hardening and Windows release readiness | Harden and verify the credential boundary, packaging behavior, secure-store availability, and clean-machine recovery established here. |

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-AC-01 | FR-01.1-FR-01.5, FR-02.1-FR-02.6, FR-03.1-FR-03.7, FR-04.1-FR-04.5, FR-05.1-FR-05.6, FR-06.1-FR-06.5, FR-07.1-FR-07.4, INV-01-INV-09 | AC-01-AC-18 | Primary: F05 owns server-profile configuration, secure credential storage, connection verification, and the safe authenticated-request boundary. F06 owns later resource calls and remote identity behavior. |

F05 does not claim APP-AC-28, APP-AC-29, or any publication criterion. Those features may consume this credential boundary, but F05 never grants commit, push, comment, merge, or other publication authority.

F05 also does not claim APP-AC-20 or APP-AC-30. References to renderer close/reopen and process restart describe preservation of an authentication operation; F04 owns virtual-desktop/window lifetime behavior and F19 owns the complete user-facing shutdown workflow.

## Executive Summary

PRMonitor needs a trustworthy way to connect to GitHub.com and GitHub Enterprise Server before it can add or monitor pull requests. A server URL alone is not enough: the application must know which server identity it represents, test that the configured credential works, survive restarts, and explain failures without exposing the credential that caused them.

F05 adds GitHub server profiles and personal-access-token authentication to the desktop application. A developer can add a GitHub.com or GHES server, enter a token once, test the connection, and see a safe account/status summary. The token is held only by a host-protected credential store and a deterministic GitHub infrastructure boundary. SQLite stores an opaque reference and non-secret verification metadata; the renderer receives only masked input and safe results; AI, validation, Git, logs, activity records, and ordinary IPC responses never receive the token.

The feature is deliberately conservative around uncertain outcomes. A credential replacement is stored as a candidate, tested against the intended server, and activated only after a successful deterministic response. Interrupted writes, cancelled tests, unavailable secure storage, invalid credentials, redirects, and TLS failures remain unverified and actionable rather than silently falling back to plaintext or claiming that authentication succeeded.

## User Stories

### Configure a GitHub server

- **US-01:** **GIVEN** the developer opens GitHub server settings, **WHEN** they add a GitHub.com or GHES server URL and display name, **THEN** PRMonitor normalizes the server identity, shows the derived API endpoint, and prevents duplicate profiles for the same server.
  - **Acceptance Criteria:** AC-01, AC-02.
- **US-02:** **GIVEN** a server profile has no usable credential, **WHEN** the developer views it, **THEN** the profile remains visible with a clear unverified status and an action to add or replace its token; no secret is displayed or inferred.
  - **Acceptance Criteria:** AC-03, AC-04, AC-09.

### Verify access safely

- **US-03:** **GIVEN** a valid server profile and a token entered through the settings form, **WHEN** the developer chooses **Save and Test** or **Test Connection**, **THEN** PRMonitor performs a read-only authenticated identity request to that configured server and reports the verified account or an actionable failure.
  - **Acceptance Criteria:** AC-05-AC-08.
- **US-04:** **GIVEN** the server is unreachable, the token is invalid, secure storage is unavailable, or the response is unsafe or malformed, **WHEN** the test finishes, **THEN** the profile is not marked verified and the developer receives a safe reason with a next action that contains no token or raw secret-bearing response.
  - **Acceptance Criteria:** AC-07, AC-08, AC-11.

### Keep authentication durable and bounded

- **US-05:** **GIVEN** a credential write or test is in progress, **WHEN** the window closes, the renderer is destroyed, the process restarts, or the user cancels, **THEN** the main process preserves a recoverable operation record and never claims an unverified credential is active.
  - **Acceptance Criteria:** AC-10, AC-12, AC-13, AC-18.
- **US-06:** **GIVEN** the developer replaces a working token, **WHEN** the new token is tested successfully, **THEN** the new credential becomes active, the previous credential is retired through the secure store, and a failure leaves the previous verified credential usable.
  - **Acceptance Criteria:** AC-14, AC-15.
- **US-07:** **GIVEN** a later deterministic GitHub service needs to make an authenticated request, **WHEN** it asks for access for a verified server profile, **THEN** it receives only a request-scoped credential capability through the GitHub infrastructure boundary and no other application service can read or export the secret.
  - **Acceptance Criteria:** AC-16, AC-17.

### Use an accessible, understandable settings surface

- **US-08:** **GIVEN** a developer uses keyboard navigation, a screen reader, or a failed connection test, **WHEN** they interact with server settings, **THEN** every field, status, error, and next action is labeled, focusable, and understandable without revealing the credential.
  - **Acceptance Criteria:** AC-02, AC-09, AC-18.

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a developer enters `https://github.com` or an HTTPS GHES server origin, **WHEN** the profile is validated, **THEN** PRMonitor stores a canonical server identity, derives the documented API base (`https://api.github.com` for GitHub.com or the GHES `/api/v3` root), rejects credentials/userinfo/query/fragment/path ambiguity, and shows the server identity before authentication is submitted.
- **AC-02:** **GIVEN** two profile submissions identify the same canonical server, **WHEN** either is saved, **THEN** PRMonitor reuses or updates the existing profile according to its version, does not create duplicate active identities, and exposes a labeled settings view with keyboard-accessible fields and safe validation errors.
- **AC-03:** **GIVEN** the developer enters a token, **WHEN** the form submits it, **THEN** the token is carried only through the dedicated, allowlisted one-time credential operation, is not copied into ordinary renderer state, URLs, activity events, generic IPC responses, or read models, and the entry control is cleared after submission or failure.
- **AC-04:** **GIVEN** the host secure credential backend is unavailable, weak, not initialized, or reports an error, **WHEN** the developer attempts to save a token, **THEN** PRMonitor refuses the write, preserves no plaintext fallback, leaves the profile unverified, and gives a remediation such as enabling the host credential service or retrying after application readiness.
- **AC-05:** **GIVEN** a server profile and candidate credential are valid, **WHEN** the developer chooses **Save and Test**, **THEN** PRMonitor persists the server/auth operation intent and immutable endpoint/profile snapshot before writing the candidate credential or making the network request, then performs only a read-only authenticated identity check against the configured server.
- **AC-06:** **GIVEN** the identity endpoint returns a valid successful response from the configured server, **WHEN** the response is validated, **THEN** the candidate credential is marked verified and becomes the active credential, and the UI shows only safe metadata such as server, account login when available, verification time, and credential status.
- **AC-07:** **GIVEN** the identity request returns an authentication failure, authorization failure, rate limit, DNS/TLS/network error, timeout, cancellation, malformed response, or unexpected server response, **WHEN** the result is normalized, **THEN** the profile is not marked verified and the UI presents a machine-readable category, plain-language explanation, and next action without exposing the token, authorization header, raw response body, or sensitive request details.
- **AC-08:** **GIVEN** the configured server responds with a redirect, certificate error, non-HTTPS endpoint, cross-origin location, or an API response that cannot be tied to the configured server identity, **WHEN** the connection test handles it, **THEN** PRMonitor fails closed, does not forward the token to another origin, and records a safe endpoint/security reason.
- **AC-09:** **GIVEN** a profile is listed after a successful or failed test, **WHEN** the renderer requests the server settings read model, **THEN** it receives canonical server metadata, credential status, verification outcome, safe account metadata, timestamps, and actionable reason data only; it never receives the token, encrypted credential bytes, credential-store path, or a secret-shaped error.
- **AC-10:** **GIVEN** a profile was verified before the window closed or the process restarted, **WHEN** PRMonitor starts again, **THEN** it reconstructs the profile and opaque credential reference from SQLite so the next explicit deterministic GitHub request can reconnect through the secure credential boundary, and it does not require the token to be re-entered solely because the renderer or process restarted; renderer recreation alone does not trigger an implicit connection test.
- **AC-11:** **GIVEN** a token is missing, expired, revoked, rejected, or the secure store cannot retrieve it, **WHEN** a later deterministic GitHub request or explicit test detects the condition, **THEN** PRMonitor marks the profile as needing attention without deleting the token automatically, without looping requests, and without placing the failed credential in logs or AI context.
- **AC-12:** **GIVEN** a save/test operation is interrupted by renderer destruction, application shutdown, or process restart, **WHEN** startup reconciliation reads its durable record, **THEN** the operation is finalized as incomplete or recovery-required, no candidate is silently activated, no test is reported as verified, and the developer can explicitly retry or clean up it.
- **AC-13:** **GIVEN** the developer cancels or a bounded timeout expires during a secure-store or connection operation, **WHEN** cancellation is observed, **THEN** the operation ends with a distinct cancelled/interrupted reason, does not mark authentication verified, does not silently retry, and preserves the prior active credential if one existed.
- **AC-14:** **GIVEN** a verified profile has an active credential and the developer submits a replacement, **WHEN** the replacement is written and tested, **THEN** the previous credential remains active until the candidate succeeds; a successful candidate is activated exactly once and the previous reference is retired through a separately recorded cleanup step.
- **AC-15:** **GIVEN** a replacement write, activation, retirement, or cleanup has an uncertain outcome, **WHEN** the application restarts or retries, **THEN** it reuses the durable operation identity, does not create multiple active credentials, does not claim cleanup succeeded without evidence, and leaves the profile in a safe actionable state.
- **AC-16:** **GIVEN** a later deterministic GitHub infrastructure service requests authentication for a verified profile, **WHEN** the credential broker resolves it, **THEN** only that service boundary can obtain a request-scoped authorization capability; renderer, AI-provider, validation, Git, notification, activity, and publication orchestration code cannot call the secure store or receive the raw token.
- **AC-17:** **GIVEN** any token-shaped value, credential-store error, HTTP header, exception, or diagnostic crosses persistence, logging, IPC, activity, or AI-preparation code, **WHEN** the boundary serializes or reports it, **THEN** the secret value is absent or redacted and the output remains bounded and actionable.
- **AC-18:** **GIVEN** a developer uses the server settings form and status/error states, **WHEN** the profile is created, tested, fails, cancelled, or retried, **THEN** labels, focus order, masked-input behavior, status announcements, and remediation controls are usable by keyboard and assistive technology, and no action requires the developer to paste a token into a URL, general-purpose text field, or AI conversation.

## Functional Requirements

### FR-01: GitHub server profile identity and configuration

- FR-01.1: The application SHALL support multiple independently managed server profiles for GitHub.com and GitHub Enterprise Server, with a stable opaque profile identifier, display name, server kind, canonical web origin, canonical API base, credential status, and safe verification metadata.
- FR-01.2: The application SHALL normalize server URLs deterministically, SHALL require HTTPS for saved profiles, SHALL reject userinfo, credentials, query strings, fragments, ambiguous paths, unsupported schemes, and malformed hosts, and SHALL derive the API base from the normalized server kind and origin.
- FR-01.3: The application SHALL treat the canonical server identity as the uniqueness boundary, SHALL prevent duplicate active profiles for one server, and SHALL never select a same-named server or API host implicitly.
- FR-01.4: A profile SHALL be allowed to exist in an unverified or attention-required state so that configuration failures remain visible and actionable without being treated as usable GitHub access.
- FR-01.5: Editing a display name or safe metadata SHALL not change the server identity or silently change the credential; changing the canonical origin SHALL require a new verification for the new identity.

### FR-02: Credential capture and secure storage

- FR-02.1: The MVP SHALL support a personal access token as the GitHub authentication method and SHALL not require GitHub App installation, OAuth device flow, or SSH credentials.
- FR-02.2: Credential submission SHALL use a dedicated, versioned, allowlisted operation with bounded input and no generic renderer method that can read, echo, or export stored credentials.
- FR-02.3: The application SHALL store token material only through a host-protected secure credential-store adapter and SHALL fail closed when the adapter is unavailable, weak, uninitialized, or unable to complete the write.
- FR-02.4: SQLite SHALL store only an opaque credential reference, credential revision/status, operation identifiers, and safe metadata; it SHALL never store plaintext tokens, encrypted credential bytes, token-derived URLs, or reversible token material.
- FR-02.5: The secure-store adapter SHALL support create, read-for-authorized-request, retire, and cleanup operations without exposing a general-purpose secret-read API to the renderer or unrelated application services.
- FR-02.6: A replacement credential SHALL use a new candidate reference or revision and SHALL not replace the active verified credential until deterministic connection testing succeeds.

### FR-03: Deterministic connection testing

- FR-03.1: The application SHALL provide explicit **Save and Test** and **Test Connection** actions and SHALL not invoke a credentialed test merely because a profile is displayed or a renderer window is recreated.
- FR-03.2: A connection test SHALL use a deterministic, read-only authenticated identity request against the profile's canonical API base and SHALL not create, update, delete, comment on, approve, merge, or otherwise mutate GitHub state.
- FR-03.3: The test client SHALL use only the configured server identity, SHALL not place credentials in URLs or query parameters, SHALL validate TLS certificates, SHALL reject cross-origin redirects, and SHALL not forward an authorization header to another origin.
- FR-03.4: Secure-store reads, HTTP requests, and response validation SHALL have bounded timeouts and explicit cancellation; cancellation, timeout, or process interruption SHALL never produce a verified result.
- FR-03.5: Only a response that passes deterministic HTTP/status/schema/server-identity validation SHALL mark a credential verified; model claims, UI optimism, cached prior success, or a previous token SHALL not substitute for the current check.
- FR-03.6: The test service SHALL normalize authentication, authorization, rate-limit, network, TLS, timeout, cancellation, redirect, protocol, and unexpected-response outcomes into bounded machine-readable reasons with safe remediation text.
- FR-03.7: Connection-test results SHALL include the tested profile/credential revision, endpoint identity, timestamps, safe account metadata when available, and the exact reason for any non-verified outcome, but not the token or raw secret-bearing response.

### FR-04: Durable intent, activation, cleanup, and recovery

- FR-04.1: Before a secure-store write, secure-store removal, or network connection test, the application SHALL persist the operation intent, idempotency identity, owner/profile version, credential revision, endpoint snapshot, and safe action context through the F03 transaction boundary.
- FR-04.2: Each credential operation SHALL have an explicit lifecycle and SHALL be idempotent by operation identity; replay SHALL return or reconcile the existing outcome rather than create a second active credential or duplicate test intent.
- FR-04.3: Startup SHALL reconcile incomplete credential operations as incomplete or recovery-required, SHALL preserve the prior active credential when possible, and SHALL never auto-authorize an untested candidate solely because a store write may have succeeded.
- FR-04.4: Only a successfully tested candidate may become the active credential reference. A failed, cancelled, stale, or uncertain candidate SHALL remain inactive until an explicit retry or cleanup decision.
- FR-04.5: Credential retirement and cleanup SHALL be recorded separately from profile deletion or activation, SHALL be retryable, and SHALL not be reported as complete without secure-store evidence.

### FR-05: Secret and trust-boundary protection

- FR-05.1: Raw GitHub credentials SHALL be available only inside deterministic GitHub authentication infrastructure and the narrow request path that consumes them; they SHALL not be available to AI providers, validation commands, Git subprocesses, renderer read models, notifications, or generic activity services.
- FR-05.2: Tokens, authorization headers, encrypted credential bytes, secure-store paths, and raw credential-bearing provider/HTTP errors SHALL be excluded or redacted before persistence, logging, IPC response/event delivery, activity display, diagnostics, or AI context creation.
- FR-05.3: The credential broker SHALL return only a request-scoped capability or equivalent controlled authorization input to the GitHub REST client and SHALL not expose a reusable plaintext token through a shared domain contract.
- FR-05.4: The application SHALL use a controlled child/request environment and SHALL not inherit unrelated environment secrets into connection-test or later GitHub infrastructure processes.
- FR-05.5: A connection test SHALL not follow a redirect to a different host, disable certificate validation, or silently downgrade transport security to make authentication succeed.
- FR-05.6: Security failures and redaction failures SHALL fail closed with bounded safe diagnostics and SHALL never be converted into a successful connection state.

### FR-06: Server settings and user-visible status

- FR-06.1: The settings surface SHALL allow a developer to add, rename, test, replace the credential for, retry, and remove a GitHub server profile without exposing stored token material.
- FR-06.2: Token entry SHALL use a masked credential control, SHALL not prefill a stored token, SHALL clear after submission, and SHALL never place the value in a URL, route, ordinary text field, read model, or conversation.
- FR-06.3: Each profile SHALL show a safe status such as unverified, testing, verified, needs attention, secure storage unavailable, or recovery required, with a plain-language reason and a concrete next action when it is not ready.
- FR-06.4: The settings UI SHALL preserve the main-process operation when the renderer closes and SHALL hydrate from the durable profile/operation read model when reopened.
- FR-06.5: The settings UI SHALL provide labels, keyboard focus order, accessible status/error announcements, and non-secret remediation text for success, failure, cancellation, and recovery states.

### FR-07: Provider-neutral downstream authentication contract

- FR-07.1: F05 SHALL expose a provider-neutral main-process contract that lets the later GitHub REST client resolve a verified server identity and make an authenticated request without importing secure-store details into the renderer or domain state.
- FR-07.2: The downstream contract SHALL distinguish missing, unverified, expired/rejected, unavailable, and verified credentials and SHALL return stable safe reasons for each condition.
- FR-07.3: The contract SHALL bind each request to the server profile, canonical API origin, active credential revision, and correlation identity so a token cannot be used for a different configured server.
- FR-07.4: No F05 contract SHALL grant publication authority, allow arbitrary URL requests, or permit an AI provider or renderer to choose a credential reference.

## Non-Functional Requirements

- **NFR-01: Security** - The feature SHALL use host-backed credential protection, fail closed when protection is unavailable, reject unsafe endpoint behavior, and keep raw credentials outside SQLite, renderer state, logs, AI context, and uncontrolled child environments.
- **NFR-02: Reliability and recovery** - Profile state, credential revisions, operation intent, test outcomes, and cleanup/recovery reasons SHALL survive renderer destruction and process restart without silently activating uncertain credentials.
- **NFR-03: Bounded operations** - Secure-store work, network tests, input size, response size, error text, and diagnostic retention SHALL have explicit bounded limits independent of renderer availability.
- **NFR-04: Compatibility** - The MVP SHALL support the pinned Windows Electron runtime and GHES REST `/api/v3` behavior through an adapter boundary that can later host macOS/Linux secure stores without changing the GitHub auth contract.
- **NFR-05: Usability and accessibility** - A developer SHALL be able to understand profile identity, authentication readiness, failure reason, and next action without seeing a token; the settings form SHALL be keyboard and assistive-technology usable.
- **NFR-06: Observability** - Every credential operation and connection test SHALL have a correlation identity, safe timestamps, lifecycle outcome, and machine-readable reason while retaining no raw secret-bearing diagnostics.
- **NFR-07: Determinism** - The same canonical profile, secure-store outcome, and HTTP response class SHALL resolve to the same safe state/reason regardless of renderer presence or UI navigation.
- **NFR-08: Testability** - The secure store, HTTP transport, clock, cancellation, and persistence boundary SHALL be injectable so conformance tests can prove secret absence without real GitHub credentials or network access.

## Invariants

- **INV-01:** Server parsing, credential storage, connection testing, redaction, retries, and status decisions SHALL be deterministic software; F05 SHALL not invoke an AI provider.
- **INV-02:** The Electron main process and its deterministic GitHub infrastructure SHALL own credential access, durable profile state, and connection-test work; the renderer SHALL remain a replaceable view/controller.
- **INV-03:** Operation intent and immutable endpoint/profile inputs SHALL be persisted before every secure-store or network side effect, and a commit acknowledgement SHALL be the only authority that a durable intent exists.
- **INV-04:** No raw token, authorization header, encrypted credential blob, or token-derived secret SHALL be stored in plaintext SQLite, renderer read models, generic IPC responses/events, prompts, structured AI output, logs, activity records, validation input, Git arguments, or URLs.
- **INV-05:** A credential SHALL not be active for downstream GitHub requests unless its exact server/profile identity and revision have a successful deterministic verification record.
- **INV-06:** Secure-store unavailability, invalid endpoint/security behavior, cancellation, timeout, interruption, uncertain outcome, and redaction failure SHALL fail closed and SHALL not be represented as verified access.
- **INV-07:** A connection test SHALL be read-only and SHALL never authorize or perform a commit, push, comment, approval, merge, conversation resolution, or GitHub settings change.
- **INV-08:** A request-scoped authentication capability SHALL be bound to one canonical server identity and credential revision; it SHALL not be serializable into renderer state or passed to an AI provider.
- **INV-09:** A failed or uncertain cleanup SHALL remain visible and retryable; the application SHALL not silently delete history, fall back to another server, or replace an active credential without the required verified transition.

## Out of Scope

- **GitHub App installation and OAuth device/browser flows** - The MVP uses developer-supplied personal access tokens; a future auth feature may add other methods behind the same boundary.
- **Git remote authentication** - F05 does not configure SSH keys, Git credential helpers, clone/fetch credentials, or credentials used by Git subprocesses. Later Git/worktree features must define their own safe boundary.
- **Publication and remote mutation** - Connection testing does not post comments, approve, merge, push, modify repository settings, or grant those permissions to AI.
- **Automatic token rotation or remote revocation** - The user can replace or remove local credentials; F05 does not revoke a token through GitHub or renew it automatically.
- **Organization/team/repository permission management** - The connection test verifies authenticated identity and safe server reachability; later features determine resource-specific authorization.
- **Arbitrary GitHub-compatible API hosts** - The MVP supports GitHub.com and standard GHES `/api/v3` roots; custom non-GitHub APIs, insecure HTTP, and TLS bypasses are not supported.
- **Multiple active accounts per server profile** - One active credential is supported per canonical server profile; account switching is a future enhancement.
- **Secret export, backup, sync, or cross-machine migration** - Credential material is host-bound and is not copied into PRMonitor backups, cloud storage, or exported settings.

## Product Decisions

- **PD-01: Personal access token is the MVP authentication method** - It keeps the initial configuration low-friction while leaving OAuth and GitHub App authentication for a future adapter.
- **PD-02: One active credential per canonical server profile** - This prevents ambiguous account selection in later deterministic REST calls; users who need another account may create a separately named profile only when the server identity policy permits it, otherwise account switching remains out of scope.
- **PD-03: A profile is usable only after a successful deterministic connection test** - Saving endpoint metadata alone must not make later workflows guess that authentication works.
- **PD-04: Standard HTTPS server origins and GHES `/api/v3` are the supported endpoints** - Endpoint derivation is predictable and prevents token leakage to an arbitrary API host.
- **PD-05: No plaintext fallback when host secure storage is unavailable** - A blocked configuration is safer and more actionable than silently weakening the trust boundary.
- **PD-06: Candidate-first credential replacement** - A new token must work before it can displace a previously verified token, protecting a working profile from a mistyped replacement.
- **PD-07: Connection testing is read-only** - The developer's explicit test action verifies identity without creating a hidden remote side effect or publication authorization.

## Implementation Decisions

- **IMP-01: Use a main-process `SecureCredentialStore` adapter backed by Electron `safeStorage` for the Windows MVP** - Electron delegates key protection to the host's Windows cryptographic protection while keeping token material outside SQLite; the adapter must refuse unavailable or weak backends and must expose no general renderer read method.
- **IMP-02: Use versioned opaque credential references** - Each candidate write receives a new reference/revision, allowing activation and cleanup to be reconciled after a process stop without overwriting the known active reference before verification.
- **IMP-03: Add F05-owned additive persistence records through the F03 migration/repository boundary** - Server metadata remains safe and queryable, while credential-operation intent, candidate/active revisions, test outcomes, and cleanup state are durable and versioned rather than hidden in free-form logs.
- **IMP-04: Keep the GitHub auth contract separate from the GitHub REST client** - F06 consumes a request-scoped deterministic credential capability; secure-store implementation, raw token handling, and host-specific APIs remain inside F05 infrastructure.
- **IMP-05: Use a dedicated secret-submission IPC route** - F04's generic serialized IPC contract remains secret-free; the one allowlisted credential operation has a strict size limit, no echo response, no event fan-out, and immediate renderer-input clearing.
- **IMP-06: Use injectable HTTP transport and secure-store fakes for default tests** - The test suite proves endpoint, redaction, lifecycle, and recovery behavior without real GitHub access, developer credentials, or environment-secret inspection.

## Testing Decisions

- **TST-01: Test the secure-store and transport ports deeply rather than a real account** - Synthetic token values and fake responses prove the contract while avoiding secret handling and network flakiness.
- **TST-02: Include a Windows safe-storage smoke test with synthetic data** - The release gate must demonstrate that the pinned Electron runtime can protect and recover a synthetic credential on a clean supported Windows host; the test output must not print the plaintext or ciphertext.
- **TST-03: Test renderer behavior at the boundary** - UI tests verify masking, clearing, focus, status announcements, and safe read-model contents; raw secure-store behavior remains covered by main-process contract tests.
- **TST-04: Do not test GitHub resource semantics here** - F06 owns repositories, pagination, rate-limit policy for general resource calls, and remote identity. F05 tests only the authentication/connection-test boundary required to establish a verified server profile.
- **TST-05: Use fault injection for every durable/external transition** - Tests cover before/after persistence commit, store write, candidate activation, cleanup, HTTP response, cancellation, renderer destruction, process restart, and uncertain outcome.

## Proposed Modules

- **MOD-01: Server Profile Contract** - Parses and canonicalizes GitHub.com/GHES identities, derives API roots, enforces uniqueness, and produces safe read models.
- **MOD-02: Secure Credential Store Adapter** - Owns host-backed credential availability, versioned opaque references, protected writes/reads/retirement, and bounded failures.
- **MOD-03: GitHub Credential Broker** - Exposes only request-scoped authentication to deterministic GitHub infrastructure and binds access to a verified profile/revision.
- **MOD-04: Credential Operation Coordinator** - Persists intent, coordinates candidate write/test/activation/cleanup, applies idempotency, and reconciles interrupted operations.
- **MOD-05: Connection Test Service** - Performs the read-only authenticated identity check through a strict HTTP transport and returns normalized safe outcomes.
- **MOD-06: Secret-Safe Diagnostics** - Redacts bounded error, header, response, and activity data before persistence, IPC, display, or AI preparation.
- **MOD-07: GitHub Server Settings Read Model and IPC** - Exposes server profiles, statuses, actions, and one-time credential submission without returning secret material.

## Workflows

### Workflow 1: Add and verify a GHES server

```text
1. The developer opens GitHub server settings and enters an HTTPS GHES origin and display name.
2. The main process canonicalizes the origin, derives the /api/v3 base, and rejects unsafe or duplicate identity input.
3. The developer enters a token in the masked control and chooses Save and Test.
4. The main process clears the renderer control and persists a server/auth operation intent plus endpoint/profile snapshot.
5. The secure credential store writes the token to a new opaque candidate reference.
6. The deterministic connection tester makes a read-only authenticated identity request to the configured GHES API.
7. A validated successful response activates the candidate and records safe account metadata; an error leaves it inactive and shows the next action.
8. The settings read model shows the server, verified/unverified status, and safe verification details without returning the token.
```

### Workflow 2: Replace a working token safely

```text
1. The developer chooses Replace Token for a verified profile.
2. PRMonitor persists a new idempotent candidate operation before writing the replacement.
3. The candidate is stored and tested against the same canonical server identity.
4. Until the test succeeds, the previously active credential remains the one used by downstream GitHub infrastructure.
5. On success, PRMonitor activates the new reference, records the new revision, and schedules retirement of the old reference.
6. On failure, cancellation, restart, or uncertain cleanup, the old credential remains active and the operation remains visible for explicit retry or cleanup.
```

### Workflow 3: Restart or recover an interrupted operation

```text
1. The main process starts and reads incomplete credential operations from SQLite.
2. It marks an incomplete secure-store write/test/activation as incomplete or recovery-required rather than verified.
3. It preserves the prior active credential when the durable profile still points to one.
4. The developer sees the candidate operation and chooses Retry or Clean Up.
5. Retry reuses the operation identity where safe or creates an explicitly superseding operation; it does not duplicate active credentials or silently activate an untested candidate.
```

### Workflow 4: Safe connection failure

```text
1. The developer chooses Test Connection for a profile or candidate.
2. The main process persists the test intent and uses only the configured canonical endpoint.
3. The transport rejects insecure transport, cross-origin redirects, certificate failures, or malformed server identity.
4. HTTP/auth/network outcomes become bounded safe reason data.
5. The UI keeps the profile unverified or marks it as needing attention and offers a concrete remediation without displaying the token or raw response.
```
