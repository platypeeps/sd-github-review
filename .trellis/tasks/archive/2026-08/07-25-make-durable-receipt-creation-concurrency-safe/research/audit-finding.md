# Audit finding A-003

- Source report: `.trellis/audit/reports/2026-07-25-2eeca60.md`
- Source ledger: `.trellis/audit/ledger.md`
- Status at planning: open
- Assigned task: `07-25-make-durable-receipt-creation-concurrency-safe`

## Verified Evidence

- `src/receipt.js:486` checks absence before a separate Check Run create.
- `src/receipt.js:519` can authorize after rereading only the creator's visible Check Run.
- `src/receipt.js:323` rejects later duplicate logical identities without a recovery path.

## Planning Decision

This task is the single implementation owner for A-003. It remains independently reviewable and must update the audit ledger only after the finding is verified fixed on the implementation head.
