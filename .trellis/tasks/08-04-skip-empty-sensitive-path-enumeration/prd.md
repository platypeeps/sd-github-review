# Skip PR file enumeration when no sensitive paths are configured (A-014)

## Goal

Close audit finding A-014 so neither entrypoint calls `listPullRequestFiles`
when the sensitive-paths policy is empty — the fetch paginates every PR file for
no routing effect.

## Audit Finding

- ID: A-014 · severity P2 · effort S · confidence Plausible · dimension performance
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: Empty sensitive-path policy still paginates every PR file. Disabled
  path routing still consumes latency and GitHub quota.

## Evidence Boundary

- `src/index.js:236` — standalone: `files` is fetched whenever
  `needsSensitivePathEvaluation` (auto, not draft, not ignored), independent of
  whether any sensitive pattern is configured.
- `src/operations.js:342` — durable: `files` is fetched whenever
  `request.route === "auto"`, and `sensitivePaths` is parsed only afterward
  (line 350).
- `files` feeds only `buildRiskContext` (`src/risk-context.js:25` →
  `findSensitiveFiles(files, sensitivePaths)`), and `findSensitiveFiles`
  (`src/path-match.js:34-37`) returns `[]` for empty patterns regardless of
  `files`. So with an empty policy the enumeration cannot change any routing
  decision — it is pure wasted latency and quota.

Confirmed on main @ HEAD (2026-08-04): in both files `files` has no consumer
other than `buildRiskContext`; the derived `sensitiveFiles` is what flows
downstream.

## Requirements

- When the resolved sensitive-paths policy is empty, neither entrypoint calls
  `listPullRequestFiles`.
- When at least one sensitive pattern is configured (and routing is otherwise
  eligible: standalone auto/non-explicit/non-draft; durable `route === "auto"`),
  file enumeration happens exactly as today.
- The resolved route and `sensitive-files` outputs are unchanged for every case
  (empty patterns already yield no sensitive files).

## Acceptance Criteria

- [x] A test proves: standalone auto routing with no `sensitive-paths` does not
      call `listPullRequestFiles`, and still routes.
      (`test/action.test.js` A-014 test via `listError`.)
- [x] A test proves: standalone auto routing with a sensitive pattern still
      calls `listPullRequestFiles` (unchanged path). (Existing
      `test/action.test.js:196-200` sensitive test, still green.)
- [x] A test proves: durable `route: "auto"` with no `sensitive-paths` does not
      call `listPullRequestFiles`. (`test/operations.test.js` A-014 test.)
- [x] Full suite green (baseline 229/229 → 231/231 with 2 new tests).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-014 set to fixed after verification; owner
      reassigned to this dedicated child.

## Out of Scope

- Successor-compare file loading in the durable path (`store.compareSuccessor`);
  that is a distinct receipt concern, not sensitive-path enumeration.
- Any change to `findSensitiveFiles` / `buildRiskContext` contracts.
