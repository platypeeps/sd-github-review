# Implementation plan

Ordered. Each step names the check that would catch it being wrong.

## Step 0 — verify the two assumptions the design rests on — DONE

- [x] `reviewAuthors` confirmed as `github-actions[bot]`, by observation rather
      than inference. The PR-Agent job runs with
      `GITHUB__USER_TOKEN: ${{ github.token }}`, and real PR-Agent comments on
      pilot PR #7 (2026-07-25) are authored by `github-actions[bot]`
      ("Preparing review..."). Recorded in `research/evidence.md`.
- [x] `sd-github-review` has **only** the four managed variables — neither
      backend variable. So no fleet consumer has a hand-set value to adopt;
      only the pilot does, and it is not a rollout target. `design.md` updated;
      the adoption/conflict path drops out of the fleet scope.

## Step 1 — extend the managed-variable table — DONE

- [x] Add the two entries to `CONFIG_VARIABLES` in
      `scripts/consumer-installer/codecs.mjs`, carrying a derivation function
      rather than a configuration-field name.
- [x] Add `BACKEND_MIN_SCHEMA_VERSION = 5`, bump `MANIFEST_SCHEMA_VERSION` to 5,
      add 5 to `SUPPORTED_MANIFEST_SCHEMA_VERSIONS`, extend
      `configVariablesForSchema`, and extend the schema matrix comment with a
      row for version 5.

Keep both kinds of entry in the one table. A parallel list beside it is the
specific failure this step must avoid — every downstream behavior reads the
table, and a second list drifts from it.

Check: `grep -rn "SD_REVIEW_CHEAP_BACKEND_V1" scripts/` returns the table entry
and nothing hand-maintained elsewhere.

## Step 2 — synthesize the descriptors — DONE

- [x] Add the derivation from `provider` + `cheapModel` / `deepModel` to the
      shape in `design.md`.
- [x] Assert the output passes `decodeBackend` and is `kind: external`.

Check: a unit test feeds `DEFAULT_CONFIG` through the derivation and calls
`decodeBackend` on both results — expect no throw, `kind === "external"`, and
`model` equal to the configured model. A synthesized descriptor that does not
decode is the whole failure mode.

## Step 3 — wire install, update, check, uninstall — DONE

- [x] `variableValues` yields the two derived values.
- [x] `check` compares live values against freshly synthesized ones and reports
      drift.
- [x] `uninstall` removes them via the manifest's recorded variable block.
- [x] `update` rewrites schema 1–4 manifests to 5 and provisions the variables.

Check: existing installer tests still pass, plus a new test per verb.

**Outcome: no per-verb code was needed.** All four verbs already read the
managed-variable table, so keeping both entry kinds in that one table — the
thing the design insisted on — made this step a no-op in production code. The
only addition was a fourth rung on `check`'s migration ladder. That is the
design working, and it is worth recording, because a parallel list beside the
table would have turned this into four edits and three chances to miss one.

## Step 4 — migration coverage — DONE

- [x] Test that a schema-4 manifest decodes, migrates to 5 through `update`,
      and gains both variables.
- [x] Test that schema 1, 2, and 3 manifests still decode.

Check: gate on the introduced-at version, never on equality with
`MANIFEST_SCHEMA_VERSION`. Falsify by temporarily changing a gate to `===` and
confirming a pre-5 manifest test fails; revert.

**The falsification as written could not fail, and that was the finding.**
Changing `>= BACKEND_MIN_SCHEMA_VERSION` to `=== MANIFEST_SCHEMA_VERSION` left
all 662 tests passing, because at the moment a tier is introduced its constant
*equals* `MANIFEST_SCHEMA_VERSION` — the two gates are indistinguishable until
the next bump, when the bug fires against the whole fleet at once. A decode
sweep over schemas 1..current structurally cannot catch it.

Replaced with a monotonicity assertion that can: the managed set resolved at
`MANIFEST_SCHEMA_VERSION + 1` must equal the current set, and each tier must be
a superset of the one below. Re-ran the same mutation and it now fails with
`codecs: the managed variable tiers are monotone, not pinned to the current
version`. Reverted; recorded in the spec so the next tier inherits the rule.

## Step 5 — end-to-end against a scratch repository — DONE

Not the pilot. The pilot has hand-set variables and cannot falsify this — it is
configured around the defect.

- [x] Create a scratch repository, `install --route-mode copilot` (no provider
      secret needed).
- [x] Confirm both variables exist and were installer-created.
- [x] Open a routine pull request. Dispatch with an **explicit `cheap` route**
      at the shipped `independent-review-floor: copilot`, and confirm a receipt
      with `selectedRoute: cheap`.
- [x] Repeat with an explicit `deep` route, expecting `selectedRoute: deep`.
- [x] Dispatch once with `auto` at the shipped floor and confirm
      `selectedRoute: copilot` — the path the fleet actually uses must not
      regress.
- [x] `uninstall`, confirm no variable remains.

Using an explicit route is the whole point of this step. The floor raises an
*automatic* route to `copilot` but leaves an explicit one alone, so an `auto`
dispatch would go green without touching the code under test. Confirm
`selectedRoute` in the receipt, not merely the run conclusion.

Expect the `pr-agent` job to fail in a scratch repository with no
`PR_AGENT_MODEL_API_KEY`: `adapter-request` is non-empty on a `cheap` route, so
that job runs and its config validation fails. That is out of scope. Scope the
acceptance to the `review` job's receipt, and record the workflow-level
conclusion as expected-red with the reason.

### Measured, on `platypeeps/sd-review-scratch-0822`

Install under `--route-mode copilot` with **no provider secret** — the scratch
repository's secret count stayed `0` for the whole exercise, so no route could
bill anything. Manifest came out at `schemaVersion: 5` with all six variables
`owned=true`.

| Dispatch | Floor | `selectedRoute` | Backend in the receipt |
| --- | --- | --- | --- |
| `route: cheap` | `copilot` (shipped) | **`cheap`** | `pr-agent`, `openrouter/qwen/qwen3-coder-30b-a3b-instruct`, low/standard |
| `route: deep` | `copilot` (shipped) | **`deep`** | `pr-agent`, `openrouter/moonshotai/kimi-k2.6`, medium/advanced |
| `route: auto` | `copilot` (shipped) | **`copilot`** | the Copilot backend (`inline-comments`), not the synthesized one |

The `auto` row is the one that proves the fleet's actual path did not regress,
and its backend confirms it never touches either new variable.

`pr-agent` went **green**, not red as predicted above. The prediction was wrong
about the mechanism, not about the credential: with no `PR_AGENT_MODEL_API_KEY`
the provider guard falls through to `''` and the step does not fail its config
validation the way the plan assumed. Nothing was billed — there was no
credential to bill with. Left recorded rather than quietly corrected, since the
plan's expected-red note would otherwise read as satisfied.

Two dispatches failed on my own input error before this, not on any product
defect: dispatching a second route against a head that already held a receipt
returns `existing durable receipt conflicts with the canonical request
fingerprint`. That is exact-head binding working as designed. Each route needs
its own head.

## Step 6 — falsify the fix — DONE

- [x] Delete `SD_REVIEW_CHEAP_BACKEND_V1` from the scratch repository, re-run
      `check`, and confirm it reports the missing variable.
- [x] Re-dispatch and confirm the original error returns.

Without this the fix is untested against the actual defect: a passing install
does not prove `check` detects the absence.

### Measured

```
$ check                       # before
Installation is healthy for platypeeps/sd-review-scratch-0822.   exit=0
$ gh api -X DELETE .../variables/SD_REVIEW_CHEAP_BACKEND_V1
$ check                       # after
Installation drift detected for platypeeps/sd-review-scratch-0822:
- GitHub variable SD_REVIEW_CHEAP_BACKEND_V1 is missing           exit=1
```

Re-dispatching `route: cheap` with the variable absent reproduced the original
defect exactly:

```
##[error]Error: cheap-backend is required for durable operations
```

`update` then re-provisioned it (`- set GitHub variable
SD_REVIEW_CHEAP_BACKEND_V1`) and `check` returned to healthy. `uninstall`
deleted all six variables and left `total_count: 0` — no orphans.

## Step 7 — gates and documentation — DONE

- [x] `npm test`, `npm run check`, `node scripts/validate-action-metadata.mjs`.
- [x] Update `.trellis/spec/backend/consumer-installer.md` with the derived-value
      entry kind and the schema-5 tier.
- [x] CHANGELOG: note that `check` will newly report existing hand-configured
      repositories as drifted. Do not suppress that.

Check: `npm test` passes with the new cases; the metadata gate exits 0.

Measured: `tests 667 / pass 667 / fail 0` (up from 662); `npm run check` clean;
`validate-action-metadata.mjs` exits 0 with "Validated action.yml, 3 workflow(s),
7 example(s), and 1133 tracked public path(s)".

CHANGELOG went under a new `## Unreleased` heading rather than into `0.4.1`.
`0.4.1` is a candidate awaiting its observation window, and its headline claim is
that the release carries no runtime change; appending to it after the pilot would
describe something the pilot never exercised.

## Step 8 — the split finding — DONE

- [x] Create the follow-up task for `REVIEW_ROUTE_MODE` not reaching the
      durable lane, with `design.md`'s reasoning carried over.

This task is not done until that exists — the PRD requires the finding be
dispositioned, and "mentioned in a design document" is not a disposition.

Created: `.trellis/tasks/08-22-durable-lane-route-mode`, PRD-only so far, with
the evidence and the "why not folded in" reasoning carried over. Its three open
questions — where the constraint lives, whether a forbidden route is an error or
a downgrade, and what a pre-schema-4 manifest means — are decisions for the user,
not defaults to pick during a split.

## Sequencing

**This does not block canary 1.** The installed template's `copilot` review
floor keeps every pack-dispatched review off the `cheap` and `deep` routes, so
the rollout succeeds with or without this fix. Landing it first is preferable —
it avoids installing nine consumers and immediately updating them — but the
rollout may proceed without it.

Does not block the `0.4.1` publish decision, which is gated on the observation
window. If `0.4.1` ships first this becomes `0.4.2`, and the rollout does not
have to wait for it.

## Rollback points

- Through step 4: revert the commit; no external state exists.
- After step 5: delete the scratch repository. It is disposable and must not be
  the pilot.

**Deleted.** `platypeeps/sd-review-scratch-0822` was uninstalled through the
normal lifecycle (all six variables removed, `total_count: 0`, every managed
file removed) and the repository itself is gone:

```
$ gh api repos/platypeeps/sd-review-scratch-0822
404 Not Found
```

The deletion needed the operator: the session's `gh` token carries
`gist, read:org, repo, workflow` and not `delete_repo`, so `gh repo delete`
returned `HTTP 403 ... needs the "delete_repo" scope`. Noting the scope gap
because it will recur the next time a scratch consumer is used.
