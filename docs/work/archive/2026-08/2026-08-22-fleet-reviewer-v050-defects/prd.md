---
title: Close the two v0.5.0 defects the fleet reviewer found
status: done
created: 2026-08-22
branch: fix/v050-defects
---
# Close the two v0.5.0 defects the fleet reviewer found

Both were found by the newly installed review lane reviewing its own install
pull requests across the eight fleet consumers on 2026-08-22. Neither affects an
installed lane at runtime, which is why the rollout merged ahead of them.

## D1 — WITHDRAWN. Not a defect; the behaviour is documented and deliberate

**Resolved 2026-08-22 by attempting the fix and having the repository reject
it.** The section below is left as originally filed, because it is what three
consumer pull requests reported and what this task was created to close. It is
wrong, and the evidence is:

1. **The action makes no `/issues` API call at all.** Its entire request surface
   is `/pulls`, `/compare`, `/check-runs`, and `/requested_reviewers`
   (`src/github.js`). The operation contract agrees: no operation declares an
   `issues` permission.
2. **An existing gate already pins the descriptor.** Adding `issues: write` to
   `requiredPermissions` fails `assertSetupContract` immediately —
   "requiredPermissions.issues is write but the contract union over
   supportedOperations needs none". The descriptor is bound to the operation
   contract, which is the correct source of truth for it.
3. **`DESIGN.md:447-449` documents the mismatch as intentional**, in terms that
   name this exact case: "A job may hold extra permissions its other steps
   require — the durable receipt jobs carry `issues: write` for the PR-comment
   side-effect channel, which is job-level and distinct from the receipt
   operations' contract set, **not a claim that `route`/`finalize` need
   `issues`**."
4. **The router lane genuinely needs it.** `examples/pr-agent-router.yml` is a
   single `route` job that runs both the action and `docker run pragent/pr-agent`,
   so its top-level `issues: write` belongs to PR-Agent, exactly as
   `SETUP-PR-AGENT.md:311` states: "`issues: write` and `pull-requests: write`
   allow PR-Agent to publish its conversation comment."

The reviewer found a real *asymmetry* and mis-attributed it, and this task
repeated the mis-attribution. Both directions of "fix" are wrong: adding the
permission to the descriptor breaks the contract gate, and removing it from the
lanes breaks PR-Agent's comment channel in the router.

### What is actually left underneath it, unresolved

In the **durable** lane, PR-Agent is isolated in its own `pr-agent` job holding
`contents: read, pull-requests: write` and **no** `issues: write`. In the
**router** lane it shares a job that has `issues: write`. The two lanes give the
same container different permissions for the same task.

If PR-Agent needs `issues: write` to post a conversation comment, the durable
lane cannot publish findings at `cheap`/`deep` — which is precisely what the
`mezmo_benchmark` #522 reviewer claimed. If a PR conversation comment is covered
by `pull-requests: write` (GitHub treats pull requests and issues as separate
permission scopes for comments), then the router's grant is dead and the
isolation comment naming `issues: write` is misleading.

**This cannot be settled from inside this repository.** It needs a live PR-Agent
run on the durable lane at `cheap` or `deep`, observing whether the comment
posts — and that needs the provider credential `docs/RELEASE_CHECKLIST.md` §2
puts behind separate approval. Parked on that approval; not blocking D2.

Nothing was shipped for D1. The working tree was returned to 713/713 passing
with the validator green.

## D1 as originally filed — the descriptor under-declares required permissions

`contract/routed-review-setup-v1.json` (and its `config/` copy) declares:

```json
{"contents":"read","pull-requests":"write","checks":"write"}
```

Both shipped lanes request `issues: write`: `examples/pr-agent-router.yml:11`,
`examples/sd-review.yml:45`, `examples/sd-review.yml:175`.

Three consumer pull requests flagged this independently
(rwbp-coordinator #254, se-ai-command-pack #264, anomaly-metric-creator #399).

Nothing breaks at runtime because each lane carries its own permissions inline.
The damage is to anyone provisioning permissions *from the descriptor*, which is
what the descriptor is for: they grant too little and the lane fails when it
first needs `issues: write`.

`validate-action-metadata.mjs` already checks lane permissions against the
operation contract — that is the gate that produces "needing checks:write but
grants checks:none". It does **not** check them against the descriptor's
`requiredPermissions`, so this drift had nothing watching it.

### Acceptance criteria — VOID, not met and not to be met

These four describe the fix for a defect that does not exist. They are recorded
unticked on purpose: ticking them would claim work that was attempted, found
wrong, and reverted. Criteria one through three cannot be satisfied without
breaking `assertSetupContract`, which is the gate that rejected the attempt.
The fourth is not this task's to claim. The two copies were byte-identical to
each other before this task and still are, but the file itself is **not**
unchanged — it carries a first-party pin, so the release moved it from
`ea6f34bb…` at `v0.5.0` to `854504…` at `v0.6.0`. What did not change is
`requiredPermissions`, which is the field D1 was about:

```
$ shasum -a256 contract/routed-review-setup-v1.json config/routed-review-setup-v1.json
854504864fb1ef3fdf9137ca63245b31be51795e5b5d4419bd92614bc7b57da1  contract/routed-review-setup-v1.json
854504864fb1ef3fdf9137ca63245b31be51795e5b5d4419bd92614bc7b57da1  config/routed-review-setup-v1.json
```

- [ ] ~~`requiredPermissions` is the union of what the shipped lanes actually
      request, derived by enumeration rather than restated by hand.~~
- [ ] ~~A gate fails when a lane requests a permission the descriptor omits, and
      when the descriptor declares one no lane requests.~~
- [ ] ~~The gate is proven by mutation: removing `issues: write` from the
      descriptor must fail it.~~
- [ ] ~~Both descriptor copies stay byte-identical.~~

## D2 — the review floor is dispatch-overridable, the route policy is not

In `.github/workflows/sd-review.yml`:

```yaml
line 66:  independent-review-floor: ${{ inputs.independent-review-floor }}
line 74:  route-policy: ${{ vars.REVIEW_ROUTE_MODE }}
```

`route-policy` was deliberately hardened in 0.5.0 against a dispatching caller
supplying their own bound. The floor is the same threat model and is still
wired the other way: a caller with write access can dispatch
`independent-review-floor: none` and defeat the property the lane's own comment
claims, that `copilot` "guarantees an independent review on every routed pull
request".

The lane comment is accurate about the pack, which dispatches only `operation`,
`review-request`, and `rerequest-authorized`. It is not accurate about a manual
dispatcher.

This needed a decision before a fix: may a dispatch caller ever lower the floor?

**Decided 2026-08-22 by the owner: no.** The floor moves onto an
installer-managed repository variable, `REVIEW_INDEPENDENT_FLOOR`, wired exactly
as `route-policy` is, and the `workflow_dispatch` input is removed. The
`action.yml` warning against "consistency-minded" edits then names both inputs
rather than contrasting them. Hardcoding the floor in the lane template and
keeping the override with corrected prose were both considered and rejected —
see `design.md`.

One claim that motivated the original framing turned out to be false and is
corrected in `design.md`: an unset variable does **not** silently yield a floor
of `none`. `input()` uses `??` (`src/operations.js:30`), so an empty variable is
a present-but-empty env var that reaches `normalizeMode` and throws. The
naive wiring already fails closed. The remaining fail-open is an *absent* input
key, not an empty one, and it is closed by a test rather than by the wiring.

### Acceptance criteria

- [x] The question above is decided and recorded. Decided 2026-08-22; see above.

- [x] The wiring and the prose agree, whichever way it is decided. Covers the
      lane comment and the `action.yml` `route-policy` description, both of
      which currently describe the defect as deliberate.

      The `action.yml` sentence claiming the neighbouring inputs were
      "deliberately wired the other way" was the prose the defect had made
      false; it is rewritten in place, and both bound descriptions now say the
      same thing about the same asymmetry. The lane comment at
      `.github/workflows/sd-review.yml:21` is now the negative form — it
      explains why there is *no* input — rather than describing the input that
      used to be there. `npm run validate:metadata` passes over the rewritten
      metadata, including R-008, which is the gate that would have caught a
      `${{ … }}` expression smuggled into a description while editing it:

      ```
      Validated action.yml, 3 workflow(s), 7 example(s), and 1148 tracked
      public path(s), pinned to the current release v0.6.0.
      ```

- [x] A test pins that a dispatch input cannot lower the floor — asserting the
      lane declares no such input, not merely that the wiring reads from `vars`.

      `test/metadata.test.js:406` asserts `inputs["independent-review-floor"]`
      is `undefined` on both durable lanes, and `:463` repeats it for the
      installed descriptor's workflow. Because the metadata suite loads the
      example lanes rather than `DURABLE_TEMPLATE_PATH`, it does not on its own
      cover the blob consumers receive — mutation testing showed both mutations
      to `examples/sd-review.yml` left metadata green. The gate that does cover
      it is `test/consumer-installer.test.js:2189`, "no shipped workflow lets a
      caller supply its own review floor", which enumerates the shipped
      workflow paths from disk. All three were mutation-verified: reintroducing
      the input fails them and passes nothing.

- [x] A test pins that the lane still *passes* `independent-review-floor`. An
      absent key reaches the action's `"none"` fallback and silently unfloors
      the lane; this is the one path the variable wiring does not close.

      `test/consumer-installer.test.js:2168`, "every shipped lane that
      dispatches a review passes a repository review floor", enumerates every
      shipped workflow, selects the ones carrying a `review-request:` key, and
      requires each to wire the floor from `vars.REVIEW_INDEPENDENT_FLOOR`. It
      is a sweep rather than a fixed list, so a lane added later is covered
      without anyone remembering to add it. Mutation-verified by deleting the
      `with:` key. `test/metadata.test.js:411` pins the same key on the two
      example lanes.

Suite at the released commit: `npm test` → `tests 720 / pass 720 / fail 0`.

## Out of scope

The 21 other findings from the same review pass. For the record, so they are not
re-litigated:

- **Hyphenated names in expressions** (6 findings). False positives.
  `steps.<id>.outputs.cache-hit` is GitHub's own documented example from
  `actions/cache`; hyphenated property access via dot notation works.
- **`issue_comment` from untrusted users** (7 findings). Mitigated by
  `src/index.js:200-212`, which gates commands on `author_association` against
  a default of `OWNER,MEMBER,COLLABORATOR` (`action.yml:173`). The workflow does
  run for any non-bot comment; it cannot act on an untrusted one.
- **Fork-token and duplicate-trigger notes.** Covered by exact-head receipt
  idempotence, verified live in the v0.5.0 pilot: a replayed request produced no
  second Copilot request and did not re-stamp `dispatch.startedAt`.
- **Repo-local policy items** in `se-ai-command-pack`. Handled in that PR.
