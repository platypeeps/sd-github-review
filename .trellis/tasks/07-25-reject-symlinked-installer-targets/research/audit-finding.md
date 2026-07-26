# Audit finding A-005

- Source report: `.trellis/audit/reports/2026-07-25-2eeca60.md`
- Source ledger: `.trellis/audit/ledger.md`
- Status at planning: open
- Assigned task: `07-25-reject-symlinked-installer-targets`

## Verified Evidence

- `scripts/consumer-installer.mjs:404` resolves only the Git worktree root.
- `scripts/consumer-installer.mjs:438` joins fixed destinations without canonicalizing ancestors.
- `scripts/consumer-installer.mjs:242` writes through existing path components.

## Planning Decision

This task is the single implementation owner for A-005. It remains independently reviewable and must update the audit ledger only after the finding is verified fixed on the implementation head.
