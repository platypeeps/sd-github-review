# Repository Audit Remediation Design

## Ownership Model

```text
audit report + ledger
        |
        +-- existing routed-review owners (5 findings)
        |
        +-- remediation parent
               +-- 17 finding-specific children
        |
        +-- follow-up audit -> ledger status transition
```

The parent owns sequencing, mapping, and final verification. It owns no product
code. Each finding has exactly one implementation owner even when validation
touches adjacent modules.

## Execution Order

1. Verified P1 dispatch correctness: A-001, A-002, A-003.
2. Verified P1 trust and filesystem safety: A-004, A-005.
3. Verified P1 test/release integrity: A-006, A-007.
4. P2 correctness, performance, tooling, architecture, and consumer lifecycle.
5. P3 encapsulation, dead-code, and bounded-concurrency polish.
6. One exact-head follow-up audit and ledger reconciliation.

Structural P2 work may precede a dependent P1 only when the child design
records that dependency and preserves a focused P1 verification gate.

## Closure Contract

A child or existing owner may complete after focused and repository gates pass.
The audit finding remains open until a follow-up audit verifies it on the
integrated head. Regressions reuse the same A-ID.
