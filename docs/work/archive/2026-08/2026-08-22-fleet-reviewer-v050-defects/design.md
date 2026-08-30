# Design — close the two v0.5.0 defects the fleet reviewer found

Both defects are drift between something the project *declares* and something it
*does*. D1 declares too few permissions; D2 declares a policy minimum it does
not enforce. Neither is fixed durably by editing the declaration, because
nothing watches either one. Each fix is therefore two parts: correct the value,
and add the gate that makes the drift impossible to reintroduce.

## D2 — the review floor

### Decision

**A dispatching caller may not lower the floor.** Decided 2026-08-22 by the
owner. The floor moves off the `workflow_dispatch` input and onto an
installer-managed repository variable, exactly as `route-policy` already is, and
the lane refuses to run when that variable is unset or invalid.

The alternative readings were considered and rejected: hardcoding `copilot` in
the lane template would make the floor unconfigurable per consumer and turn any
future change into installer-reported drift, and keeping the override would
leave a minimum that its own holder can lower — the property `route-policy` was
hardened against in 0.5.0.

### What fail-closed actually buys, and what it does not

An earlier draft of this design justified the guard by claiming that wiring
`${{ vars.REVIEW_INDEPENDENT_FLOOR }}` with the variable unset would silently
yield a floor of `none`, making the naive fix worse than the defect. **That is
wrong**, and the correction changes why the guard is here.

`src/operations.js:30` is `env[...] ?? fallback` — nullish coalescing, not `||`.
An unset repository variable renders as the *empty string*, and GitHub still
sets `INPUT_INDEPENDENT-REVIEW-FLOOR=""`. The env var is present, so `??` does
not fire and the `"none"` fallback is never reached. `""` flows into
`normalizeMode`, which is `MODES.has("")` → false → **throws**
(`src/normalize.js:17-22`). The throw happens while inputs are being read, before
any routing decision or receipt write.

So the naive wiring already fails closed. The guard is therefore not a
correctness necessity, and this design must not claim it is:

- it fails at the lane, before the action starts, so the operator sees "set
  `REVIEW_INDEPENDENT_FLOOR`" rather than
  `independent-review-floor must be one of: none, cheap, deep, copilot`, which
  names the input and not the thing to fix;
- it keeps the two policy inputs symmetrical — `REVIEW_ROUTE_MODE` already has
  exactly this guard in `examples/pr-agent-router.yml`, and a reader comparing
  the two should not have to know that one is protected by an accident of the
  decoder;
- it is defence in depth against a decoder change. Nothing pins `normalizeMode`
  rejecting `""` today.

**The genuine fail-open is elsewhere and neither the guard nor the wiring closes
it.** The `"none"` fallback *does* fire when the input is absent entirely — that
is, when the lane omits the `with:` key rather than passing an empty one. A
future edit that reasons "this variable is unset everywhere, drop the line"
silently restores an unfloored lane. The same shape appears again at
`src/router.js:182`, `independentReviewFloor ?? "none"`. Only a test asserting
that the shipped lane *passes the key* closes this, and Phase 2 carries one.

### Shape

New managed variable **`REVIEW_INDEPENDENT_FLOOR`**. Named after its sibling
`REVIEW_ROUTE_MODE` rather than the `SD_REVIEW_*_V1` convention, which is used
for JSON backend descriptors; this is a plain enum and reads as the other half
of the same policy pair.

In `examples/sd-review.yml`:

- delete the `independent-review-floor` `workflow_dispatch` input entirely,
  including its `options: [none, cheap, deep, copilot]` list;
- add a guard step to the `review` job that `case`s over the four accepted
  values and exits non-zero on empty or unrecognised, with an error naming the
  variable and what to set it to;
- wire `independent-review-floor: ${{ vars.REVIEW_INDEPENDENT_FLOOR }}`;
- rewrite the comment above it. The current text — "the routed-review caller
  does not send this input … lower it deliberately, never by accident" — is
  accurate about the pack and false about a human at the Actions UI, which is
  precisely how the defect survived review.

In `action.yml`, the `route-policy` description currently ends by warning that
"the neighbouring policy inputs on the shipped lane are deliberately wired the
other way, which is what makes a consistency-minded edit here dangerous." After
this change that sentence is not merely stale, it actively describes the
defect as intentional. Both policy inputs become variable-wired, so the warning
must name both and say so.

### A floor of `copilot` is the strongest floor, and that has a consequence

`ROUTE_STRENGTH` in `src/router.js:15-20` is
`none:0, cheap:1, deep:2, copilot:3`, and its own comment says the ordering
"ranks assurance … not cost". `copilot` is therefore the *top* of the scale
while also being the only advanced route that spends nothing.

Two consequences follow, and both should be recorded rather than discovered
later:

- `high-risk-route: deep` is **inert** wherever the floor is `copilot`.
  `src/router.js:188` computes `floor = strongerRoute(configuredFloor,
  riskFloor)`, so a high-risk pull request raises the risk floor to `deep` (2)
  and the configured floor immediately wins at `copilot` (3). The high-risk path
  cannot select a weaker-but-paid route than the floor already guarantees.
- Combined with `route-policy: copilot`, which polices explicit requests by
  membership, **`cheap` and `deep` are unreachable on the fleet today** — not by
  automatic selection, because the floor outranks them, and not by explicit
  request, because the policy refuses them. The v0.5.0 pilot demonstrated the
  explicit half live: an explicit `deep` was refused before any receipt write.

That makes `CHEAP_REVIEW_MODEL`, `DEEP_REVIEW_MODEL`, and both
`SD_REVIEW_*_BACKEND_V1` descriptors dead configuration on all nine consumers
under the current policy pair. This is a correct and deliberate outcome for a
provider-free fleet — it is why no consumer needs the credential — but it is
worth stating plainly, because a reader who assumes the paid backends are
reachable will misread both this task and any future cost work. Out of scope
here; not a defect.

### Accepted-value set must not drift from the lane

`ROUTE_MODES` in `scripts/consumer-installer/codecs.mjs` carries a comment
explaining that the installer's accepted set and the lane's `case` statement are
"not independent", and that a test extracts the lane's pattern and asserts set
equality so they cannot drift one-directionally. The new floor guard introduces
a second such pairing and needs the same treatment: the floor guard's `case`
arms and the installer's accepted floor values are one set expressed twice.

### Installer

Follow the `REVIEW_ROUTE_MODE` precedent exactly — it is the same change one
version earlier:

- manifest schema **5 → 6**, adding a `| 6 |` row to the matrix comment in
  `codecs.mjs` and `6` to `SUPPORTED_MANIFEST_SCHEMA_VERSIONS`;
- `export const REVIEW_FLOOR_MIN_SCHEMA_VERSION = 6`, gated on the version the
  requirement was introduced at. The existing comment on
  `ROUTE_MODE_MIN_SCHEMA_VERSION` explains why this must never be
  `=== MANIFEST_SCHEMA_VERSION`: that narrows an existing tier instead of adding
  one;
- a new `FLOOR_CONFIG_VARIABLES` layer spreading `CONFIG_VARIABLES` and adding
  `REVIEW_INDEPENDENT_FLOOR: { field: "reviewFloor" }`. The version-scoped
  layering exists so manifests written before a variable joined keep decoding;
- a `check` drift row for the variable, mirroring
  `consumer-installer.mjs:216`;
- an upgrade message in the schema ladder at `consumer-installer.mjs:474-490`,
  mirroring "manifest predates route-mode management; run update to record
  REVIEW_ROUTE_MODE".

### The rollout hazard this creates

Fail-closed plus a *new* variable means any consumer that receives the new lane
without the variable stops routing entirely. The ordering that avoids it falls
out naturally and must still be stated, because getting it backwards breaks all
nine at once:

**Set the variable everywhere before any consumer's lane advances.** The old
lane does not read `REVIEW_INDEPENDENT_FLOOR`, so writing it early is inert —
there is no window in which the variable is set and harmful. The lane arrives
later, by merged pull request, and finds the variable already present.

The reverse order has no safe window at all.

## D1 — the descriptor's required permissions

### The drift, enumerated

Computed from the two shipped lanes rather than restated:

| lane | union of top-level and per-job `permissions` |
| --- | --- |
| `examples/sd-review.yml` | `contents:read, issues:write, pull-requests:write, checks:write` |
| `examples/pr-agent-router.yml` | `contents:read, issues:write, pull-requests:write` |

`contract/routed-review-setup-v1.json` declares
`contents:read, pull-requests:write, checks:write`. Exactly one key of drift:
**`issues:write` is missing.**

### Which lane the descriptor describes

The descriptor is not a union of every shipped lane. Its own
`workflow.path` is `.github/workflows/sd-review.yml`, so it describes the
**durable lane** and only that. A gate asserting equality against both lanes
would fail on the router, which legitimately needs no `checks:write` — the
router writes no durable receipt.

This matters for the gate: it must resolve the lane from the descriptor's own
`workflow.path` rather than from a hand-written list, or the gate becomes the
next thing that drifts.

### Reviewer isolation is not violated by this

Worth recording, because it is the objection the fix invites. Adding
`issues:write` to `requiredPermissions` does **not** widen the `pr-agent` job.
That job's narrower grant is deliberate isolation — a third-party container that
holds neither `issues:write` nor `checks:write` cannot forge a durable receipt.
`requiredPermissions` describes what a workflow installing this integration must
be *able* to grant; the lane then narrows per job. The two are different
statements and only the first is wrong today.

This is also the correct reply to the finding as it was raised on
`mezmo_benchmark` #522, which read the missing permission as a defect in the
`pr-agent` job rather than in the descriptor.

### Gate

`scripts/validate-action-metadata.mjs` already parses every shipped lane via
`laneDocuments()`, which enumerates `.github/workflows` and `examples` from the
filesystem specifically so a lane added later reaches the gates without an edit.
The new gate consumes that same enumeration:

1. read the descriptor's `workflow.path`, take its basename;
2. select the shipped lanes whose basename matches;
3. compute the permission union across top-level and every job;
4. require set equality with `requiredPermissions` — failing both on a
   permission a lane requests that the descriptor omits, and on one the
   descriptor declares that no lane requests.

Equality rather than containment on purpose. Containment would let the
descriptor over-declare, which asks consumers to grant permissions the lane
never uses — the same class of error in the opposite direction, and the one that
`grep`-based review is least likely to catch.

The existing gate at the same seam checks lane permissions against the
*operation contract* — the one producing "needing checks:write but grants
checks:none". It never looked at the descriptor, which is why this drift had
nothing watching it.

Both descriptor copies (`contract/` and `config/`) are currently byte-identical
at `ea6f34bb…` and must stay so; that invariant already has coverage and the fix
must not break it.

## Release shape

**`0.6.0`, not `0.5.1`.**

D1 alone is a patch — a corrected declaration and a new gate, no consumer-visible
behaviour change. D2 is not. It removes a `workflow_dispatch` input, adds a
required repository variable, bumps the manifest schema, and makes the lane fail
closed without it. A consumer that takes the new lane without running `update`
stops routing. That is a minor bump under any reading.

Ordering is the same pin-advance-before-tag shape used for 0.5.0, and it is
load-bearing: the tag must sit on a pin-advance commit that touches neither
`src/` nor `action.yml`, pinning a parent whose action code is byte-identical.
0.5.0 also established why this is the *only* point the action's own load can be
verified — the self-hosted `route` lane exercises the action at its pin, so
until pins advance it is still testing the previous release. That is how the
`action.yml` load failure reached a published tag. Gate `R-008` now catches that
specific class; the ordering is what catches the rest.

## What this task does not change

- The 21 dismissed findings, dispositioned in `prd.md`.
- The external `finalize`, adapter-replay, and changed-head reconciliation paths,
  still unit-covered and never run live. They need the provider credential that
  `docs/RELEASE_CHECKLIST.md` §2 puts behind separate approval, and this task
  does not request it.
- Any provider credential reaching any consumer. The fleet installed with none
  and stays that way.
