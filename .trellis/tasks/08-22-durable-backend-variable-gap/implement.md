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

## Step 1 — extend the managed-variable table

- [ ] Add the two entries to `CONFIG_VARIABLES` in
      `scripts/consumer-installer/codecs.mjs`, carrying a derivation function
      rather than a configuration-field name.
- [ ] Add `BACKEND_MIN_SCHEMA_VERSION = 5`, bump `MANIFEST_SCHEMA_VERSION` to 5,
      add 5 to `SUPPORTED_MANIFEST_SCHEMA_VERSIONS`, extend
      `configVariablesForSchema`, and extend the schema matrix comment with a
      row for version 5.

Keep both kinds of entry in the one table. A parallel list beside it is the
specific failure this step must avoid — every downstream behavior reads the
table, and a second list drifts from it.

Check: `grep -rn "SD_REVIEW_CHEAP_BACKEND_V1" scripts/` returns the table entry
and nothing hand-maintained elsewhere.

## Step 2 — synthesize the descriptors

- [ ] Add the derivation from `provider` + `cheapModel` / `deepModel` to the
      shape in `design.md`.
- [ ] Assert the output passes `decodeBackend` and is `kind: external`.

Check: a unit test feeds `DEFAULT_CONFIG` through the derivation and calls
`decodeBackend` on both results — expect no throw, `kind === "external"`, and
`model` equal to the configured model. A synthesized descriptor that does not
decode is the whole failure mode.

## Step 3 — wire install, update, check, uninstall

- [ ] `variableValues` yields the two derived values.
- [ ] `check` compares live values against freshly synthesized ones and reports
      drift.
- [ ] `uninstall` removes them via the manifest's recorded variable block.
- [ ] `update` rewrites schema 1–4 manifests to 5 and provisions the variables.

Check: existing installer tests still pass, plus a new test per verb.

## Step 4 — migration coverage

- [ ] Test that a schema-4 manifest decodes, migrates to 5 through `update`,
      and gains both variables.
- [ ] Test that schema 1, 2, and 3 manifests still decode.

Check: gate on the introduced-at version, never on equality with
`MANIFEST_SCHEMA_VERSION`. Falsify by temporarily changing a gate to `===` and
confirming a pre-5 manifest test fails; revert.

## Step 5 — end-to-end against a scratch repository

Not the pilot. The pilot has hand-set variables and cannot falsify this — it is
configured around the defect.

- [ ] Create a scratch repository, `install --route-mode copilot` (no provider
      secret needed).
- [ ] Confirm both variables exist and were installer-created.
- [ ] Open a routine pull request. Dispatch with an **explicit `cheap` route**
      at the shipped `independent-review-floor: copilot`, and confirm a receipt
      with `selectedRoute: cheap`.
- [ ] Repeat with an explicit `deep` route, expecting `selectedRoute: deep`.
- [ ] Dispatch once with `auto` at the shipped floor and confirm
      `selectedRoute: copilot` — the path the fleet actually uses must not
      regress.
- [ ] `uninstall`, confirm no variable remains.

Using an explicit route is the whole point of this step. The floor raises an
*automatic* route to `copilot` but leaves an explicit one alone, so an `auto`
dispatch would go green without touching the code under test. Confirm
`selectedRoute` in the receipt, not merely the run conclusion.

Expect the `pr-agent` job to fail in a scratch repository with no
`PR_AGENT_MODEL_API_KEY`: `adapter-request` is non-empty on a `cheap` route, so
that job runs and its config validation fails. That is out of scope. Scope the
acceptance to the `review` job's receipt, and record the workflow-level
conclusion as expected-red with the reason.

## Step 6 — falsify the fix

- [ ] Delete `SD_REVIEW_CHEAP_BACKEND_V1` from the scratch repository, re-run
      `check`, and confirm it reports the missing variable.
- [ ] Re-dispatch and confirm the original error returns.

Without this the fix is untested against the actual defect: a passing install
does not prove `check` detects the absence.

## Step 7 — gates and documentation

- [ ] `npm test`, `npm run check`, `node scripts/validate-action-metadata.mjs`.
- [ ] Update `.trellis/spec/backend/consumer-installer.md` with the derived-value
      entry kind and the schema-5 tier.
- [ ] CHANGELOG: note that `check` will newly report existing hand-configured
      repositories as drifted. Do not suppress that.

Check: `npm test` passes with the new cases; the metadata gate exits 0.

## Step 8 — the split finding

- [ ] Create the follow-up task for `REVIEW_ROUTE_MODE` not reaching the
      durable lane, with `design.md`'s reasoning carried over.

This task is not done until that exists — the PRD requires the finding be
dispositioned, and "mentioned in a design document" is not a disposition.

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
