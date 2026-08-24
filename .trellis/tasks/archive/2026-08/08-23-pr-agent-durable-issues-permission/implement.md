# Implement — drop the dead `issues: write` grant

Baseline: `0.6.0`, `main` at `b38c485`. Target: `0.6.1`.

Ordered so the lanes are corrected before the gate that pins them, because the
gate cannot be written against the current over-grant — see `design.md`.

## Phase 0 — baseline

- [x] `npm run check:full` on a clean tree. Record the test count; every later
      phase compares against it, not against zero failures.
- [x] Record the current permission facts by enumeration, so the later sweep has
      something to be checked against:
      `grep -rn 'issues: write' examples/ .github/workflows/` → expect 8.

**Rollback point.** Nothing changed.

## Phase 1 — remove the dead grant

- [x] Remove `issues: write` from every shipped lane. Enumerate from the
      filesystem; do not work from the list in `prd.md`. Known at planning time:
      `examples/sd-review.yml` (review, finalize), `examples/pr-agent-router.yml`
      (top level), `examples/pr-agent-on-demand-review-router.yml` (two jobs),
      `.github/workflows/sd-review.yml` (two jobs),
      `.github/workflows/ai-review-router.yml` (top level).
- [x] `examples/sd-review.yml` and `.github/workflows/sd-review.yml` must stay
      byte-identical. They are today (`371675e0…`); a test asserts it.
- [x] Rewrite the `pr-agent` job's isolation comment. It currently reads "no
      `checks:write` and no `issues:write`, so the token handed to the
      third-party container cannot write durable receipts" — after this change,
      naming `issues: write` as part of the isolation is misleading, because no
      job has it. The isolation that matters is `checks: write`. Say that.
- [x] `npm run validate:metadata`. `assertJobPermissions` is a lower bound over
      jobs that run this action; if any of them genuinely needed `issues`, this
      is where it surfaces, naming the job. **Expect it to pass** — if it fails,
      stop: the premise is wrong and the finding must be re-examined, not
      worked around by restoring the grant.
- [x] `npm run check:full`.

**Rollback point.** Revert Phase 1; nothing outside this repository changed.

## Phase 2 — the gate that keeps it from drifting back

- [x] Add the descriptor-anchored set-equality gate to
      `scripts/validate-action-metadata.mjs`. Resolve the lane from the
      descriptor's own `workflow.path` (`setupDescriptorPath`, read at line
      255); do not list lanes. Reuse `permissionMap` and `grantedLevel` rather
      than re-resolving `write-all`/inheritance a second way.
- [x] Failure message must name the offending scope **and its direction** —
      lane-grants-but-descriptor-omits, or descriptor-declares-but-no-job-grants.
      A message that only says "mismatch" makes the next drift a debugging task.
- [x] Add the all-lanes sweep: no shipped lane grants `issues: write`,
      enumerated via `laneDocuments()`. Sweep, not a fixed list.
- [x] **Mutation proof, both directions, before believing either gate:**
      - restore `issues: write` to one lane job → both gates fail;
      - add a scope to `requiredPermissions` that no job grants → equality gate
        fails;
      - remove `checks: write` from the descriptor → equality gate fails.
      Revert each. A gate first observed passing has proven nothing.
- [x] Unit tests at the gate's seam, following `R-008`'s shape in
      `test/metadata.test.js`: assert the thrown message, and assert the fixture
      genuinely carries the drift (`assert.notEqual(drifted, original)`) so a
      mis-anchored fixture cannot make the test vacuous.
- [x] `npm run check:full`. Count strictly greater than Phase 0.

## Phase 3 — the documentation that taught consumers to over-grant

- [x] `SETUP-PR-AGENT.md:333` — "`issues: write` and `pull-requests: write`
      allow PR-Agent to publish its conversation comment". Replace with what
      actually covers it, and say so specifically: on a pull request, both the
      conversation-comment and label endpoints are covered by
      `pull-requests: write`, even though both are `/issues/...` paths in the
      REST API. That REST-path/permission-scope mismatch is the whole reason
      this was believed, so name it rather than just deleting the sentence.
- [x] `SETUP-PR-AGENT.md:329` and `:359` — the permission blocks a reader
      copies. These are the lines that actually cause the over-grant.
- [x] `DESIGN.md:447-449` — currently explains the lane/descriptor asymmetry as
      intentional. The asymmetry is gone; the passage should now record why it
      existed and what settled it, so the next reviewer does not re-file it.
- [x] Sweep for any other place that states the grant is required. Enumerate
      with a repo-wide grep rather than trusting these three line numbers.
- [x] CHANGELOG entry. It must correct the record: `0.6.0`'s entry says the
      fleet reviewer's `issues: write` finding was a false positive. It was
      *directionally inverted*, not false — the reviewer saw a real asymmetry
      and named the wrong side. Say that plainly rather than quietly reversing.

## Phase 4 — release `0.6.1`

Patch, not minor: no contract, schema, or input changes. Follow
`docs/RELEASE_CHECKLIST.md` §5 ordering exactly, as `0.6.0` did.

- [x] Bump `package.json`; CHANGELOG; cut the pin-advance commit touching
      neither `src/` nor `action.yml`; tag on the pin advance; never force-move
      a published tag.
      Pin-advance commit `ee1a162` (PR `#139`). `v0.6.1` resolves to
      `ee1a1628ab4402595a045b67ebe2f00a314e586a` — the pin advance, as required.
      Tag was cut once and never moved.
- [x] `npm run validate:release`; verify from a worktree at the tag, not `main`.
      Verified from a worktree checked out at `v0.6.1`, not from `main`.
- [x] Publish the release.
      Published 2026-08-23T18:25:54Z, `isDraft: false`, target `main`.

## Phase 5 — the credentialed confirmation, if approved

**Closed 2026-08-23 as handed off, not done.** Owner approval was never given,
so the phase never opened, and this task is being archived rather than held
open waiting for a decision that has no forcing date. The five items below are
carried verbatim into
`.trellis/tasks/08-23-pr-agent-reduced-grant-live-confirmation/`, parked, with
the unpark trigger stated there: **any consumer moving off `copilot`**. They
are left unticked here because they were not done.

**Status as of 2026-08-23: not started. Owner approval has not been given, so
the phase never opened.** Phase 6 proceeded without it, which this phase's own
text authorizes: the fleet is installed `REVIEW_ROUTE_MODE=copilot` with
`REVIEW_INDEPENDENT_FLOOR=copilot`, so `cheap` and `deep` are unreachable and
the `pr-agent` job cannot execute on any consumer. `prd.md`'s fourth criterion
is therefore **unmet, not waived**, and the residual is recorded in the
CHANGELOG for whoever moves a consumer off `copilot`.

**Reordered ahead of the fleet by the planning review.** The first draft rolled
the narrowing change to nine consumers and *then* confirmed it. That is the
wrong order for a change whose failure mode is "a job that needed the scope
lost it": confirmation after rollout tells you which nine repositories to go
fix. There is no ordering hazard forcing the reverse, unlike D2's variable.

**Gated on owner approval under `docs/RELEASE_CHECKLIST.md` §2. Do not start
this phase without it, and do not treat the permission probes as a substitute.**

If approval is withheld, skip to Phase 6 and roll anyway, recording the
criterion unmet and the residual explicitly. That is defensible here for one
specific reason, which must be stated rather than assumed: the fleet is
installed `REVIEW_ROUTE_MODE=copilot` with `REVIEW_INDEPENDENT_FLOOR=copilot`,
so `cheap` and `deep` are unreachable and the `pr-agent` job cannot execute on
any consumer. The change is inert for the fleet as configured. It stops being
inert the moment any consumer moves off `copilot`, so the residual belongs in
the CHANGELOG where an operator making that change will meet it.

- [ ] Bring `platypeeps/sd-github-review-pilot` to the released lane. Its
      `sd-review.yml` is currently pinned to `f6b5388d` in an older single-job
      shape with a top-level `issues: write` and no isolated `pr-agent` job —
      it cannot exercise the isolation as shipped.
- [ ] Set the pilot's `REVIEW_ROUTE_MODE` and `REVIEW_INDEPENDENT_FLOOR` so
      `cheap` is reachable. This is the step that makes spend possible; be
      deliberate about it.
- [ ] Confirm `ai-review-router.yml.disabled` stays disabled before opening the
      smoke pull request, and afterwards verify it has no run newer than the
      pilot's first. §2 calls that the check worth quoting.
- [ ] Dispatch `route` with an explicit `route: "cheap"`. Observe whether
      PR-Agent's conversation comment posts under the reduced grant.
- [ ] Record the outcome against `prd.md`'s fourth criterion — met, or unmet
      with the reason. Do not mark it met from the probes alone.

## Phase 6 — fleet

No variable to set first, so no ordering hazard — unlike D2. Canary first
regardless.

- [x] **This repository's own install first.** It is an installer-managed
      consumer of itself, so the lane edits already put
      `.github/sd-github-review.json` out of convergence —
      `node scripts/install-consumer.mjs check` reports both workflows differing
      from their managed hashes. That cannot be fixed before the release,
      because the manifest records a released source commit and tag; it is the
      same post-release step `#135` was for `0.6.0`, not a defect in the change.
      Done as `#140`, merged. This repository's own `sd-review.yml` now carries
      the `6ba1eff` pin and zero `issues: write`.
- [x] Canary one consumer, verify, then `update` the remaining eight.
      Canary was `people-profiles#14`: CI green, Copilot clean, router logged
      `Selected copilot for PR #14`, merged with zero grants on `main`. The
      remaining eight were then updated and opened as pull requests. Four of
      those are merged; four are held — see the final item of this phase.
- [x] Expect the same consumer-local gates as last time: `docs/repomix-map.md`
      staleness in `hoa-manager` and `mezmo_benchmark`, and the
      `Tooling/generated scope:` line in the `hoa-manager` body. A body edit
      does not clear the latter — `gh run rerun` replays the stored event
      payload, so the branch needs a fresh push.
      Both recurred as predicted. The `Tooling/generated scope:` line was
      supplied in the `hoa-manager#286` body, and five of six consumer
      templates turned out to enforce a scope declaration, not just
      `hoa-manager`.
- [x] Expect the Copilot reviewer to raise the stderr `::error::` annotation
      finding again on any consumer reading the guard step. It is false and was
      settled on 2026-08-23 by probe run 32618129997; the evidence is in
      `.trellis/tasks/archive/2026-08/08-22-fleet-reviewer-v050-defects/implement.md`.
      Did not recur. Copilot returned no findings on `#140` or on the canary
      `people-profiles#14`. The prediction was defensive and cost nothing.
- [x] After merge, verify from each default branch that all nine carry the new
      lane blob and pin, and that none grants `issues: write`. Enumerate from
      GitHub; do not restate the install run.
      **Met — 9 of 9.** Enumerated from each default branch's
      `.github/workflows/sd-review.yml` after the final merges on 2026-08-24:

      | repository | pin | `issues: write` |
      | --- | --- | --- |
      | `platypeeps/sd-github-review` | `6ba1eff` | 0 |
      | `platypeeps/people-profiles` | `6ba1eff` | 0 |
      | `platypeeps/loadsmith` | `6ba1eff` | 0 |
      | `answerbook/mezmo_benchmark` | `6ba1eff` | 0 |
      | `platypeeps/se-ai-command-pack` | `6ba1eff` | 0 |
      | `platypeeps/hoa-manager` | `6ba1eff` | 0 |
      | `platypeeps/rwbp-website` | `6ba1eff` | 0 |
      | `platypeeps/rwbp-coordinator` | `6ba1eff` | 0 |
      | `platypeeps/anomaly-metric-creator` | `6ba1eff` | 0 |

      The four laggards — `hoa-manager#286`, `rwbp-website#266`,
      `rwbp-coordinator#258`, `anomaly-metric-creator#403` — merged at
      2026-08-24T00:55-00:56Z once their Socket scans passed.

      **The Socket diagnosis recorded here earlier was wrong, and the
      correction matters more than the fix.** This box previously read "the
      cause is an expired `SOCKET_SECURITY_API_KEY`" and said it would close
      when the key was refreshed. No key was refreshed. Re-running the failed
      jobs unchanged turned all four green, and the secrets' GitHub metadata
      still reports `updated_at=2026-06-16` on every one of the four
      repositories -- never rotated since creation. The `401 APIAccessDenied`
      was a transient fault on Socket's side.

      The reasoning that produced the wrong call is worth keeping: the key
      demonstrably worked at 04:22 and failed by 20:52 with no workflow change
      between, which does imply something changed outside the repository -- but
      "expired credential" and "provider outage" both fit that evidence, and
      only the first was considered. The cheap discriminator was a retry, and it
      was available from the start. Prefer it before diagnosing credential
      expiry from an authentication error next time.

      Two `issues: write` grants found on the way are **out of scope and still
      live**: `hoa-manager` `ci.yml:360` and `anomaly-metric-creator`
      `ci.yml:662`, both in hand-maintained Socket scan jobs the installer does
      not manage. Re-verified present after the merges. The table above measures
      the installer-managed lane only, so "0" there is not a claim about these.

## Validation commands

```bash
npm run check:full
npm test
npm run validate:metadata
npm run validate:release      # Phase 4 only
shasum -a256 contract/routed-review-setup-v1.json config/routed-review-setup-v1.json
grep -rn 'issues: write' examples/ .github/workflows/    # expect no output after Phase 1
```

## Standing constraints

- No provider credential reaches any consumer. Phases 0–5 involve none; the
  credential exists only on the pilot repository and only as an Actions secret,
  and Phase 6 is the only phase that can spend.
- `checks: write` isolation between the receipt jobs and `pr-agent` is
  load-bearing and unchanged. If any step of this work would give `pr-agent`
  `checks: write`, stop — that is the isolation the whole durable design rests
  on.
