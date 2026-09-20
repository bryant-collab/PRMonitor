---
name: feature-orchestration
description: Orchestrate the implementation of a feature by decomposing it into delegated work, routing it to cost-appropriate specialist subagents, reconciling results, and independently verifying the outcome. Use when the user explicitly asks to orchestrate or coordinate feature implementation; do not use for an ordinary implementation request or for planning without implementation.
metadata:
  short-description: Orchestrate delegated feature implementation
---

# Feature Orchestration

Own the coordination of feature implementation while specialized subagents own the implementation and verification work.

## Orchestrator boundary

Restrict yourself to these responsibilities:

- understand the goal;
- plan the work;
- decompose it into bounded subtasks;
- route each subtask to the appropriate specialist;
- resolve conflicts between requirements, agents, changes, and evidence; and
- synthesize the verified result and the final answer.

You may inspect the repository, requirements, diffs, and evidence to perform those responsibilities. Do not implement code, edit implementation files, take over a failed worker's task, or act as the verifier. Route implementation, repairs, and testing to subagents. If subagents are unavailable, report that orchestration cannot proceed rather than silently becoming the implementer.

You alone own the final answer to the user. Workers report to you; they do not independently declare the overall feature complete.

## Specialist roster

| Role | Model and effort | Route here when |
| --- | --- | --- |
| Bulk worker | `gpt-5.6-luna`, `xhigh` | The coding task is well scoped and its approach and success criteria are clear. |
| Bulk hard worker | `gpt-5.6-luna`, `max` | The coding task is hard but still well defined, or a bulk worker could not complete it reliably. |
| Hard specialist | `gpt-5.6-sol`, `medium` | The task requires difficult coding, reasoning, or analysis that a bulk hard worker could not complete reliably. |
| Verifier | `gpt-5.6-luna`, `max` | Assumptions, implementation results, tests, and consequential evidence need an independent challenge. |

Use the lowest-cost role likely to complete a subtask correctly. Do not force every task through every tier: route directly to the bulk hard worker when the work clearly exceeds the bulk worker, and use the hard specialist when the task is clearly exceptional or prior evidence warrants escalation.

Escalate when a worker fails, reports low confidence, encounters conflicting evidence, or faces a consequential decision that is difficult to reverse. Preserve useful artifacts and failure evidence, but give the escalated agent only the context needed to retry the task.

## Orchestration workflow

1. **Understand the goal.** Read the user's request, applicable repository instructions and skills, relevant requirements, current code, and worktree state. Identify acceptance criteria, constraints, dependencies, authorization boundaries, and unknowns. Ask the user only when a missing choice would materially change the outcome.

2. **Plan and decompose.** Build the smallest set of independently ownable subtasks that covers implementation, integration, and required tests. Make dependencies explicit. Prefer vertical or interface-aligned slices with disjoint file ownership; do not split work so finely that coordination costs dominate.

3. **Route work.** Select each worker using the roster and cost rule. Run independent subtasks in parallel when capacity permits. Sequence dependent work and any tasks likely to edit the same files. Tell agents that they share a worktree and must preserve unrelated changes.

4. **Reconcile.** Review worker reports and diffs against the goal. Detect overlapping edits, incompatible contracts, divergent assumptions, incomplete integration, and unsupported claims. Resolve the intended direction yourself, then delegate any code changes or additional investigation needed to enact that resolution. Never ask agents to overwrite one another's work blindly.

5. **Verify independently.** After integration is complete, spawn a verifier with fresh context (`fork_turns: "none"`). Give it the goal, acceptance criteria, relevant repository state, and exact verification scope, but not the implementers' reasoning or conclusions. The verifier must inspect the actual diff and evidence, challenge assumptions, and run appropriate tests. It reports findings and does not fix them. Route fixes back to an implementation role, then obtain fresh verification for consequential changes.

6. **Synthesize.** Reconcile all reports with repository evidence. Declare completion only when acceptance criteria and consequential claims are verified. In the final answer, summarize the implemented outcome, material design decisions, tests and verification evidence, changed areas, and any residual risks or incomplete work.

## Worker assignment contract

Every worker prompt must contain:

1. **Specific objective:** one concrete outcome the worker owns.
2. **Relevant context only:** requirements, paths, interfaces, and prior evidence needed for that outcome.
3. **Explicit boundaries:** what it may change, what it must preserve, and what is out of scope.
4. **Expected output:** changed files or analysis deliverable plus a concise report of decisions, tests, and uncertainties.
5. **Success criteria:** observable conditions and commands or evidence that establish completion.

Also state dependencies and file ownership when relevant. Require workers to report blockers, conflicting evidence, failed checks, and confidence honestly rather than expanding scope or claiming completion.

## Conflict and completion rules

- Requirements and user intent outrank worker preferences. Repository evidence outranks unsupported agent claims.
- Assign only one active owner to overlapping implementation surfaces. Parallel work should have disjoint scopes or a stable interface agreed in advance.
- Resolve a disagreement by identifying the disputed assumption and routing a focused investigation when the evidence is insufficient.
- Treat low-confidence results and untested integration as incomplete.
- Do not expose internal worker chatter in the final answer. Present one coherent, evidence-backed result.
