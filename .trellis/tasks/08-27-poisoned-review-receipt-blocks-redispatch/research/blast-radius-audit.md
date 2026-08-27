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
PR #156 — the live reproduction. It was open and unmerged when this audit ran;
it was merged without a Copilot review on 2026-08-27 by owner decision, after
credits were restored and it still could not obtain one. See
`why-github-added-nobody.md`.

## What this settles

**No merged pull request in this repository's history shipped without a Copilot
review.** That is exactly what the method measures — whether a review exists on
the PR — and it is the outcome that matters.

It does not settle the PRD's question as worded. "How many past PRs recorded a
satisfied review floor without an actual review?" is a question about receipts,
and this audit reads none. What it does establish is that the answer cannot
matter for any merged PR: whatever a receipt claimed, a review was in fact
there, so no false claim can have let an unreviewed change through. #156 is the
one observed instance of the silent-failure mode, and it did not merge on that
receipt.

#156 has since merged, on 2026-08-27, without a Copilot review — but by an
explicit owner decision recorded as such, not behind a receipt claiming a review
it never had. That distinction is the whole point of this audit: a review floor
deliberately left unmet is not the same thing as one silently reported as met.

This lowers the urgency of the defect without lowering its severity. The
verification gap in `reviewer-dispatch.js` is still a real hole that reports
success without evidence; it has simply not been exercised destructively before
now.

**Correction, 2026-08-27.** The sentence that followed here called #156 "the
first occurrence in 154 PRs" and read that as a signal that the underlying
GitHub behavior is rare. That inference does not hold. The measurement above
stands as the snapshot it was — at audit time every merged and closed PR
carried a Copilot review, and none had shipped behind a false claim of one;
#156 merged unreviewed later that day, by the explicit decision recorded above
— but it counts reviews that exist, not dispatches that landed, and
those are not the same thing. On #151 and #153 the `review_requested` event
precedes the action's own run, so the action did not cause them. How often the
action's POST actually landed is not measured by this audit and is not
knowable from it. See `why-github-added-nobody.md`.

## Caveat on method

This audit asks "does a Copilot review exist on the PR", which is the outcome
that matters. It does not cross-check each PR's durable receipt against its
timeline, so it would not detect a PR that was reviewed by Copilot for unrelated
reasons while its receipt was independently wrong. For the question asked — did
any merged PR ship unreviewed — the outcome check is the right and sufficient
one.

It also reads review state as it stands now, not as it stood at each merge, so
it cannot by itself establish that a review existed *before* the merge rather
than being attached around it. Copilot reviews are requested pre-merge and none
was observed arriving afterwards, so the distinction did not bite here; it is
recorded because the audit's phrasing elsewhere ("caught before it could merge")
claims more than this method measures.
