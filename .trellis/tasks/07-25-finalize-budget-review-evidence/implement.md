# Budget Review Evidence Finalization Implementation Plan

1. Add model/profile acknowledgment, outcome, token-limit, soft/hard overrun,
   overdrawn, and reconciliation-link fixtures.
2. Implement model/profile provenance validation and monotonic receipt
   transitions.
3. Publish stable `sd-review / assurance` and `sd-review / gate` Checks with
   separate assurance/gate outcomes and explicit budget-deferral semantics.
   Net-new: the names and the projection codec ship
   (`src/protocol-v2.js:153-154`, `:1324`, `:1351`) but nothing in `src/` writes
   either Check. The single `createCheckRun` call site is `src/receipt.js:543`,
   publishing the v1 receipt Check `sd-github-review/receipt`. Include the
   `pass|block` ↔ `passed|blocked` translation named in `design.md`.
4. Add bounded status, pending, explain, recovery, discovery, retention-status,
   and purge-operation projections. **Oversized — split before starting.** These
   span `protocol-v2.js`, `review-deferred-recovery.js`, and
   `retention-policy.js` (~4,550 lines of existing contract); with step 5 they
   are a separate child, not one step of this one.
5. Add policy/class/lifecycle/hold/deletion/coverage metadata and GitHub-native
   artifact exclusions.
6. Add immutable-attempt/latest-head projection revisions, same-head recovery,
   changed-head supersession, stale-write rejection, and branch-protection
   readiness diagnostics. **The branch-protection half has no data source.**
   `src/github.js` has no branch-protection read method, and the enclosing
   operation would need a permission beyond the `checks: read|write` declared at
   `src/operation-contract.js:116,:130`. Add both prerequisites explicitly or
   defer that half; the descriptor half (advertising the two Checks) is a schema
   bump on the shipped `config/routed-review-setup-v1.json`, still
   `schemaVersion: 1` advertising only `sd-github-review/receipt`.
7. Harden replay, truncation, privacy, and historical receipt behavior.

Registration and reachability apply here as they do to the sibling children:
append any new module to the explicit `node --check` list in `package.json:12`,
declare its allowed imports in `test/dependency-boundaries.test.js:18-55`, and
leave it out of `QUARANTINED` in `scripts/check-coverage.mjs:38-47` so coverage
is enforced. Note that `protocol-v2.js` is still unreachable from `src/index.js`
— this task adds to the 9,390 of 13,136 `src/` lines no consumer can execute
unless the distribution premise is resolved first.

Validate every terminal state, unknown usage, duplicate finalization, changed
head, deferred recovery linkage, content/budget/gate outcome independence,
non-budget hard blocks, prohibited fields, and public metadata gates.
