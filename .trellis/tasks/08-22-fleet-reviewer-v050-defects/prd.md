# Close the two v0.5.0 defects the fleet reviewer found

Both were found by the newly installed review lane reviewing its own install
pull requests across the eight fleet consumers on 2026-08-22. Neither affects an
installed lane at runtime, which is why the rollout merged ahead of them.

## D1 — the descriptor under-declares required permissions

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

### Acceptance criteria

- [ ] `requiredPermissions` is the union of what the shipped lanes actually
      request, derived by enumeration rather than restated by hand.
- [ ] A gate fails when a lane requests a permission the descriptor omits, and
      when the descriptor declares one no lane requests.
- [ ] The gate is proven by mutation: removing `issues: write` from the
      descriptor must fail it.
- [ ] Both descriptor copies stay byte-identical.

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
- [ ] The wiring and the prose agree, whichever way it is decided. Covers the
      lane comment and the `action.yml` `route-policy` description, both of
      which currently describe the defect as deliberate.
- [ ] A test pins that a dispatch input cannot lower the floor — asserting the
      lane declares no such input, not merely that the wiring reads from `vars`.
- [ ] A test pins that the lane still *passes* `independent-review-floor`. An
      absent key reaches the action's `"none"` fallback and silently unfloors
      the lane; this is the one path the variable wiring does not close.

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
