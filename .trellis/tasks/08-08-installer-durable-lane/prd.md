# Installer ships the discovery descriptor and the durable sd-review.yml lane

## Goal

Make the consumer installer deliver both halves of the routed review contract — the discovery
descriptor and the durable `workflow_dispatch` lane — and move this repository's own published
descriptor off the path consumers probe.

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
- Change `WORKFLOW_PATH` and `TEMPLATE_PATH` in `scripts/consumer-installer/codecs.mjs` so the
  installer writes .github/workflows/sd-review.yml from that template, matching what the
  descriptor declares.
- Have the installer write the discovery descriptor into each consumer at
  `config/routed-review-setup-v1.json`, with the consumer-facing values the probe expects.
- Move this repository's own published descriptor to a path that is not the consumer discovery
  path, and update every producer and validator that reads it — at minimum
  `scripts/validate-action-metadata.mjs`, `test/metadata.test.js`,
  `test/operation-contract.test.js`, `README.md`, `DESIGN.md`, `SETUP-COPILOT.md`,
  `SETUP-PR-AGENT.md`, and `.trellis/spec/backend/consumer-installer.md` (contract item R1).
- Keep the installer idempotent: a second run against an already-installed consumer must be a
  no-op rather than a duplicate write.

## Acceptance Criteria

- [ ] A fresh install into a scratch repository produces both
      `config/routed-review-setup-v1.json` and .github/workflows/sd-review.yml.
- [ ] The installed workflow's path equals the `workflow.path` the installed descriptor
      declares — asserted by a test, not by inspection.
- [ ] Running the probe against that scratch repository returns a state other than
      `absent`/`setup-descriptor-absent`.
- [ ] Running the probe against `sd-github-review` itself no longer matches this repository's
      own published descriptor.
- [ ] `grep -rn "config/routed-review-setup-v1.json"` over tracked non-`.trellis` files shows
      no producer still writing this repository's published descriptor to the discovery path.
- [ ] A second installer run against an already-installed repository reports no change.
- [ ] `npm test` stays at 0 failures (595 passing before this change).

## Notes

Sequence after `08-08-release-v0-3-0-pin-freshness`: the new `examples/sd-review.yml` template
carries a first-party pin, and shipping it before the pin advance would bake v0.1.0 into the
one workflow the whole fleet is about to receive.
