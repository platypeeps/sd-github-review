# Design — gate the release tag/commit pair published in setup prose

## The decision the PRD left open

The PRD offered "verify the pair" and "forbid the pairing". Neither survives
contact with criterion 4 in its stated form, and the reason points at a third
shape that does.

**Verify the pair** cannot run where the defect is authored. The pin-advance
commit names a tag that does not exist until the commit is tagged, so
`rev-parse v0.6.1^{commit}` fails at exactly the moment the author needs the
answer. Making the gate release-time only — the `SD_RELEASE_TAG` shape — moves
the check downstream of the mistake and leaves the pin-advance commit green,
which is how `0.4.0` shipped the defect in the first place.

**Forbid every tag in Markdown** over-reaches. `--source-tag` is a flag whose
purpose is to take a tag; a blanket ban forbids documenting it.

## Chosen shape: forbid the literal *pair*, not either half

The rule:

> No tracked Markdown **fenced code block or paragraph** may place a literal
> `v<semver>` and a literal 40-character commit of this repository together.

**Not line-scoped, and that is load-bearing.** The defect currently sits on one
line, which makes a line rule look sufficient. It is not. The example is a
`\`-continued shell command in which every other flag already occupies its own
line:

```sh
node scripts/install-consumer.mjs install --target /path/to/consumer \
  --route-mode copilot \
  --review-floor copilot \
  --source-tag v0.6.1 --source-commit 6ba1eff049962faded1c289f666ef56b58c61b4d \
```

Splitting `--source-tag` and `--source-commit` onto separate lines is the
natural next formatting edit, and under a line rule it would silently turn the
gate off while leaving the false pair published. A gate that a routine reflow
disables is worse than none, because it also reports green. The block is the
unit a reader perceives as one command, so it is the unit the rule uses.

Either half alone is fine. `--source-tag v0.6.1` documents the flag. A bare pin SHA
stays governed by `assertProseCommitReferences`. Only the *conjunction* — the
thing that can be false — is refused.

Three properties follow, and each maps to a criterion:

- **It needs no tag to exist** (criterion 4). Absence-checking is decidable in
  the pin-advance commit, where verification is not. This is the same reasoning
  `assertNoReleaseTagLabels` already records for lanes: checking for absence
  "needs no knowledge of which tag would have been correct — which is what makes
  it drift-proof."
- **It resolves the `assertProseCommitReferences` tension** (criterion 3) rather
  than exempting a file. The corrected example carries no literal SHA at all, so
  the prose-SHA gate has nothing to judge and the honest form becomes
  expressible. The tension existed only because the example hardcoded one
  release's identity into a copy-paste command.
- **It fixes the class, not the instance.** `0.4.0`'s recurrence is the evidence
  that instance-fixes do not hold here.

## The documentation change this forces

`SETUP-PR-AGENT.md:164` stops publishing one release's identity:

```sh
  --source-tag vX.Y.Z --source-commit <the commit that tag resolves to> \
```

The example's job is to show the flag's shape. Which release an operator is
installing is something they know and git can tell them; freezing it into prose
is what created a value that has to be hand-maintained in every pin-advance
commit and has been wrong at least twice.

Consumers lose nothing, and this was checked rather than assumed. The same
document publishes the real installation reference independently at
`SETUP-PR-AGENT.md:314` — "`6ba1eff049962faded1c289f666ef56b58c61b4d`. Keep that
exact pin" — with no tag beside it, so it passes the new gate unchanged and stays
governed by `assertProseCommitReferences`. Line 164 was a second, hand-maintained
copy of an identity the document already carries correctly.

## Placement and seams

`assertReleasePairReferences` in `scripts/validate-action-metadata.mjs`, beside
`assertProseCommitReferences` (line 1284) and sharing both its seams:

- `listDocuments` — the tracked-Markdown set, `.trellis/` excluded for the
  reason already recorded there: archived task records are a historical account,
  not consumer instructions. **This task's own notes will contain the false pair
  verbatim**, so without that exclusion the gate would fail on its own evidence.
- `isCommit` — `git rev-parse --verify --quiet <sha>^{commit}`, so a 40-hex
  token that is not a commit of this repository (DESIGN.md's `0000…0001` scope
  digests, `aaaa…` fixtures) is ignored exactly as it is today.

Reusing both seams means the gate inherits the fixture behaviour the existing
tests already depend on, and adds no new way for a document to escape by being
unlisted.

`CHANGELOG.md` is **not** excluded, matching `assertProseCommitReferences`. A
changelog is where upgrade instructions live. Historical pairs there must use
the abbreviated SHA form, which is the conventional notation for a historical
reference and is already the stated rule.

## Failure message

Criterion 1 asks for the commit the tag resolves to. That is available when the
tag exists and absent when it does not, so the message is conditional:

```
SETUP-PR-AGENT.md:160-166: publishes a release tag beside a literal commit
  tag:    v0.6.1  (resolves to ee1a1628ab4402595a045b67ebe2f00a314e586a)
  commit: 6ba1eff049962faded1c289f666ef56b58c61b4d
a published example must not hardcode one release's identity; the pair has to be
hand-maintained in every pin advance and has been wrong before. Use a placeholder.
```

When the tag does not resolve, the parenthetical reads `(no such tag yet)` and
the gate still fails — the point is that the pair is unverifiable at authoring
time, which is precisely why it must not be written.

Naming the resolved commit when it is known matters: it is the difference
between "this is wrong" and "this is wrong and here is what you meant."

## Compatibility and rollout

No consumer-visible change. `action.yml`, `src/`, contract, descriptor, and every
lane blob are untouched, so no pin moves and no consumer needs to take anything.
The gate runs in `validate:metadata`, which is already in `check:full` and CI.

Rollback is deleting the assertion and reverting one Markdown line. There is no
state, no migration, and nothing recorded in a manifest.

## Risk

The gate fires on every existing tag/SHA pair in tracked Markdown, not only the
one this task found. That surface was unknown, so it was enumerated during
planning rather than assumed: across every tracked Markdown file outside
`.trellis/`, exactly one block pairs a `v<semver>` with a token `git rev-parse`
confirms is a commit of this repository — `SETUP-PR-AGENT.md:164` itself.

The risk is therefore retired, not carried. The gate lands failing on one known
line rather than on an unmeasured pile, and no exclusion needs widening. Had the
enumeration turned up legitimately historical pairs, the exclusion rule above
would have been the lever, and widening it would have needed a stated reason per
document rather than a blanket skip.
