# Audit finding A-012

- Source report: `.trellis/audit/reports/2026-07-25-2eeca60.md`
- Source ledger: `.trellis/audit/ledger.md`
- Status at planning: open
- Assigned task: `07-25-bound-review-remote-operations`

## Verified Evidence

- `src/github.js:156` calls `fetch` without an abort signal.
- `scripts/consumer-installer.mjs:89` calls `spawnSync` without a timeout.

## Planning Decision

This task is the single implementation owner for A-012. It remains independently reviewable and must update the audit ledger only after the finding is verified fixed on the implementation head.
