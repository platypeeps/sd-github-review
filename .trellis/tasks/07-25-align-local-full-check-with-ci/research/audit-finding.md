# Audit finding A-017

- Source report: `.trellis/audit/reports/2026-07-25-2eeca60.md`
- Source ledger: `.trellis/audit/ledger.md`
- Status at planning: open
- Assigned task: `07-25-align-local-full-check-with-ci`

## Verified Evidence

- `scripts/sd-ai-command-pack-full-check.sh:1033` defaults to unrelated generic stage names.
- `package.json:12` defines `test`, `check`, and `validate:metadata`.
- `.github/workflows/ci.yml:20` runs those three checks.

## Planning Decision

This task is the single implementation owner for A-017. It remains independently reviewable and must update the audit ledger only after the finding is verified fixed on the implementation head.
