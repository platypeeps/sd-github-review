---
title: Installer ships the discovery descriptor and the durable sd-review.yml lane
status: done
created: 2026-08-08
branch: feat/08-08-installer-durable-lane
---
# Installer ships the discovery descriptor and the durable sd-review.yml lane

## Goal

Make the consumer installer deliver both halves of the routed review contract — the discovery
descriptor and the durable `workflow_dispatch` lane.

Moving this repository's own published descriptor off the path consumers probe was originally
part of this goal; it became `08-09-descriptor-contract-path`, which shipped in PR #68 and
unblocked this task. Its output — the published descriptor at
`contract/routed-review-setup-v1.json` — is this task's install source.

## Problem

### The descriptor is installed nowhere, so the routed lane silently no-ops

`scripts/sd-ai-command-pack-review.py:31` sets
`DEFAULT_DESCRIPTOR_PATH = Path("config/routed-review-setup-v1.json")`, and when that path is
absent the probe returns `{"state":"absent","reason":"setup-descriptor-absent"}` (line 746).
Across the 19 local `platypeeps` checkouts, the 702-byte descriptor exists in exactly one
repository: `sd-github-review` itself, and there as the router's published artifact rather
than an installation. No consumer has an installed copy, so seven of the eight manifest
consumers probe absent and the routed review lane no-ops fleet-wide without erroring. The
eighth is this repository, which self-matches its own published descriptor — the separate
defect covered below.

### The installer ships the wrong workflow

`scripts/consumer-installer/codecs.mjs` lines 9-10 declare:

```
export const WORKFLOW_PATH = ".github/workflows/ai-review-router.yml";
export const TEMPLATE_PATH = "examples/pr-agent-router.yml";
```

The installer therefore copies the event-driven router into `ai-review-router.yml`. The
descriptor names a different lane entirely:

```
"workflow": { "name": "SD routed review",
              "path": ".github/workflows/sd-review.yml",
              "dispatchEvent": "workflow_dispatch" }
```

So even a consumer that somehow obtained the descriptor would find no workflow at the path the
descriptor points to. `sd-github-review-pilot`, which is not in the fleet manifest, is the
only repository carrying .github/workflows/sd-review.yml, and it has it because the file was
hand-placed — the
installer has never produced it. There is no `examples/sd-review.yml` template for it to copy.

### The published descriptor sits on the consumer discovery path

This repository publishes its descriptor at `config/routed-review-setup-v1.json` — byte-for-byte
the path `DEFAULT_DESCRIPTOR_PATH` probes for an *installed* descriptor. The router repository
therefore matches its own published artifact as though it were an installed consumer, and its
own pull requests fail review as a result. This is contract item R1 from the 2026-08-08
collaboration review.

## Requirements

- Add an `examples/sd-review.yml` template for the `workflow_dispatch` durable lane, pinned
  consistently with every other first-party reference.
- Make the installer write .github/workflows/sd-review.yml from that template, matching what
  the descriptor declares. This bullet originally said to change `WORKFLOW_PATH` and
  `TEMPLATE_PATH`; design D2 rejected that mechanism, because repointing the constants removes
  the event-driven lane every existing consumer relies on and orphans every live manifest on
  four separate exact-equality checks. The durable lane is added alongside the existing one
  instead. The outcome this bullet asks for is unchanged.
- Have the installer write the discovery descriptor into each consumer at
  `config/routed-review-setup-v1.json`, with the consumer-facing values the probe expects.
- ~~Move this repository's own published descriptor off the consumer discovery path (contract
  item R1).~~ **Split out into `08-09-descriptor-contract-path`;** this task is `blockedOn` it
  and consumes its output as the install source. See design D1.
- Keep the installer idempotent: a second run against an already-installed consumer must be a
  no-op rather than a duplicate write.

## Acceptance Criteria

- [x] A fresh install into a scratch repository produces both
      `config/routed-review-setup-v1.json` and .github/workflows/sd-review.yml.
      Verified end to end with this repository as the installer source root: both files land,
      byte-identical to `contract/routed-review-setup-v1.json` and `examples/sd-review.yml`.
- [x] The installed workflow's path equals the `workflow.path` the installed descriptor
      declares — asserted by a test, not by inspection. Two tests: one reads the descriptor a
      real install wrote into the consumer, one binds `DURABLE_WORKFLOW_PATH` and the template's
      `name:` to the published descriptor. Mutating the template's `name:` fails the second.
- [x] Running the probe against that scratch repository returns a state other than
      `absent`/`setup-descriptor-absent`. **Local half only; the live half is deferred to
      `08-08-fleet-rollout-smoke`.** Once the descriptor exists the probe continues to GitHub
      workflow metadata and only succeeds after validating the active path and name
      (`sd-ai-command-pack-review.py:797-816`), which needs a live registered workflow this task
      does not produce. Measured against an installer-provisioned scratch consumer:
      `{'state': 'unavailable', 'reason': 'failed to read routed-review workflow metadata: gh:
      Not Found (HTTP 404)'}` — past the descriptor, stopped at the live lookup, exactly as
      design D5 predicted. No green probe is claimed.
- [x] Running the probe against `sd-github-review` itself no longer matches this
      repository's own published descriptor. **Delivered by
      `08-09-descriptor-contract-path` (PR #68),** which owns the descriptor move;
      reconfirmed live here, on every review-coordinator run against this branch:
      `routerCapability: {state: "absent", reason: "setup-descriptor-absent"}`.
- [x] A repo-wide grep shows no producer still writing this repository's own published
      descriptor to the discovery path. **Delivered by `08-09-descriptor-contract-path`;**
      reverified at this head: five remaining `config/routed-review-setup-v1.json` hits, all
      readers or the consumer *destination* constant — `sd-ai-command-pack-review.py:31`
      (`DEFAULT_DESCRIPTOR_PATH`), `sd-ai-command-pack-review-local.py:274,323`, and
      `codecs.mjs:23,130`. `config/routed-review-setup-v1.json` is absent from this
      repository and `contract/routed-review-setup-v1.json` is present. The inverse now
      holds here: the installer *does* write `config/routed-review-setup-v1.json` into
      consumers, which is correct and expected.
- [x] A second installer run against an already-installed repository reports no change —
      an empty `actions` array and no filesystem writes, not merely no additional GitHub calls.
      The existing idempotency test was strengthened to assert both, and it fails against the
      pre-D4 code. Mutating the predicate to the naive hash-only form fails six tests including
      the provider/model change and the source-commit advance, which is the evidence that
      conditions 1-3 are load-bearing rather than decorative.
- [x] The event-driven lane is unchanged: a fresh install still produces
      .github/workflows/ai-review-router.yml from `examples/pr-agent-router.yml`, and existing
      schema-1 and schema-2 manifests still decode. `WORKFLOW_PATH`, `TEMPLATE_PATH`,
      `examples/pr-agent-router.yml`, and `HISTORICAL_TEMPLATE_HASHES` are untouched. Gating
      provenance on `=== MANIFEST_SCHEMA_VERSION` instead of `>= 2` fails the schema-2
      provenance test, which is the evidence the D3a split is real.
- [x] `npm test` stays at 0 failures: 634 passing / 0 failing, up from the 608/0 baseline
      measured on this branch's parent. Coverage, `check`, `validate:metadata`, and
      `validate:ci-parity` all pass.

## Notes

Sequence after `08-08-release-v0-3-0-pin-freshness`: the new `examples/sd-review.yml` template
carries a first-party pin, and shipping it before the pin advance would bake v0.1.0 into the
one workflow the whole fleet is about to receive.
