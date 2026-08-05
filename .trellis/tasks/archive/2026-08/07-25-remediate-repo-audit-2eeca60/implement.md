# Repository Audit Remediation Implementation Plan

1. Land P1 dispatch-identity and receipt-concurrency fixes.
2. Land P1 reviewer-permission and installer-containment fixes.
3. Add shipped-boundary tests and coverage gates before release work.
4. Cut and verify the traceable installer/template release.
5. Execute P2 tasks in dependency order: routing/Action contracts, installer
   structure and lifecycle, remote-call bounds, API-call reductions, dependency
   and local-gate parity.
6. Execute P3 cleanup and performance tasks after their owning modules settle.
7. Run `sd-audit-repo follow-up`, update the ledger, and close the parent only
   when every finding has terminal evidence.

## Validation

- Validate task metadata and context manifests before any child starts.
- Run each child's focused validation plus `npm test`, `npm run check`, and
  `npm run validate:metadata`.
- Re-query exact-head CI and review evidence for delivery PRs.
- Run the final follow-up audit against a clean integrated head.

## Rollback Gate

Stop the stream if remediation introduces duplicate reviewer side effects,
wrong-head evidence, credential exposure, consumer-file escape, or an
untraceable release. Preserve the failing regression and return the ledger item
to open or regressed.
