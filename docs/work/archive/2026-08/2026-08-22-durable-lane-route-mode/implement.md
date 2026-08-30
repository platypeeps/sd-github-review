# Implementation

## Falsifications, named before the work

Two mutations decide whether this change is real. Both must make a test fail.

**F1 — enforce on the resolved route instead of the requested one.**
Change the check to run after the floor is applied. The fleet-shaped case must
go red: policy `cheap`, floor `copilot`, request `auto` must still succeed. If
that test stays green, the change is one `update` away from breaking every
default review on any consumer whose floor outranks its policy.

**F2 — wire the input through `inputs.` instead of `vars.` in
`examples/sd-review.yml`.** The test asserting the wiring must go red. Nothing
in the suite reads that file's `with:` block today — verified: the only
`examples/` references in `test/` are to `pr-agent-router.yml`. Without a new
test, this mutation ships a feature that validates, routes, refuses in unit
tests, and is bypassable by the one caller class it exists to constrain.

F1 is the correctness falsification, F2 the wiring falsification. A green suite
that catches neither proves nothing.

Command for both: `npm test`.

## Checklist

### Contract and metadata

- [x] 1. Add `"route-policy"` to the `route` operation's input list in
      `src/operation-contract.js`.
- [x] 2. Add the matching `route-policy` block to `action.yml`. `required:
      false`, `default: ''`. The description states it is a **maximum** on the
      requested route, that `independent-review-floor` is the separate minimum,
      and that an empty value means no policy.
- [x] 3. `node scripts/validate-action-metadata.mjs` — passes. Run it after
      step 1 alone first and confirm it *fails* with `inputs [...] are used by
      no operation` or its converse, proving the gate is live rather than
      assumed.

### Decode and validate

- [x] 4. In `decodeRoutingInputs` (`src/protocol.js`), validate
      `policy.routePolicy` and return it typed. It joins the validated class,
      not the raw pass-through class that holds `independentReviewFloor` — the
      seam comment above the function states the rule; extend that comment to
      say why this field falls on the validated side.
- [x] 5. `undefined` and `""` both decode to "no policy". Any other value must
      be one of the five route modes or the decode throws naming the field and
      the accepted set.
- [x] 5a. In `src/operations.js`, pass the raw input through to the codec. Do
      **not** wrap it in `normalizeMode` the way `independent-review-floor` is
      wrapped at `src/operations.js:389` — the action default is `''`, and
      `normalizeMode('')` would throw on every dispatch from a consumer with no
      recorded policy. Copying the neighbouring line is the failure mode here,
      the same trap as the `inputs.` wiring in step 9.

### Enforce

- [x] 6. In `selectProtocolRoute` (`src/router.js`), refuse **before**
      `routeReview` is called, so no routing work and no receipt precede the
      failure. `selectProtocolRoute` is the only caller-side entry
      (`src/operations.js:381`) and it runs before any receipt write.
- [x] 7. Permitted set: `auto` always; otherwise the request's route must equal
      the policy. No `ROUTE_STRENGTH` comparison — add a comment saying so, since
      the constant is in scope and reads like it fits.
- [x] 8. Error text matches the approved shape:
      ```
      route "cheap" is not permitted by this repository's review policy.
        REVIEW_ROUTE_MODE = copilot
        permitted: copilot
      Set REVIEW_ROUTE_MODE, or dispatch --remote copilot.
      ```
      It names the variable, its value, and the permitted routes.

### Wire

- [x] 9. `examples/sd-review.yml`: add `route-policy: ${{ vars.REVIEW_ROUTE_MODE
      }}` to the `review` step's `with:` block — **directly to the variable, no
      `inputs.` indirection**, unlike every neighbouring policy line. Add a
      comment saying a dispatch input would let the constrained caller set it.
- [x] 10. Do **not** add a `workflow_dispatch` input for it.

### Tests

- [x] 11. F1's test: policy `cheap` + floor `copilot` + request `auto` succeeds
      and routes `copilot`. This is the fleet-shaped case and the one that fails
      under the resolved-route mutation.
- [x] 12. F2's test: read `examples/sd-review.yml`, assert the `route-policy:`
      line references `vars.REVIEW_ROUTE_MODE` and contains no `inputs.`.
      Follow the `laneRouteModeGate()` pattern already in
      `test/consumer-installer.test.js` — it reads an example workflow and
      asserts structural properties, so this is an established shape, not a new
      kind of test.
- [x] 12a. **The `ROUTE_MODES` binding `prd.md` requires.** The PRD asks for the
      constraint to be bound to the installer's list "by a test that reads the
      lane rather than restating it, so the two cannot drift apart" — the way
      `laneRouteModeGate()` binds the event-driven lane. Steps 11–12 do not do
      this: they check behaviour and wiring, not set equality.
      Assert that the set of values the action accepts for `route-policy` equals
      `ROUTE_MODES` from `scripts/consumer-installer/codecs.mjs` (measured:
      `["auto","cheap","deep","copilot","none"]`), importing both rather than
      restating either. Without this the installer could gain a sixth mode that
      the action then refuses on every dispatch.
- [x] 13. Each explicit route refused under a differing policy, with the error
      naming the variable.
- [x] 14. Each explicit route permitted when it equals the policy, including
      `none` under policy `none`.
- [x] 15. `none` refused under policy `copilot` — the case that looks harmless
      and is not.
- [x] 16. Empty policy permits all five routes. Policy `auto` permits all five.
- [x] 17. An unrecognised policy value throws at decode rather than silently
      disabling enforcement.
- [x] 18. `npm test` — full suite green, and the new-test count recorded.

### Release surface

- [x] 19. `CHANGELOG.md` under the existing `## Unreleased` heading, alongside
      the backend-variable entry. Do not open a new version heading.
- [x] 20. Update `.trellis/spec/backend/` where the route-policy contract now
      differs from what the spec describes.
- [x] 21. Note in the changelog entry that consumers need `update` to take the
      new template, and that this lands on top of the schema-5 migration — one
      `update` covers both.

## What this plan does not do

- No manifest schema bump. Schema 4 already records `routeMode`.
- No descriptor change and no pack release.
- No change to `independent-review-floor`, including its caller-overridability
  (recorded in `design.md` as a separate gap).
- No fleet rollout. That is the canary task's decision, not this one's.

## Rollback

Revert the commit. Nothing is persisted — the policy is evaluated per dispatch.
Before any consumer runs `update`, revert is total; afterwards it is an `update`
from a reverted version.

## Review gate

`npm test` green with F1 and F2 both demonstrated failing under their mutations,
then `validate-action-metadata.mjs` clean. Report the mutation results as
measured, including any that did not fail as predicted.

## Executed scope — 2026-08-22

The plan above covers the route-policy change (`0bec772`, `85a3050`). The
approved expansion added the following, in order. All are on
`feat/durable-lane-route-policy`; every one was falsified by mutation before
being kept, and mutations that did not fail as predicted are recorded.

| Commit | Change |
| --- | --- |
| `47a887f` | `attempt > 1` requires `rerequestOf` |
| `f80067c` | first-party lane reconverged; template-variable guard |
| `9d98eb5` | a recorded skip no longer wedges its head |
| `605dae1` | guard scanning every lane for a caller-supplied policy |
| `2148525` | in-flight/stranded split; `route` fails on reconciliation |
| `4798070`, `d07fb08`, `1ec6c0b`, `b36dd85` | changelog and doc corrections; `durable-state` list made self-enforcing |
| `99ab35b` | route policy wired into the two remaining on-demand lanes |
| `52c3027` | prose-pin gate; mislabelled release tag corrected |
| `b1ac293` | never-tagged 0.4.1 folded into 0.5.0 |
| `a97434e` | stale manifest no longer wedges a consumer at current source |
| `585182b` | release gate refuses a lane input the pinned action never declared |
| `6788436` | route-policy refusal names `auto` |
| `5e358bf` | pin advance unblocked; three ungated drift paths closed |

### Verification as run

- `npm test` 711/711, `npm run check` exit 0, `npm run validate:metadata` exit 0.
- A complete 22-site pin-advance simulation passes both the ordinary and the
  `SD_RELEASE_TAG` form of the gate; a pin left on v0.3.0's commit still fails.
- Fleet surveyed directly: 8 of 9 consumers have no installation, no manifest,
  and no `REVIEW_ROUTE_MODE`; 7 hold no provider credential and
  `answerbook/mezmo_benchmark` holds only a truncated dead one. So the rollout
  is 8 fresh installs plus one update, and `copilot` is the approved mode.

### Mutations that did not fail as predicted

- Deleting the first-party filter in `assertPinnedInputsDeclared` initially
  failed nothing: the fixture had no third-party step carrying a `with:` block,
  so `actions/checkout`'s `fetch-depth` would have been reported as undeclared
  and no test noticed. Fixture and assertion added; the mutation is now caught.
- An early idempotency test stayed green with its narrowness clause removed,
  because at a fixed clock a preserved record and one rewritten with identical
  content are the same bytes. Fixed with a settable clock and a `completedAt`
  assertion.

### Process note

Twice a blanket `git checkout -- .` used to clean up a pin-advance simulation
discarded uncommitted work in the same sweep. Nothing committed was lost and
both edits were reapplied, but the pin count, lane parity, and full suite were
re-verified before committing rather than assuming the reapply was complete.

