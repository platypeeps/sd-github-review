# Implementation plan — gate the release tag/commit pair in setup prose

## Phase 0 — enumerate before changing (done during planning)

- [x] Enumerate every tracked Markdown line pairing a `v<semver>` with a
      40-hex token that `git rev-parse --verify --quiet <sha>^{commit}`
      confirms. `.trellis/` excluded.

      Result: **exactly one** — `SETUP-PR-AGENT.md:164`, `6ba1eff049…`. This is
      the measurement `design.md`'s risk section records as taken during
      planning: the unknown-surface risk is retired, not carried. No exclusion
      rule needs widening, and the gate lands failing on exactly one known line
      rather than on an unmeasured pile.

## Phase 1 — the gate

Written before the documentation fix, so it is seen failing on the real defect
rather than on a fixture built to match it.

- [x] Add `assertReleasePairReferences` to
      `scripts/validate-action-metadata.mjs`, beside `assertProseCommitReferences`
      (line 1284). Reuse both existing seams — `listDocuments` and `isCommit` —
      rather than introducing parallel ones; the fixture behaviour the current
      tests depend on comes from those seams.
- [x] Rule: fail when one **fenced code block or paragraph** carries both a
      literal `v<semver>` and a 40-hex token that `isCommit` confirms is a
      commit of this repository. Either alone passes. Block-scoped, not
      line-scoped — see `design.md`; a line rule is disabled by a routine
      `\`-continuation reflow of the very example this task fixes.
- [x] `export` it. `assertProseCommitReferences` is currently internal, which is
      why it has no direct tests; the new gate must be drivable through its
      seams so the mutation proof in Phase 2 does not need a temp git repository.
- [x] Message per `design.md`: file, block location, tag, its resolved commit when the tag
      exists, `(no such tag yet)` when it does not, and the paired commit. It
      must fail in both cases — an unverifiable pair is the thing being refused.
- [x] Wire it into `validateMetadata` beside the existing prose gate.

## Phase 2 — prove the gate before believing it

This repository's standing rule is that a gate is proven by mutation before it
is trusted. Two of the four cases below are the ones that would let the defect
through if the rule were written slightly wrong.

- [x] Fails on a tag paired with a real commit — the live defect.
- [x] Fails on the same pair **split across two lines** inside one fenced block.
      This is the case a line-scoped rule passes, and the reflow that produces it
      is the most likely future edit to this example. If this test is dropped,
      the gate silently reverts to the rule the design rejected.
- [x] Passes on a tag alone (`--source-tag vX.Y.Z` with no SHA). If this fails,
      the gate forbids documenting the flag and the design is wrong.
- [x] Passes on a real commit alone — still `assertProseCommitReferences`' job,
      not this gate's.
- [x] Passes on a tag beside a 40-hex token that is **not** a commit of this
      repository (`DESIGN.md`'s `0000…0001`, `aaaa…`). This is the case that
      distinguishes a genuine pair from a fixture, and it is the one a naive
      regex gets wrong.
- [x] Run each assertion against a deliberately broken implementation first;
      an assertion never seen red proves nothing.

## Phase 3 — the documentation fix

- [x] Rewrite `SETUP-PR-AGENT.md:164` to the placeholder form from `design.md`:
      `--source-tag vX.Y.Z --source-commit <the commit that tag resolves to>`.
- [x] Confirm the surrounding prose still explains where an operator gets the
      real values — the example no longer supplies them. Add that sentence if it
      is not already there; the fix must not trade a wrong answer for no answer.
- [x] `npm run validate:metadata` passes. This is criterion 3: it demonstrates
      the `assertProseCommitReferences` tension is resolved by removing the
      literal SHA, not by exempting the file.

## Phase 4 — close the loop on the release procedure

The defect is induced by `docs/RELEASE_CHECKLIST.md`. A gate that catches it
without fixing the instruction leaves the next author fighting the gate.

- [x] Read the checklist's pin-advance step and check whether it still tells an
      author to write a tag/commit pair into prose. If it does, correct it and
      say why in the same edit.
- [x] Verify the gate is reachable in the pre-tag window — run
      `npm run validate:metadata` in a state where the candidate tag does not
      exist, and confirm it gives the right answer there. This is criterion 4
      and it is the criterion most likely to be quietly skipped, because the
      convenient time to test is after tagging.

## Phase 5 — record

- [x] CHANGELOG entry. It must state that `0.4.0` shipped this class once
      already and was fixed by instance, and that the pair is induced by the
      release procedure rather than by carelessness — otherwise the next reader
      concludes someone was sloppy and the structural cause survives.
- [x] **The entry must not quote the defect it describes.** `CHANGELOG.md` is
      deliberately not excluded from either prose gate, so writing
      `v0.6.1` beside the full `6ba1eff049…` to illustrate the defect makes the
      gate fail on its own changelog. Cite the commit abbreviated, which is
      already this repository's stated notation for a historical reference.

## Validation commands

```bash
npm test
npm run validate:metadata
npm run check:full

# The Phase 0 enumeration, re-runnable as a regression check — expect no output
# once Phase 3 lands. NOTE: this is line-scoped and the gate is block-scoped, so
# it is a weaker approximation, not the gate. It cannot see a pair split across
# a `\` continuation, which is the evasion Phase 2 tests for. Use it as a quick
# smoke check; `npm run validate:metadata` is the authority.
for f in $(git ls-files '*.md' | grep -v '^\.trellis/'); do
  grep -nE '\bv[0-9]+\.[0-9]+\.[0-9]+\b' "$f" | grep -E '\b[0-9a-f]{40}\b'
done
```

## Standing constraints

- No consumer-visible change. `action.yml`, `src/`, the contract, the descriptor,
  and every lane blob stay untouched; no pin moves.
- `.trellis/` stays excluded. This task's own notes quote the false pair
  verbatim, so a gate that read them would fail on its own evidence.
- No provider credential and no spend. Nothing here touches a lane that runs.

## Rollback

Delete the assertion, its tests, and revert one Markdown line. No state, no
migration, nothing recorded in any manifest.

## Outcome

All phases complete. Evidence, in the order the plan asked for it:

- **Phase 0's enumeration was measured with the wrong instrument and was redone.**
  The line-scoped grep run during planning does not cover a block-scoped rule,
  which is strictly wider. The real enumeration is the gate itself run against
  the tree: it reported exactly one offender, `SETUP-PR-AGENT.md:160-166`, so the
  conclusion held even though the original measurement did not support it.
- **The gate was seen failing on the live defect before the fix existed**, naming
  the tag, its true commit `ee1a162`, and the paired `6ba1eff`.
- **Three mutations, each caught by the intended test**: reverting the rule to
  line-scoped failed the split-across-lines case; dropping the `isCommit`
  discriminator failed the 40-hex-fixture case; treating an unresolvable tag as
  acceptable failed the pre-tag case. Restored: 76/76 in `metadata.test.js`.
- **Criterion 4 proven end to end, not argued.** A pair naming a nonexistent
  `v9.9.9` was appended to the real document and `validate:metadata` reported
  `(no such tag yet)` and failed — the pre-tag window where the defect is
  authored, and where a verify-the-pair gate would have passed.
- **Criterion 3 met without an exemption.** `validate:metadata` passes on the
  corrected file; the `assertProseCommitReferences` conflict disappeared because
  the placeholder carries no literal SHA, not because the file was skipped.
- **Full gates green**: 751 tests pass, coverage 94.73% lines, `check`,
  `validate:ci-parity`, and `validate:metadata` all OK.

Not exercised: `npm run validate:release`. It requires `SD_RELEASE_TAG` to equal
`package.json`'s version and refuses a tag that already exists, so it cannot run
without a version bump. The new assertion lives in `assertPinFreshness`, which
both the ordinary and release forms call, and the ordinary form is green.
