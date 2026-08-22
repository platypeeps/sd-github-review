# Implementation plan — close the one-release pin-freshness lag

Baseline captured before any edit: `npm test` = **656 passing / 0 failing**;
`node scripts/validate-action-metadata.mjs` exits 0 with
`pinned to the current release v0.4.0`.

Both numbers must hold at the end, except where a step says otherwise.

## Step 1 — extend the git seam

In `scripts/validate-action-metadata.mjs`, beside `defaultListReleaseTags` and
`defaultResolveTagCommit` (`:541-558`), add two helpers with the same shape:

- `defaultIsAncestor(repositoryRoot, ancestor, descendant)` — `git merge-base --is-ancestor`.
  Exit 0 → `true`, exit 1 → `false`. **Any other exit is an error, not `false`.** `execFileAsync`
  rejects on nonzero, so inspect `error.code` and rethrow anything that is not 1; swallowing it
  turns an unreadable repository into a silent pass.
- `defaultResolvePathObject(repositoryRoot, commit, path)` — `git rev-parse <commit>:<path>`,
  returning the trimmed object id. Let it throw when the object is missing.

Wire both through `gitImpl` exactly as the existing two are
(`assertPinFreshness:594-595`), so tests never touch a real repository.

## Step 2 — replace the equality check

Replace the `actionSha !== latestCommit` branch (`:614-619`) with conditions 2 and 3 from
`design.md`. Condition 1 -- the pin resolves to an object -- is what step 1's helpers throw on,
so it needs no branch here. Evaluate in this order so the error messages stay specific:

1. **Ancestry.** `isAncestor(actionSha, latestCommit)`. If false, fall through to the pre-tag
   window (step 3) before failing.
2. **Action-code identity.** `resolvePathObject(actionSha, "src")` equals
   `resolvePathObject(latestCommit, "src")`, and the same for `action.yml`. If not, fail with a
   message naming the pinned commit, the release tag, the release commit, and **which** of the
   two differs.

Keep the existing `descriptorPath:` prefix and the closing
`advance every first-party pin together`, so the message stays greppable and the falsification
check in step 5 recognises it.

Do **not** touch `validateReleaseConsistency` or `validateMetadata`. The mutual-consistency
check in `validateMetadata` is what caught the split state during #115 and must keep firing
independently.

## Step 3 — the pre-tag window, as an explicit branch

`design.md` resolves this to option B. Implement B, and only B:

> Accept a pin that is a descendant of `latestCommit` when the pin is also an ancestor of
> `HEAD`.

This is the pin-advance pull request's state: the new pin is newer than the last release and is
on the branch being validated. Condition 2 from step 2 still applies unchanged, so a descendant
pin whose action code differs from the release still fails.

Write it as a named branch with its own error message and its own test — not as a loosened
comparison operator. A reader must be able to see that the pre-tag window is a deliberate case.

If this branch cannot be made to pass step 5's falsification without also admitting a stale pin,
**stop and report**. Shipping a gate that cannot fail is worse than shipping the lag.

## Step 4 — tests

Add to `test/metadata.test.js`, all through injected `gitImpl` so no case needs a real
repository:

| case | expectation |
| --- | --- |
| pin equals the release commit | passes — the pre-existing state must not regress |
| pin is the release's parent, identical `src` and `action.yml` | passes — the case that is impossible today |
| pin trails by a commit that changes `src` | fails, message names `src` |
| pin trails by a commit that changes `action.yml` | fails, message names `action.yml` |
| pin is from the previous release | fails — the R-003 regression guard |
| pin is a descendant of the tag and an ancestor of `HEAD` | passes — the pre-tag window |
| pin is a descendant of the tag and **not** an ancestor of `HEAD` | fails |
| no release tags at all | fails with the existing zero-tags message, unchanged |
| `isAncestor` exits 2 | throws, not `false` |

The last row is the one most likely to be skipped and is the one that keeps step 1's error
handling honest.

## Step 5 — falsification, run against the real repository

The decisive check, and the one the archived `08-08-release-v0-3-0-pin-freshness` got right:
revert **every** pin site together, not just the descriptor. Reverting the descriptor alone
fails on mutual consistency, which is a different gate and proves nothing about freshness.

```
# expect exit 1 and a staleness message naming src
sed -i '' "s/3e41f23…/744a9f1…/g" <every non-archive pin site>
node scripts/validate-action-metadata.mjs; echo "exit=$?"
# restore, expect exit 0
```

Do not use `git checkout --` to restore: `main` still carries the old pin values at `HEAD` for
any file not yet committed on this branch, so it restores the *wrong* value silently. Restore by
re-running `sed` in the opposite direction.

## Step 6 — update the live release order

Swap steps 3 and 4 of `docs/RELEASE_CHECKLIST.md` section 5 (`:87-90`): advance every pin to the
approved candidate SHA **first**, then create the annotated tag on the resulting commit. Keep
the existing sentence that the tag is for discovery and the SHA is the immutable installation
reference — it is still true and is the reason the order matters.

Add one line stating that the pin advance must touch neither `src/` nor `action.yml`, since that
is what makes the resulting tag satisfy its own gate.

Leave `.trellis/tasks/archive/2026-08/08-08-release-v0-3-0-pin-freshness/` untouched.

## Validation, in order

1. `npm test` — 656 baseline plus the new cases, 0 failing.
2. `node scripts/validate-action-metadata.mjs` — exit 0.
3. Step 5's falsification — exit 1 with a staleness message naming `src`, then exit 0 after
   restore.
4. `npm run check:full` — expected to exit non-zero only if it reproduces the advisory-severity
   Prism convergence problem recorded in `08-09-review-gate-advisory-convergence`. Any other
   failure is a real one.

## Rollback points

- After step 2, before step 3: the gate is stricter than before and blocks the pin-advance PR.
  Recoverable by reverting the commit; nothing external depends on it.
- After step 6: the checklist and the gate must agree. If step 3 is abandoned, step 6 must be
  reverted with it, or the next release follows an order its own gate rejects.

## Out of scope

- Re-cutting `v0.4.0`. Its tree pins `744a9f1` and will not satisfy the new rule. It is
  published and `docs/RELEASE_CHECKLIST.md:92-98` forbids repairing a release by moving its tag.
  The first tag that satisfies the rule is the next one cut under the new order.
- The eight unreachable v2 `src/` modules. Unrelated, pre-existing, tracked elsewhere.
- The fleet rollout itself.
