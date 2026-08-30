---
title: Release v0.3.0, advance every first-party pin, enforce pin freshness, quarantine unreachable v2 code
status: done
created: 2026-08-08
---
# Release v0.3.0, advance every first-party pin, enforce pin freshness, quarantine unreachable v2 code

## Goal

Cut release v0.3.0, move every first-party action reference onto it, make the metadata
validator reject a stale pin instead of merely a malformed one, and take the unreachable v2
surface out of the CI gate.

## Problem

### The published pin is a release and 252 commits behind

Every first-party reference in the repository pins the same SHA,
`8636a3983d18de17c49907a4c48170a61b1bb713`. That SHA is tagged `v0.1.0` and dates from
2026-07-23; `git rev-list --count 8636a39..main` is 252 and `package.json` already declares
`0.2.0`, so the published pin is one full release and 252 commits stale. The fourteen sites
are:

Ten are executable first-party pins that `assertFirstPartyConsistency` reads:

| File | Line |
| --- | --- |
| `config/routed-review-setup-v1.json` | 21 |
| `examples/review-router.yml` | 21 |
| `examples/pr-agent-router.yml` | 22 |
| `examples/on-demand-review-router.yml` | 40, 65 |
| `examples/pr-agent-on-demand-review-router.yml` | 52, 168, 176 |
| `examples/pilot-router.yml` | 21 |
| `examples/gated-review-router.yml` | 52 |

Four are prose mentions that only AC 2's grep covers:

| File | Line |
| --- | --- |
| `README.md` | 94 |
| `SETUP-COPILOT.md` | 58 |
| `SETUP-PR-AGENT.md` | 123, 273 |

`examples/gated-review-router.yml` was not in the original count: it landed in PR #63,
after this task was planned. The two counts are kept distinct rather than flattened,
because only the first group is machine-checked.

Anything installed from these examples therefore runs v0.1.0 and misses everything landed
since, including concurrency-safe receipt creation, rerequest hardening, and the
identity-override fixes.

### Nothing detects staleness

`scripts/validate-action-metadata.mjs` reads the descriptor's `actionReference` and rejects it
only when it fails to match `owner/repo@<40-character SHA>` (the `firstPartyReference` test
around line 245). `assertFirstPartyConsistency` then checks that every example pin equals the
descriptor's pin. Together these guarantee the pins agree with each other and are well-formed
— and nothing more. Fourteen sites across ten files agreeing on a 252-commit-old SHA passes
the gate cleanly, which is exactly the state the repository is in today.

### The descriptor cannot express contract-version range

The descriptor declares a scalar `contractMajor`. Consumers have no way to learn which contract
majors a given release actually supports, which is contract item R2 from the 2026-08-08
collaboration review.

### 71% of `src/` is gated but unreachable

Eight modules — `src/protocol-v2.js`, `src/retention-policy.js`, `src/review-budget-ledger.js`,
`src/review-candidate-catalog.js`, `src/review-deferred-recovery.js`,
`src/review-plan-authorization.js`, `src/review-usage-reconciliation.js`,
`src/routed-review-compiler.js` — total 9,390 of the 13,136 lines under `src/` and are
unreachable from the Action entrypoint `src/index.js`. A transitive relative-import walk from
`src/index.js` reaches 11 of the 19 modules in `src/`; these eight are the remainder. They are
carried by the CI gate — coverage, lint, review budget — while executing in no code path the
Action can enter. This is contract item R3.

## Requirements

- Tag and publish release v0.3.0 from `main`.
- Update all fourteen sites above to the v0.3.0 SHA in one change, so
  `assertFirstPartyConsistency` never sees a split state.
- Add an assertion to `scripts/validate-action-metadata.mjs` that the descriptor's
  `actionReference` SHA resolves to the current release, not merely to 40 hex characters. The
  check must fail when a new release is cut and the descriptor is not advanced.
- Add a `supportedContractMajors` array to the setup descriptor alongside the existing scalar
  `contractMajor`, and validate it (contract item R2).
- Quarantine the eight unreachable modules out of the CI gate surface — coverage, lint, and any
  size or budget gate — without deleting them, so the parked v2 work stays recoverable
  (contract item R3).

## Acceptance Criteria

- [ ] `v0.3.0` exists and every first-party reference resolves to it; `package.json`
      declares `0.3.0`. (Was `git tag --points-at HEAD` includes `v0.3.0`, which is
      unsatisfiable alongside AC 3: the tag is cut from the commit *before* the pin
      advance, so it can never point at the HEAD that carries the advanced pins.)
- [ ] `grep -rn 8636a3983d18de17c49907a4c48170a61b1bb713` over tracked files returns no hit
      outside `.trellis/` history.
- [ ] All fourteen sites pin the v0.3.0 SHA: ten executable first-party pins that
      `assertFirstPartyConsistency` reads, plus four prose mentions that only AC 2's
      grep covers.
- [ ] `node scripts/validate-action-metadata.mjs` passes; reverting the descriptor to the
      v0.1.0 SHA makes it fail with a staleness error rather than passing.
- [ ] The descriptor carries a non-empty `supportedContractMajors` array that includes its
      `contractMajor`.
- [ ] The CI gate no longer measures the eight named modules, and those files still exist in
      the tree.
- [ ] `npm test` stays at 0 failures (598 passing before this change; the 595 figure
      predates PR #63).

## Notes

The pin advance and the freshness assertion belong in the same change: adding the assertion
first turns the gate red on `main`, and advancing the pins first leaves the gate unable to
prove the advance stuck.

### PARK NOTE — 2026-08-09

Parked during work-loop run `c2cfddfa`, iteration 1, at the planning convergence boundary.
Planning is complete: `design.md` and `implement.md` are written and have passed host
adversarial review (9 concerns; C-1 blocking and addressed, C-2 and C-8 rebutted by
measurement). The optional Codex lane hung for ~25 minutes producing no output and was
killed — recorded as failed, not as approval.

**What blocks it:** concern C-7. Requirement 1 is "tag and publish release v0.3.0", an
outward-facing release artifact the operator retained rather than delegating. The
pin-freshness assertion resolves the latest existing release tag, so it cannot go green
against a tag that does not exist. Verified still absent at park time:
`git tag --list v0.3.0` and `git ls-remote --tags origin v0.3.0` both return nothing.

**What resumes it:** the operator publishing the tag at
`744a9f138bba7c60272c7f9e3f8412e435e11b89`, per `implement.md` Gate 0. Confirm with
`git rev-list -n1 v0.3.0`. Implementation then proceeds from `implement.md` step 1 with no
replanning needed.

**Owner:** operator (sdelmas). No repository mutation was performed under this task.
