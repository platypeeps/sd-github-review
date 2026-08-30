---
title: Gate the release tag/commit pair published in setup prose
status: done
created: 2026-08-23
branch: feat/gate-release-tag-pair
---
# Gate the release tag/commit pair published in setup prose

## Problem

`SETUP-PR-AGENT.md:164` publishes this to consumers:

```sh
--source-tag v0.6.1 --source-commit 6ba1eff049962faded1c289f666ef56b58c61b4d
```

Git disagrees. `v0.6.1` resolves to `ee1a1628ab4402595a045b67ebe2f00a314e586a`;
`6ba1eff` is only an *ancestor* of it. The pair names a tag and a commit that do
not correspond.

The installer itself proves which value is right. This repository's own
`.github/sd-github-review.json`, written by a real git-resolved install rather
than by hand, records:

```json
"source": { "commit": "ee1a1628ab4402595a045b67ebe2f00a314e586a", "tag": "v0.6.1", "released": true }
```

So an operator who follows the published command records provenance that
contradicts what the installer records for the same release. The manifest is
documented as "an offline identity record for honest installs"; this makes it
dishonest by instruction.

## Why it keeps happening

This is not carelessness, and a fix that assumes it was will not hold.

`git log -L164,164` shows that line rewritten in every pin-advance commit —
`ee1a162` (#139), `0d298aa` (#134), `0e58e76` (#125), `09efa5e` (#115). The
release checklist requires the pin advance to be committed *before* the tag is
cut, and the tag is then cut on that commit. At the moment an author edits line
164 they are inside the commit being tagged: the tag does not exist yet, and a
commit cannot contain its own SHA. The only SHA available to write is the
previous one.

**The false pair is structurally induced by the release procedure.** Every
release reproduces it. `0.4.0` shipped this exact defect once already —
CHANGELOG:285 records `SETUP-PR-AGENT.md` printing `--source-tag v0.4.0` beside
a SHA it called `v0.3.0`. That instance was corrected by rewording; the class
was never gated.

## Why the existing gates miss it, and actively push toward it

Two gates cover the neighbourhood and neither closes it:

- `assertNoReleaseTagLabels` (`scripts/validate-action-metadata.mjs:239`) bans a
  version tag appearing beside a pin. It is called only at lines 985 and 1041 —
  the shipped workflow and the examples. **YAML only.** Its own comment states
  that Markdown is `assertProseCommitReferences`' job.
- `assertProseCommitReferences` (line 1284) checks Markdown SHAs, but only that
  each equals the current first-party pin. `6ba1eff` *is* the current pin, so it
  passes.

Their composition is worse than either gap alone. If an author corrected line
164 to the honest `ee1a162`, `assertProseCommitReferences` would **fail** it —
`ee1a162` is a real commit of this repository and is not the pin. The existing
gate makes the true pair unshippable and the false pair green. Any fix must
resolve that tension rather than add a third check on top of it.

## Scope

In scope:

- One gate that refuses a published tag/commit pair git does not agree with.
- Whatever change to `SETUP-PR-AGENT.md:164` the gate then requires.
- Resolving the conflict with `assertProseCommitReferences` so the honest form
  is expressible.

Out of scope:

- The four consumer pull requests held behind the expired Socket key.
- The two unmanaged `issues: write` grants (`hoa-manager` `ci.yml:360`,
  `anomaly-metric-creator` `ci.yml:662`).
- Any change to what the installer records. The manifest is already correct.

## Acceptance criteria

1. A gate fails on the pair currently published at `SETUP-PR-AGENT.md:164`, and
   the failure message names the file, the location, the tag, and the commit it
   was paired with. It also names the commit the tag resolves to **when the tag
   exists**; in the pre-tag window it says so explicitly rather than omitting the
   field. The gate fails in both cases — an unverifiable pair is exactly what is
   being refused, so "cannot check yet" must not read as "passed".
2. The gate is proven by mutation before being believed: it must be shown
   failing on a known-bad pair and passing on a known-good one, per this
   repository's standing practice for new gates.
3. `SETUP-PR-AGENT.md` publishes a tag/commit relationship that `git rev-parse`
   confirms, and `npm run validate:metadata` passes on the corrected file —
   demonstrating the `assertProseCommitReferences` tension is resolved, not
   worked around by exempting the file.
4. The gate survives the release procedure that induces the defect: it must be
   runnable, and must give the right answer, at the point in
   `docs/RELEASE_CHECKLIST.md` where the pin advance is authored — when the tag
   being named does not yet exist. A gate that can only pass after tagging
   relocates the problem instead of closing it.
5. No consumer-visible behaviour changes. This is a documentation-correctness
   gate; `action.yml`, `src/`, and the lane blobs are untouched.

## Open question for the design

Criterion 4 admits two shapes and the design must choose deliberately:

- **Verify the pair** — assert `rev-parse <tag>^{commit} == <sha>`. Honest, but
  unsatisfiable in the pin-advance commit where the tag does not yet exist,
  unless the gate is release-time only, like the `SD_RELEASE_TAG` form.
- **Forbid the pairing** — extend `assertNoReleaseTagLabels` to Markdown, so no
  document names a tag beside a SHA at all. This is the rule the repository
  already settled on for lanes: "the SHA is the installation reference, the tag
  is for discovery." It needs no knowledge of which tag is correct, which is what
  the existing comment calls drift-proof.

The second is cheaper and matches the established rule, but `--source-tag` is a
CLI flag whose *purpose* is to name a tag, so a blanket ban on tags in Markdown
would forbid documenting the flag at all. The design must say how it
distinguishes a flag's example value from a pin label.
