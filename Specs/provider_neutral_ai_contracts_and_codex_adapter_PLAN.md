<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this feature is a provider-contract and adapter boundary.
-->

# Plan: F15 Provider-neutral AI Contracts and Codex Adapter

> **Document status:** Implemented provider-neutral contracts, fake provider, and Codex adapter | Approved ownership split
>
> **Owning PRD:** `Specs/provider_neutral_ai_contracts_and_codex_adapter_PRD.md`
>
> **Last revalidated against:** `Specs/application_overview.md` revision 2026-09-23 and F15 PRD revision 2026-09-23
>
> **Entry/readiness gates:** F01-F03, F13, and F14 provide the implemented foundations and their F15 handoff conformance is now covered by the adapter boundary, typed repositories, worktree fixture, and bounded validation-context fixture. Their root typecheck, lint, format, test, persistence, worktree, and validation gates remain green. The test harness injects clocks, abort signals, Codex client/thread factories, JSONL events, controlled environments, provider failures, and no-network/no-credential execution.
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation and rerun both specification linters. F15's
> checklist item is checked only after the implementation and verification gates
> below pass; implementation and approval remain separate.

## Implementation Boundary

F15 adds the provider-neutral AI contract and the single MVP provider adapter.
The shared contract is proposed under `apps/desktop/src/shared/ai`; registry,
runtime seams, and adapters are proposed under `apps/desktop/src/main/ai`.
The shared side contains only serializable Zod schemas, TypeScript types,
schema-generation helpers, exact input-accounting validators, normalized event
types, usage/reference types, and safe error/result types. The main-process side
resolves a registered provider, validates capabilities, invokes the provider,
maps provider events/results/errors, and returns a serializable handoff.

The Codex SDK is imported only by `src/main/ai/codex-adapter.ts` (or a single
equivalent adapter module). No domain, persistence, worktree, validation,
review, synchronization, renderer, preload, or UI module may import
`@openai/codex-sdk`. The adapter uses the already pinned
`@openai/codex-sdk@0.155.1`; it does not expose SDK `Codex`, `Thread`, event,
or option objects to callers.

F16 remains authoritative for Preferences, task-profile resolution, Common
Instructions, Build & Validation Instructions, and named execution-policy
selection. F17 remains authoritative for AI Work Operation/segment lifecycle,
budgets, turn timeouts, deterministic progress, and explicit continuation. F03
remains authoritative for durable records and transactions. F13/F14 remain
authoritative for actual worktree and validation evidence. F15 consumes those
immutable inputs and returns provider-neutral evidence; it does not create a
competing state machine or persistence path.

## Contract Shape and Translation Rules

- `AIProviderRequest` contains a schema version, request/operation/turn identity,
  supported task type, interaction mode, immutable profile snapshot, immutable
  execution-policy snapshot, validated F13 worktree reference when code access
  is allowed, immutable input/context references, expected output-contract ID
  and version, and bounded invocation metadata.
- `AIProviderCapabilities` advertises supported task types, structured-output
  dialects, streaming, conversation continuation, reasoning values, sandbox and
  approval modes, network modes, and controlled-environment support.
- `AIProvider` exposes capability inspection and one invocation operation that
  accepts a request plus an abort signal/event sink. It has no Git, GitHub,
  commit, push, response, merge, or publication method.
- `AIProviderTurnResult` contains normalized terminal status, structured result,
  ordered safe events, provider/model/task/profile/policy metadata, optional
  usage, optional opaque conversation reference, and a safe normalized error.
- Review Proposal output is schema-checked against the exact input
  `remoteEventVersionId` set. Review Implementation and conflict-resolution
  outputs contain model-reported outcome data only; deterministic diff,
  validation, and progress fields are attached by F13/F14/F17.
- The direct Codex translation uses `workingDirectory`, `model`,
  `modelReasoningEffort`, `sandboxMode`, `networkAccessEnabled`,
  `approvalPolicy`, and `outputSchema`. It does not use `additionalDirectories`
  and does not set `skipGitRepoCheck` to bypass repository validation.
- Read-only Review Proposal maps to `read-only` sandbox, no approval prompts,
  and the resolved network setting. Autonomous Worktree maps to
  `workspace-write` limited to the operation worktree, no approval prompts,
  and only explicitly enabled network. A policy requiring an interactive host
  approval callback is rejected because the direct adapter cannot provide that
  callback channel.
- Codex receives an explicit controlled environment. Provider authentication is
  supplied through an adapter-owned runtime seam; `process.env` is never copied
  wholesale, and GitHub publication credentials never enter the child
  environment.

## Readiness Gates

- F01's exact runtime/dependency boundary is green, including the pinned
  `@openai/codex-sdk@0.155.1` package and the existing provider-import guard.
- F02's provider-neutral IDs, safe reasons, proposal-before-mutation guard, and
  serialization rules are available to the F15 schemas without importing a
  provider SDK.
- F03 exposes commit-before-effect and restart-safe AI operation/turn/profile/
  policy/usage/conversation records; F15 can return a complete serializable
  handoff without writing SQLite itself.
- F13 can provide a canonical, operation-owned worktree reference and current
  revision evidence; F14 can provide bounded validation evidence. The adapter
  never discovers or repairs either boundary.
- F16/F17 test doubles can provide immutable profile/policy snapshots, declared
  task types, cancellation/timeouts, and explicit continuation authorization.
- The Codex package's pinned `Codex`, `Thread`, `ThreadEvent`, `Usage`, and
  structured-output APIs are available on the supported Node/Electron runtime.
- The test harness can run a fake Codex JSONL transport and inspect child
  options/environment without network access, credentials, or developer
  worktree mutation.

## Proposed Vertical Slices

1. **Define versioned provider-neutral schemas and structured-output validation.**
   - **Blocked by:** F01 shared TypeScript boundary, F02 serializable domain primitives, and the existing Zod/schema tooling.
   - **Stories / requirements / acceptance criteria:** US-01-US-04, FR-01.1-FR-01.8, FR-04.1-FR-04.8, FR-05.4-FR-05.6, NFR-01-NFR-03, NFR-05, NFR-08, INV-01, INV-04, INV-06, INV-09-INV-10; AC-01-AC-03, AC-07-AC-11, AC-18; CT-F15-01, CT-F15-02, CT-F15-06.
   - **Visible result:** A renderer-safe shared module exports versioned Zod schemas/types for requests, task/profile/policy/worktree/input references, capabilities, output contracts, Review Proposal/Implementation/Conversation/Conflict results, normalized events, usage, conversation references, terminal results, and errors. `AIReadOnlyConversationResult` has a bounded answer, optional bounded explanation/next-step data, and an explicit `read_only` marker; a fixture rejects file-change instructions in that result. The input-reference fixture includes immutable review-event IDs, PR/repository/ref/SHA snapshots, Common Instructions and Build & Validation snapshots, final human decisions, and prior safe validation evidence. A fixture can generate the same JSON Schema bytes twice and parse valid/invalid structured outputs.
   - **Durable records / external effects:** Adds shared contract source, schema fixtures, and bounded test reports. No provider process, SQLite write, Git operation, network call, credential access, or renderer behavior occurs.
   - **Failure / cancellation / restart:** Unsupported schema versions, unknown fields, oversized strings/arrays, malformed IDs, provider objects, secrets, duplicate/missing/out-of-scope event versions, and prose-only output fail closed. A cancelled test leaves no success marker and reruns from fresh fixtures.
   - **Exact evidence:** Zod round-trip table; deterministic JSON Schema byte/hash comparison; schema-version and exact-key rejection; size-limit corpus; immutable context/input snapshot fixture covering event IDs, PR/ref/SHA, Common Instructions, Build & Validation, human decisions, and validation evidence; Review Proposal event-accounting matrix; result/error secret and SDK-instance scan; shared import-boundary check; `git diff --check`.
   - **Exit criterion:** AC-01-AC-03, AC-07-AC-11, and AC-18 pass, and the shared package can be imported by main and renderer-safe consumers without importing Codex, Node privileged APIs, or persistence.

2. **Add registry, capabilities, request admission, and the fake provider.**
   - **Blocked by:** Slice 1, F02 safe result/reason contracts, F13 worktree-reference shape, and F16/F17 request/profile/policy test doubles.
   - **Stories / requirements / acceptance criteria:** US-01-US-02, US-07; FR-02.1-FR-02.7, FR-03.1-FR-03.8, FR-08.1-FR-08.7, NFR-01, NFR-03-NFR-06, INV-01-INV-08; AC-01-AC-03, AC-05-AC-06, AC-11, AC-13, AC-16-AC-18; CT-F15-02, CT-F15-03, CT-F15-05, CT-F15-08.
   - **Visible result:** A caller can register one fake provider, resolve it by ID, validate a request, receive scripted normalized events/results, and observe deterministic refusal before provider start for unsupported task, policy, reasoning, conversation, worktree, or output capabilities.
   - **Durable records / external effects:** Produces provider registry/capability fixtures and fake turn evidence only. No real AI process, database write, GitHub effect, worktree mutation, validation command, or publication occurs.
   - **Failure / cancellation / restart:** Unknown/duplicate/disabled providers and incompatible requests return safe errors without starting a provider. Replaying a completed fake request returns the owning-workflow handoff contract; the registry itself does not create a second operation or reset a budget. Abort and timeout produce one terminal result.
   - **Exact evidence:** Capability truth table; provider-start spy proving preflight rejection; fake success/stream/error/cancel/timeout fixtures; no-publication-method type test; controlled path/environment validation; duplicate/replay identity test; thin F17/F18/F26 consumer compile test; CT-F15-02, CT-F15-03, CT-F15-05, CT-F15-07, and CT-F15-08.
   - **Exit criterion:** AC-01-AC-03, AC-05-AC-06, AC-11, AC-13-AC-16, and AC-17 pass for the fake provider, with no provider-specific code visible to shared consumers.

3. **Implement Codex read-only Review Proposal invocation.**
   - **Blocked by:** Slice 2, the pinned `@openai/codex-sdk@0.155.1`, F13 validated worktree references, F14 bounded validation evidence, and the Codex client/thread fixture seam.
   - **Stories / requirements / acceptance criteria:** US-03, US-05-US-07; FR-03.1-FR-03.6, FR-05.1-FR-05.7, FR-06.1-FR-06.8, FR-08.1-FR-08.7, NFR-02-NFR-07, INV-02-INV-05, INV-08-INV-10; AC-04-AC-05, AC-07-AC-12, AC-16-AC-18; CT-F15-04-CT-F15-06, CT-F15-08.
   - **Visible result:** The Codex adapter accepts an Automatic Review / Re-evaluation proposal request, creates a Codex thread at the exact operation worktree, passes the generated structured schema, maps fixture JSONL lifecycle events, and returns a validated one-item-per-event Review Proposal with provider-neutral metadata.
   - **Durable records / external effects:** Production execution may launch one Codex child process only after F17/F03 have persisted the operation/turn intent. F15 itself writes no database row; tests use an injected fixture transport and retain only bounded reports. No GitHub or publication effect is available.
   - **Failure / cancellation / restart:** Read-only policy translation rejects write/interactive broadening. Missing or invalid structured output, SDK start failure, malformed JSONL, secret-bearing event, cancellation, timeout, and provider failure return non-success without a prose fallback. Renderer closure does not cancel the main-process request; restart does not auto-resume it.
   - **Exact evidence:** Static import exception proves only the Codex adapter imports the SDK; mocked `Codex`/`Thread` arguments prove working directory, model, reasoning, sandbox, approval, network, output schema, and no extra directories; read-only no-mutation contract; immutable context snapshot fixture; event-order/thread-ID fixture; invalid-output/event-accounting matrix; controlled-env and no-GitHub-credential scan; bounded relative-path/command-detail redaction fixture; explicit usage-counter fixture covering input, cached input, cache-write input, output, reasoning output, total, and unavailable fields; CT-F15-04-CT-F15-06 and CT-F15-08.
   - **Exit criterion:** AC-04-AC-05, AC-07-AC-12, AC-16-AC-18 pass, and F18 can invoke a read-only proposal without importing Codex or interpreting provider prose.

4. **Implement Codex worktree-mutating Review Implementation and conflict-resolution contracts.**
   - **Blocked by:** Slice 3, F13 operation-owned write boundary, F16 policy snapshots, F17 bounded-turn authorization, and F26 structured conflict-result expectations.
   - **Stories / requirements / acceptance criteria:** US-04-US-06; FR-03.1-FR-03.8, FR-04.3-FR-04.5, FR-05.1-FR-05.7, FR-06.1-FR-06.8, NFR-03-NFR-07, INV-02-INV-05, INV-08-INV-10; AC-06-AC-07, AC-09-AC-14, AC-16-AC-18; CT-F15-04-CT-F15-06, CT-F15-08.
   - **Visible result:** An explicitly authorized Review Revision or Merge Conflict Resolution request runs in a separate F13-owned worktree under the snapshotted policy, returns a structured implementation outcome or a conflict result with `resolved`, `ambiguous`, or `blocked` status, remaining issues, and competing-intent/user-question data when needed, and preserves a clear separation between model-reported approach/problems and later deterministic Git/validation/progress evidence.
   - **Durable records / external effects:** A production turn may modify only the operation-owned local worktree through Codex. F17/F03 own the turn report, budget, and durable operation records; F13 owns before/after snapshots; F14 owns validation. No adapter method can commit, push, post, merge-publish, or resolve a GitHub conversation.
   - **Failure / cancellation / restart:** A policy mismatch, path escape, unsupported interactive approval, extra-directory request, provider failure, timeout, cancellation, or malformed implementation/conflict result preserves the operation evidence and returns a safe stop. The adapter never retries or resumes automatically and never resets the worktree.
   - **Exact evidence:** Autonomous Worktree and network-enabled policy matrix; full-access/non-default and interactive-policy rejection fixtures; operation-worktree-only path test; no-publication API/type test; structured implementation fixture; structured conflict fixture covering resolved, ambiguous, blocked, remaining-issue, competing-intent, and user-question fields; abort/timeout terminal-event test; actual F13/F14 handoff spy; provider-output-vs-deterministic-evidence separation report; CT-F15-04-CT-F15-08.
   - **Exit criterion:** AC-06-AC-07, AC-09-AC-14, and AC-16-AC-18 pass, and F17/F26 can use Codex for local semantic work without gaining publication authority or changing deterministic evidence.

5. **Complete metadata, conversation continuation, errors, and restart-safe handoff.**
   - **Blocked by:** Slices 1-4, F03 AI repositories/codecs, F17 operation/segment contracts, and F04 main-process lifecycle behavior.
   - **Stories / requirements / acceptance criteria:** US-06-US-08; FR-05.1-FR-07.5, FR-08.1-FR-08.7, NFR-02-NFR-08, INV-01, INV-05-INV-10; AC-09-AC-11, AC-14-AC-18; CT-F15-06-CT-F15-08.
   - **Visible result:** A consumer fixture can persist/read an F15 turn handoff containing provider/model/task/profile/policy metadata, usage, an opaque conversation reference, structured result, ordered events, terminal error/reason, and schema version after simulated renderer closure/restart. The read-only conversation result round-trips its bounded answer/explanation/next-step fields and `read_only` marker without becoming a file-change request. Usage covers input, cached input, cache-write input, output, reasoning output, total, and explicitly unavailable counters. An explicitly authorized matching read-only conversation continuation resumes through the adapter; mismatch and unsupported resume fail safely.
   - **Durable records / external effects:** F03 repositories receive serializable provider-neutral values only. Codex thread objects, raw SDK errors, prompts, provider credentials, and environment values are never written. No automatic continuation or external publication is triggered by a readback.
   - **Failure / cancellation / restart:** The same completed request identity is not relaunched by F15. A lost/unknown provider outcome remains a caller-owned reconciliation/attention result; F15 cannot infer success or repeat the turn. Usage fields remain optional and opaque when the provider omits them.
   - **Exact evidence:** F03 codec/row round-trip; metadata mismatch test; opaque-reference/provider-match matrix; explicit read-only conversation resume fixture; renderer-close/restart/no-auto-resume test; duplicate-completed-turn test; error redaction and bounded-output scan; normalized relative-path/command-detail fixture; complete usage-counter/unavailable-field fixture; no-secret persistence fixture; CT-F15-06 and CT-F15-07.
   - **Exit criterion:** AC-10-AC-11, AC-14-AC-15, and AC-18 pass, and F03/F17 can persist and reconcile F15 output without SDK or prompt dependencies.

6. **Cross-provider conformance, downstream handoff, and release gate.**
   - **Blocked by:** Slices 1-5, final F03/F13/F14 contracts, F16/F17 test doubles, and all readiness gates.
   - **Stories / requirements / acceptance criteria:** US-01-US-08; all FRs, NFRs, and INVs; APP-AC-11, APP-AC-12, APP-AC-60-APP-AC-64, APP-AC-70; AC-01-AC-18; CT-F15-01-CT-F15-08.
   - **Visible result:** One machine-readable conformance report runs the same request, capability, schema, event, cancellation, policy, credential, metadata, and restart cases through the fake provider and Codex fixture adapter. Thin review, bounded-work, conflict, persistence, worktree, and validation consumers use only normalized contracts.
   - **Durable records / external effects:** `npm run check` produces bounded test/build evidence only. The report uses temporary fixtures and test-owned paths; it does not use real provider/GitHub credentials, edit `checklist.md`, publish code, or call a live provider.
   - **Failure / cancellation / restart:** Any SDK import outside the adapter, schema mismatch, missing event, secret leak, policy broadening, false validation/progress claim, arbitrary path, duplicate turn, definite linter miss, or invalid application-coverage mapping blocks the gate. A cancelled run leaves no success marker and can be rerun from fresh fixtures.
   - **Exact evidence:** `npm run check`; desktop dependency/import-boundary report; Zod/JSON-Schema report; fake/Codex fixture equivalence; capability/policy matrix; exact worktree/environment/credential evidence; structured-output/event-accounting report; cancellation/timeout/restart report; F03/F17/F18/F26 thin-consumer compile/tests; `git diff --check`; `npm run lint:prd-plan -- Specs/provider_neutral_ai_contracts_and_codex_adapter_PRD.md Specs/provider_neutral_ai_contracts_and_codex_adapter_PLAN.md`; `npm run lint:application-coverage -- Specs/application_overview.md Specs/provider_neutral_ai_contracts_and_codex_adapter_PRD.md`.
   - **Exit criterion:** All F15 requirements have direct acceptance or named contract-test evidence, all mapped application criteria have no definite missing/invalid result, both specification linters have been run against the final documents, and F15 is checked only after implementation approval and completion.

## Cross-Slice Verification and Handoff

- The exact owning PRD is `Specs/provider_neutral_ai_contracts_and_codex_adapter_PRD.md`; this PLAN does not add Preferences UI, AI Work Controller policy, persistence migrations, validation execution, worktree creation, review-bundle orchestration, synchronization workflow, or publication requirements.
- The only production SDK import is the Codex adapter. Static import tests and ESLint configuration must fail closed if `@openai/codex-sdk` appears elsewhere, including shared, renderer, preload, persistence, GitHub, validation, review, and publication modules.
- F16 must resolve and snapshot task profiles, provider/model/reasoning settings, Common Instructions, Build & Validation Instructions, and AI Execution Policy before F15 is called. F15 validates capability compatibility and uses the snapshot; it must not read settings or broaden policy.
- F17 must ask F03 to persist the operation/segment intent before invoking F15, supply bounded timeout/cancellation, consume F15 events/results, inspect deterministic F13/F14 evidence, and own continuation/budget/progress decisions. F15 never retries or concludes application success from provider prose.
- F03 must persist only the serializable F15 handoff: provider/model/task/profile revision, policy snapshot/reference, opaque conversation reference, usage, structured result, normalized events, terminal status, and safe error. SDK objects, raw prompts, credentials, and uncontrolled environment values are forbidden.
- F13 remains authoritative for exact path ownership and actual Git state. A provider-reported file change or command result is not F13/F14 evidence. F14 remains authoritative for validation pass/fail.
- F18/F21/F26 choose the task-specific context and consume the appropriate structured result. They must not parse `finalResponse` prose to determine state and must preserve exact input-event accounting for Review Proposal.
- The Codex adapter may use the SDK's persisted thread reference only when an owning workflow explicitly authorizes continuation and the provider/task/policy compatibility checks pass. A thread ID is not a Review Bundle ID, operation ID, or source of truth.
- The direct adapter does not expose an interactive approval callback. If a future adapter supports that capability, it must advertise it through the same capability contract and preserve the same no-publication boundary.
- F15's real provider path is a local child-process effect, not an application publication effect. All production calls must be made only after the owning durable workflow has recorded intent; tests use injected SDK/JSONL fixtures and remain credential-free.
- The F15 checklist item is checked after the shared schemas, registry/fake-provider conformance, Codex fixture adapter, controlled-environment boundary, and F03/F13/F14 handoff tests pass. This feature still does not claim downstream workflow/UI, validation execution, budget, Git, or publication ownership.

## Requirement-to-Slice Trace

| Requirement family | Owning slices |
|---|---|
| FR-01 | 1, 2, 6 |
| FR-02 | 2, 6 |
| FR-03 | 2-5, 6 |
| FR-04 | 1, 4, 6 |
| FR-05 | 3-5, 6 |
| FR-06 | 3-4, 6 |
| FR-07 | 5-6 |
| FR-08 | 2-6 |
| NFR-01-NFR-08 | 1-6 |
| INV-01-INV-10 | 1-6 |
| APP-AC-11 | 3-4, 6 |
| APP-AC-12 | 1, 3-4, 6 |
| APP-AC-60-APP-AC-64 | 2-6 |
| APP-AC-70 | 2-6 |


## Issue 1 supplement: Local provider configuration preflight

Approved scope: [resumable setup on startup](https://github.com/bryant-collab/PRMonitor/issues/1). Expose only runtime/authentication presence through a provider-neutral local readiness port. The Codex adapter uses the same approved authentication environment as invocation; it does not start a client turn, log credentials, probe remote quota, initiate login, or grant controlled-environment bypass. Display locally configured access with the qualification that service access is checked when work starts. Missing providers and confirmed missing authentication are incomplete.

Evidence: the setup readiness/local/provider/IPC/renderer/recovery tests, repository `npm run check`, and six-process production Electron `npm run test:setup`. See `docs/evidence/setup-readiness/README.md` for scenario mapping, retained screenshots, and exact residual manual coverage. Existing F03/F05/F13/F19/F29 owners keep their persistence, credential, filesystem, lifecycle and security rules.
