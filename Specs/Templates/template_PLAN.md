<!--
Terminology: a vertical slice, or tracer bullet, is a unit of work that extends through all levels: database, logic, UI (as applicable). This is as opposed to a horizontal layer, which addresses only a single layer. The goal of vertical layers is to provide the AI and the user with a visible and testable result when the work is complete. This improves the reliability of AI's output by providing rapid feedback.
Note that while we're mentioning Stories here, we're not actually using tickets, this is just a convenient way of identifying slices within a plan.
There might be slices that are needed to describe work that doesn't extend through all levels, that's fine, but the preference should be towards vertical slices since this will result in the best quality output.
-->

# Plan: <name>

> **Document status:** Architecture-stage draft | Active implementation PLAN
>
> **Owning PRD:** `<featureSlug>_PRD.md`
>
> **Last revalidated against:** application/PRD revision `<revision or date>`
>
> **Entry/readiness gates:** <capabilities and upstream evidence required>
>
> This PLAN cannot change product requirements. Resolve contradictions in the
> owning PRD before implementation. Revalidate this draft when implementation
> begins and remove or archive it when the work is complete.

## Proposed Vertical Slices
<numbered list of vertical slices (tracer bullets)>
<!-- Example
1. Award points for lesson completion, visible on dashboard
 - Blocked by: None
 - Stories / requirements / acceptance criteria: US-01; FR-01.1; AC-01
 - Visible result: Dashboard shows points, level, and progress after completion.
 - Durable records / external effects: Adds points event and migration; no external effect.
 - Failure / cancellation / restart: Duplicate delivery and restart preserve one award.
 - Exact evidence: Unit calculation table; migration fixture; crash-after-commit integration test; keyboard/screen-reader check.
 - Exit criterion: AC-01 passes with the recorded evidence.
2. Award points for quiz completion
 - Blocked by: #1
 - Stories / requirements / acceptance criteria: US-02; FR-02.1; AC-02
 - Visible result: Quiz result displays exactly one earned award.
 - Durable records / external effects: Reuses the points event; no external effect.
 - Failure / cancellation / restart: Retry is idempotent; cancellation before commit awards nothing.
 - Exact evidence: Pass/ace/fail table and fault test at the transaction boundary.
 - Exit criterion: AC-02 passes and no duplicate event is possible.
 -->
