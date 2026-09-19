# Checkout improvements

## Application Requirements Covered

| Application ID | Feature requirements | Acceptance criteria |
| --- | --- | --- |
| APP-01 | FR-01.1 | AC-01 |

## Observable Acceptance Criteria

- **AC-01:** **GIVEN** a saved cart, **WHEN** the customer returns, **THEN** the cart is restored.
- **AC-02:** **GIVEN** an expired cart, **WHEN** the customer returns, **THEN** the checkout explains that the cart cannot be restored.

## Functional Requirements

### FR-01: Cart restoration

- FR-01.1: The application SHALL restore a saved cart for the same customer.

## Non-Functional Requirements

- NFR-01: Cart restoration SHALL complete within two seconds for a cart with 100 items.

## Invariants

- INV-01: The application SHALL never charge a customer while restoring a cart.

<!-- Example from the template must not become a requirement:
- FR-99.1: The application SHALL do something from the template.
-->
