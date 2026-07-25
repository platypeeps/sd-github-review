# Trusted Finding Adjudication Workflow Implementation Plan

1. Add trusted workflow input and authorization-result fixtures.
2. Implement actor, permission, publisher-separation, risk-policy, and exact
   finding validation behind injected GitHub boundaries.
3. Implement bounded single/batch operation handling and idempotency.
4. Integrate the private store request/acknowledgment and reconciliation path.
5. Publish bounded GitHub summary/receipt state and setup capability.
6. Test replay, conflict, head changes, permissions, CODEOWNER policy,
   untrusted inputs, ambiguous writes, privacy, and no-checkout behavior.
