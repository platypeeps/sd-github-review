# Audit finding A-008

- Source report: `.trellis/audit/reports/2026-07-25-2eeca60.md`
- Source ledger: `.trellis/audit/ledger.md`
- Status at planning: open
- Assigned task: `07-25-consolidate-routing-policy-boundaries`

## Verified Evidence

- `src/protocol.js:975` implements routing floors and local-evidence policy despite codec ownership.
- `src/index.js:170` composes standalone routing and dispatch.
- `src/operations.js:333` repeats durable composition.

## Planning Decision

This task is the single implementation owner for A-008. It remains independently reviewable and must update the audit ledger only after the finding is verified fixed on the implementation head.
