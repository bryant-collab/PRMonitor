# <FeatureName> - Product Requirements Document

<!-- This file answers the what and why of the product/feature. It is from the
customer's PoV and should not contain architecture or technical information
beyond user-level things like OS / memory requirements / etc. Keep this comment
when using this template -->

## Feature Dependencies

<!-- Upstream: features this feature depends on (must be built / operational before this feature can work).
     Downstream: features that depend on this feature (will be affected if requirements here change).
     Keep this section updated as the design evolves. -->

### Upstream Dependencies

<!-- example
| # | Feature | Relationship |
|---|---|---|
| 1 | `<FeatureName>` | This feature requires X from `<FeatureName>` |
-->

### Downstream Dependencies

<!-- example
| # | Feature | Relationship |
|---|---|---|
| 1 | `<FeatureName>` | `<FeatureName>` consumes X produced by this feature |
-->

## Application Requirements Covered

<!-- Map only applicable portfolio requirements and global invariants. Every
feature FR must map to an observable AC or a named contract-test criterion.

| Application ID | Feature requirements | Acceptance criteria | Ownership |
| --- | --- | --- | --- |
| APP-XX.Y / INV-XX | FR-XX.Y | AC-XX | Primary / shared |
-->

## Executive Summary

<!-- Describe the problem and approach. Explain user pain, solution, and target user. -->

## User Stories

<!-- Group by functional area. Use: GIVEN/WHEN/THEN and observable outcomes. -->

### <Area 1>

<!-- Example:
- **GIVEN** <precondition>, **WHEN** <action>, **THEN** <outcome>.
 - **Acceptance Criteria: <criteria>**
 -->

### <Area 2>

<!-- Example:
- **GIVEN** <precondition>, **WHEN** <action>, **THEN** <outcome>.
 - **Acceptance Criteria: <criteria>**
 -->

## Observable Acceptance Criteria

<!-- Number as AC-XX and use GIVEN/WHEN/THEN. Include failure, cancellation,
restart, idempotency, security, accessibility, and platform distinctions in the
owning feature where applicable. Example:

- **AC-01:** **GIVEN** ..., **WHEN** ..., **THEN** ... .
-->

## Functional Requirements

<!-- Number as FR-XX.Y. Use SHALL. Keep groups in numeric order. Example:
### FR-01: <Requirement Group>
- FR-01.1: The application SHALL ...
- FR-01.2: The application SHALL ...

### FR-02: <Requirement Group>
- FR-02.1: The application SHALL ...

### FR-03: External Dependency Failure Handling
- FR-03.1: On dependency failure, the application SHALL present actionable remediation options.
- FR-03.2: Fallback behavior SHALL be explicit and logged to `AssumptionsLogPath`.
-->

## Non-Functional Requirements

<!-- Number as NFR-XX. Example:
- **NFR-01: Performance** - ...
- **NFR-02: Reliability** - ...
-->

## Invariants

<!-- Number as INV-XX. Example:
- **INV-01:** ...
- **INV-02:** ...
-->

## Out of Scope

<!-- Example:
- **<Topic>** - ...
-->

## Product Decisions

<!-- Record any product decisions made during the grilling/alignment session (if any). These are choices locked in, not open questions. Example
- **PD-01: Each card will have an image** - Allows the user to instantly associate the card with the meaning
- **PD-02: <Decision>** - <Rationale>
-->

## Implementation Decisions

<!-- Record decisions made during the grilling/alignment session that constrain how the feature is built. These are choices locked in, not open questions. Example:
- **IMP-01: Use PostgreSQL instead of Oracle** - It's free
- **IMP-02: <Decision>** - <Rationale>
-->

## Testing Decisions

<!-- Identify the deep module(s) under test, the test boundary, and any decisions about what not to test. Example:
- **TST-01: Do not test UI rendering** - Layout and styling are covered by snapshot tests in the UI layer; duplicating them here adds noise without coverage value.
- **TST-02: <Decision>** - <Rationale>
-->

## Proposed Modules

<!-- Whenever possible, use Deep modules rather than Shallow.
A deep module has:
- A small public API.
- A clear responsibility.
- Internally hidden complexity.
- Few concepts the caller must understand.
- Strong tests around its public behavior.
- Low coupling to unrelated parts of the system.

Example:
- **MOD-01: Story Bible Entry** - ...
- **MOD-02: Corkboard Entry** - ...
-->

## Workflows

### Workflow 1: <Happy Path>

<!-- Example
```
1. ...
2. ...
3. ...
```
-->

### Workflow 2: <Alternative Path>

<!-- Example
```
1. ...
2. ...
```
-->
