# Checkout implementation plan

## Proposed Vertical Slices

1. Restore a saved cart on checkout entry.
   - Stories / requirements / acceptance criteria: AC-01; FR-01.1
   - Add a repository lookup keyed by customer and restore the serialized line items.
   - Exact evidence: integration test for a saved cart and a 100-item performance test.
   - Exit criterion: AC-01 passes and the restore path stays below the latency budget.

2. Handle carts that cannot be restored.
   - Stories / requirements / acceptance criteria: AC-02
   - Show an actionable expiration message and do not create an order.
   - Exact evidence: expired-cart integration test and charge-service interaction assertion.

3. Protect the restoration boundary.
   - Stories / requirements / acceptance criteria: INV-01
   - Keep charging out of the restore transaction and add a regression test proving no charge call.
