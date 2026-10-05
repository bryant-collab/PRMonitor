# Controlled discard and re-evaluation acceptance

The required `conditional-f22` Windows journey uses a marked Temp profile and
an actual owned Git worktree. It evaluates F11 eligibility and claims the real
durable hold through production APIs. The only F22 effect substitution is a
deterministic remote-head read scoped to the exact fixture PR. All F22/F11/F13
guards, renderer/preload/IPC and persistence remain real.

The native case exposed a production SQLite boundary defect: the generated
remote observation reference was named `observationToken` inside a persisted
re-evaluation preview, so the existing credential-shaped-key guard rejected it.
F22 now projects only a validated `f22-observation-` plus 32 hex characters to
`observationRef` for storage and restores the exact public field on read. No
codec allowlist or secret policy changes. A real SQLite regression checks
preview update, reopen, exact-reference preservation, malformed-reference
refusal and continued codec rejection of token/credential fields.

The first historical gate is refused as `STALE_GATE_REVISION`; no pending action
or worktree change results. A fresh explicit click opens the actual discard
preview. It checks focused choices, disabled confirmation before selection and
acknowledgement, and enabled confirmation after acknowledgement. Close preview
and explicit Keep Worktree and Cancel both clear their own pending intent,
retain the active hold and preserve source bytes.

The remote-read port then reports a moved head through actual observation.
The stale bundle exposes Re-evaluate at current head after explicit evidence
refresh; its preview still requires a choice
and acknowledgement. Closing it preserves the old worktree and hold. No
destructive choice is confirmed, no provider runs, and no Git commit/push or
external publication is authorized. These observations establish preview and
cancellation reachability, not successful replacement, clearing or publication.
