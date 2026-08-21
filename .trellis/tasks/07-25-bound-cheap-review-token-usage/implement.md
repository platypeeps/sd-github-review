# Cheap Review Token-Budget Implementation Plan

Revised 2026-08-20 against the code at `40df292`. The July draft assumed none of
the enforcement machinery existed; most of it has since landed in the v2
governance modules, and the remaining work is smaller and differently shaped
than that draft described.

## Gate 0 — Runtime capability (blocking, do this before anything else)

Qualify the pinned PR-Agent/LiteLLM/provider versions for input counting,
output-cap enforcement, finish-reason reporting, pricing, and usage evidence.

Largely answered already; see the Runtime Capability Verdict in `design.md`. Read
against PR-Agent v0.39.0 source, the pinned runtime has no general output cap,
bounds input only by clipping and file-skipping, and exposes no finish reason or
usage to its caller. What remains is to confirm the pinned digest
`pragent/pr-agent@sha256:cae31b51…` actually carries that source — e.g.
`docker run --rm --entrypoint cat <digest> /app/pr_agent/algo/utils.py` — and
record the verdict.

If the verdict holds, steps 3-6 below cannot be delivered against the lane as
invoked today, and the honest outcome is to say so rather than to satisfy the
acceptance criteria against fixtures over a lane that enforces nothing.

## Step 1 — Close the preflight input-limit gap (independent of Gate 0)

The one real modeling gap. `hardInputLimit` is carried by the catalog
(`src/review-candidate-catalog.js:497-500`, `:924`) and compared at
reconciliation (`src/review-usage-reconciliation.js:709-714`), but never at
preflight:

- Add `input_token_limit` to `PREFLIGHT_INELIGIBILITY_REASONS`
  (`src/review-plan-authorization.js:80-88`).
- In `classifyEligibility` (`:494-506`), compare
  `preflight.countedInputTokens` against the candidate's `hardInputLimit` and
  return the new reason. Order it after `uncountable` — an uncounted input is
  not an oversized one.
- Symmetrically assert `preflight.outputCap <= hardOutputLimit`; nothing checks
  this today.
- Thread `hardInputLimit`/`hardOutputLimit` from the safe projection into the
  decoded candidate, which currently carries neither.

This is self-contained, lands in code with an existing test suite, and is worth
doing whatever Gate 0 concludes.

## Already built — verify, do not rebuild

The July draft's steps 2, 4 and 6 describe work that exists:

- Hard input/output/cost limits, safety margin, explicit units, and the
  fail-closed `safetyMargin < hardRequestCostLimit` check:
  `src/review-candidate-catalog.js:497-535`; projection re-validation at
  `:867-870`, `:924-925`; reconciliation decode at
  `src/review-usage-reconciliation.js:497-511`; fixtures under
  `fixtures/protocol/v2/candidate-safe-projection.*.json`.
- Conservative maximum request cost and reservation:
  `src/protocol-v2.js:669-720` (preflight decode, with
  `maxExpectedCharge <= hardRequestLimit` at `:697`) and
  `src/review-budget-ledger.js:755-864` (`reserve`), `:806-826` (overdrawn and
  quarantine refusal), `:866-929` (authorize), `:931-950` (release).
- Soft/hard classification, quarantine, and sticky overdrawn pools:
  `src/review-usage-reconciliation.js:684-745`, `:800-803`, `:875-880`.

Confirm coverage against the acceptance criteria before writing new tests for
any of it.

## Steps 2-4 — Blocked on the adapter

These require `07-25-integrate-pr-agent-review-adapter`, which is still in
`planning`:

2. Apply the immutable output cap at invocation and map a length-limit
   completion to `incomplete_token_limit` (the reason code already exists at
   `src/protocol-v2.js:136`) without authoritative partial publication.
3. Reconcile real authoritative usage through the existing reconciliation path.
4. Publish bounded evidence for a real dispatch.

None is expressible through `CONFIG__*` on the current `docker run` step.

## Step 5 — Documentation (independent, cheap)

`SETUP-PR-AGENT.md` should state that the pinned container clips patches at a
default `max_model_tokens` of 32000 and skips files past its output-buffer
thresholds, and distinguish that context-window capacity from an enforced token
or spend budget. This satisfies the PRD's last acceptance criterion and is
independently true today.

## Validation

- Exact, under-, and over-boundary input and output fixtures for Step 1.
- Automatic same-chain continuation versus explicit-candidate hard block.
- No silent truncation, deep escalation, or post-dispatch fallback.
- Normal completion, output-cap termination, soft overrun, hard violation,
  unknown usage, and overdrawn-pool recovery.
- Tokenizer, price, unit, capability, digest, and provider mismatch failures.

Commands: `npm test` (`node --test`) is the one that matters — it runs
`test/review-plan-authorization.test.js`, `test/review-candidate-catalog.test.js`,
`test/review-budget-ledger.test.js`, `test/review-usage-reconciliation.test.js`,
and `test/protocol-v2.test.js`.

`npm run check` (`package.json:12`) does **not** cover the files this task edits:
it syntax-checks only the 11 modules reachable from `src/index.js` plus the
installer scripts, and omits `protocol-v2.js`, `review-plan-authorization.js`,
`review-candidate-catalog.js`, `review-budget-ledger.js`, and
`review-usage-reconciliation.js`. Do not read a green `npm run check` as
coverage of this change. `npm run validate:metadata` is only relevant if a
workflow template changes.

## Installer cost of any template change

Editing `examples/pr-agent-router.yml` or `examples/sd-review.yml` changes an
installer-managed resource. The workflow hash is the manifest's `source.sha256`
(`scripts/consumer-installer/codecs.mjs:326-338`), so a change forces fleet
convergence, and `codecs.mjs:186-204` requires adding the superseded release's
hash to `HISTORICAL_TEMPLATE_HASHES` so existing manual installs stay adoptable.
Note that `examples/sd-review.yml` is not covered by the pinned-workflow
assertion at `test/metadata.test.js:161-175`.

## Rollback Gate

Do not enable a cheap candidate until its tokenizer/count bound, output cap,
finish reason, pricing, and usage evidence are proven together. Under the pinned
PR-Agent runtime that gate is currently closed. Roll back by disabling the
candidate; never fall back to an unenforced token policy, and never substitute
PR-Agent's clipping for an enforced input bound.
