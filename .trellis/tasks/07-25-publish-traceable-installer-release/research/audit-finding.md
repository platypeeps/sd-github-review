# Audit finding A-007

- Source report: `.trellis/audit/reports/2026-07-25-2eeca60.md`
- Source ledger: `.trellis/audit/ledger.md`
- Status at planning: open
- Assigned task: `07-25-publish-traceable-installer-release`

## Verified Evidence

- `README.md:38` depends on the post-v0.1.0 installer.
- `SETUP-PR-AGENT.md:19` rejects the only release's Docker Action pattern.
- `scripts/consumer-installer.mjs:530` omits source tag/commit from manifests.

## Planning Decision

This task is the single implementation owner for A-007. It remains independently reviewable and must update the audit ledger only after the finding is verified fixed on the implementation head.
