# Blast-radius audit: how many PRs claimed a review they never got

Run 2026-08-27 against every pull request the repository has ever had.

## Method

```bash
gh pr list --state all --limit 200 \
  --json number,state,mergedAt,reviews \
  --jq '.[] | [.state, .number, (.mergedAt // "-"),
        ([.reviews[]?|select(.author.login=="copilot-pull-request-reviewer")]|length)] | @csv'
```

Enumerates from GitHub rather than from any local list, so it cannot miss a PR
nobody wrote down. Coverage confirmed complete: 154 rows returned; numbering runs
#1-#153 plus #156; `gh pr view` reports #154 and #155 never existed
(`Could not resolve to a PullRequest`).

## Result

| state | total | zero Copilot review |
|---|---|---|
| MERGED | 148 | **0** |
| CLOSED | 5 | **0** |
| OPEN | 1 | **1** (#156) |

The only pull request in the repository's history without a Copilot review is
PR #156 — the live reproduction, still open and unmerged.

## What this settles

**No merged pull request ever shipped claiming a review floor it did not
receive.** The PRD's open question — "how many past PRs recorded a satisfied
review floor without an actual review?" — is answered: none. The silent-failure
mode is real, but it has produced exactly one instance, and that instance was
caught before merge.

This lowers the urgency of the defect without lowering its severity. The
verification gap in `reviewer-dispatch.js` is still a real hole that reports
success without evidence; it has simply not been exercised destructively before
now. The fix remains worth doing on its own merits, and the fact that #156 is
the first occurrence in 154 PRs is itself a useful signal about how rare the
underlying GitHub behavior is.

## Caveat on method

This audit asks "does a Copilot review exist on the PR", which is the outcome
that matters. It does not cross-check each PR's durable receipt against its
timeline, so it would not detect a PR that was reviewed by Copilot for unrelated
reasons while its receipt was independently wrong. For the question asked — did
any merged PR ship unreviewed — the outcome check is the right and sufficient
one.
