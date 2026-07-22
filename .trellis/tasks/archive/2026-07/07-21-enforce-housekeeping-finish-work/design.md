# Design

## Problem

`sd-housekeeping` tells the agent to run `sd-finish-work` before invoking the
housekeeping script, but the script can merge a ready PR without evidence that
the preceding lifecycle step occurred. During the initial backlog run this
happened twice, leaving completed Trellis tasks outside the delivery PR and
forcing separate bookkeeping PRs.

## Boundary

Add an explicit `--finish-work-head <oid>` attestation to the housekeeping
shell command. The option is consumed only by the auto-merge gate:

- a ready open feature-branch PR without an exact current-head value, or with a
  stale one, is left open and produces an actionable anomaly;
- the same PR with the current head continues through all existing head, checks,
  review-thread, and mergeability gates;
- an already-merged branch or default-branch cleanup does not require the flag.

The option is not a replacement for finish-work. It is a narrow handoff from the
agent-owned lifecycle step to the deterministic merge executable. The skills
must state that it is valid only after finish-work completed and any resulting
commits were pushed and checks refreshed.

## Regression Boundary

Extend the script's hermetic self-test with explicit attested and un-attested
green fixtures. Add a repository-owned Node test that requires the installed
self-test to report the un-attested refusal scenario. The second test is
intentionally outside the pack receipt so a later pack refresh cannot silently
replace both the implementation and its assertion.

## Compatibility and Rollback

Direct callers that previously used housekeeping to auto-merge must first run
finish-work and pass the resulting exact head. Cleanup-only invocations remain compatible.
Rollback is a single cohesive revert of the script, skills, guide, and test.
Because the installed files are pack-owned, a later pack update may overwrite
the local implementation; the repository-owned contract test makes that drift
visible until the change is propagated upstream.

## Provenance

The local override updates `.sd-ai-command-pack/provenance.json` with a build
metadata version, the base pack version, a human-readable override summary,
and the reviewed hashes of every changed pack-owned target. This keeps the
install audit meaningful: it vouches the bytes actually reviewed in this repo
without claiming they are unchanged upstream `0.30.4` content.
