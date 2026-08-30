---
title: Make the installer secret gate route-mode aware
status: done
created: 2026-08-22
branch: chore/fleet-rollout-planning-refresh
---
# Make the installer secret gate route-mode aware

## Goal

Let `copilot` and `none` route modes install without requiring a PR-Agent provider credential,
so the fleet rollout does not distribute a live API key into eight repositories that will never
spend it.

## Problem

`planResources` in `scripts/consumer-installer/plan.mjs` refuses any install when
`PR_AGENT_MODEL_API_KEY` is absent:

```js
// plan.mjs:146-151
const secretExists = snapshot.secrets.has(SECRET_NAME);
if (!secretExists && !setSecretRequested) {
  throw new Error(
    `${SECRET_NAME} is missing; rerun with --set-secret or pipe it to --secret-stdin`,
  );
}
```

The check never consults `routeMode`. The parameter is not in scope: `planResources`
(`plan.mjs:118`) takes `configuration, snapshot, existingManifest, setSecretRequested` and
references `routeMode` nowhere.

Verified 2026-08-22 against `platypeeps/rwbp-coordinator`: `--route-mode auto`,
`--route-mode copilot`, and `--route-mode none` all fail identically with that error, on a
`--dry-run`. `none` dispatches to no provider at all and is still refused.

The secret is genuinely needed only by PR-Agent routes. In `examples/sd-review.yml:121-133`
every reference is a PR-Agent provider binding gated on the provider variable, and every one
falls through to an empty string:

```yaml
OPENAI__KEY: ${{ vars.PR_AGENT_MODEL_PROVIDER == 'openai' && secrets.PR_AGENT_MODEL_API_KEY || '' }}
```

So the workflow already tolerates the secret's absence by construction. The gate is stricter
than the artifact it protects.

## Sites to change

Two behavioural sites are mode-blind, not one. Fixing only the first leaves `check` failing on
every installation the fix newly permits:

1. `scripts/consumer-installer/plan.mjs:148` — the install/update refusal quoted above.
2. `scripts/consumer-installer.mjs:512-513` — `check` pushes
   `` `GitHub secret ${SECRET_NAME} is missing` `` unconditionally.

`consumer-installer.mjs:581` (`--remove-secret`) and the `codecs.mjs` name/help references are
not behavioural gates and need no change.

`auto` belongs with the strict modes, confirmed in the router rather than assumed:
`src/router.js:74` rejects `auto` as a final route (`must be a resolved route`) and `:176`
records "lowered auto to `${route}`". `auto` is resolved at review time and can land on a
PR-Agent route, so an install that skipped the secret under `auto` would fail during review
instead of at install.

## Coverage

The refusal is untested. `test/consumer-installer.test.js` has no `secrets: []` case and no
assertion of the missing-secret error; every test seeds `secrets: [SECRET_NAME]`. The two
`copilot` install tests (lines 2066, 2145) both seed it, so `copilot`-without-secret is
uncovered. A deliberate cross-mode requirement would be pinned by a test; this one is not.

## Impact

Blocks `08-08-fleet-rollout-smoke`. That rollout installs `copilot` into eight repositories.
Under the current gate each install requires provisioning `PR_AGENT_MODEL_API_KEY`, producing
eight new copies of a live provider credential that no `copilot` install will use — one of them
in a different GitHub org (`answerbook/mezmo_benchmark`). That is a credential-exposure
increase with no functional benefit.

## Requirements

- `planResources` decides the secret requirement from the resolved route mode.
- Modes that can dispatch to PR-Agent (`auto`, `cheap`, `deep`) keep the current refusal
  unchanged. `auto` must keep it: it can select a PR-Agent route at runtime.
- Modes that cannot (`copilot`, `none`) install without the secret.
- Supplying the secret explicitly stays valid for every mode. `--set-secret` and
  `--secret-stdin` continue to work under `copilot` and `none` for operators who want the key
  provisioned ahead of a later mode change.
- A later `update --route-mode` to a PR-Agent mode must still enforce the requirement, so an
  install that skipped the secret cannot silently become a PR-Agent install without one.
- `check` reports a missing secret as an issue only when the recorded route mode needs it.

## Acceptance Criteria

- [ ] `install --route-mode copilot` and `--route-mode none` succeed with no secret present.
- [ ] `install --route-mode auto`, `cheap`, and `deep` still refuse with the existing message
      and exit non-zero.
- [ ] `install --route-mode copilot --secret-stdin` still provisions the secret.
- [ ] `update --route-mode auto` on an installation made under `copilot` without a secret
      refuses unless a secret is present or supplied.
- [ ] `check` on a secret-less `copilot` installation reports `ok`, and does not list the
      missing secret as an issue. This exercises `consumer-installer.mjs:512`, the second
      mode-blind site; a fix to `plan.mjs` alone fails this criterion.
- [ ] `check` on a secret-less installation whose recorded mode is `auto`, `cheap`, or `deep`
      still reports the missing secret as an issue.
- [ ] Tests cover the missing-secret path per mode — the case that has no coverage today.
- [ ] `npm run check:full` green.
- [ ] A `--dry-run` install of `copilot` against `platypeeps/rwbp-coordinator` produces a plan
      instead of the refusal, which is the exact command that fails today.

## Review findings

**Rebutted — Prism, "Duplicate knowledge in code and tests for route mode secret requirement"**
(`test/consumer-installer.test.js`, maintainability, 80%). The suggestion is to import
`PROVIDER_SECRET_OPTIONAL_ROUTE_MODES` into the test instead of restating the partition. Doing
so makes the assertion tautological — it would reduce to `!set.has(m) === !set.has(m)` and
verify nothing. The independent restatement is the oracle; that is what makes the test able to
fail. The `expected` key-set is separately asserted equal to `ROUTE_MODES`, so a mode added
without a decision here fails the test rather than drifting silently, which is the drift the
finding is concerned about.

This finding is also the second of two contradictory rounds: the prior round asked for the
partition to be derived from `ROUTE_MODES` rather than hardcoded, and this round asks for the
derivation to be removed as duplication. Satisfying both is not possible. Not remediated
further; see the convergence note below.

## Notes

Found while executing `08-08-fleet-rollout-smoke`. The rollout is paused on this task rather
than working around the gate by distributing the credential.

2026-08-22 convergence state: `npm test` is 656/656 and the SD review preflight reports
`0 failure(s), 1 warning(s)` (the warning is that this branch carries two Trellis task
directories, which is accurate — the rollout task and this one). `npm run check:full` still
exits 1, solely on the rebutted Prism maintainability finding above. That is a live instance of
`08-09-review-gate-advisory-convergence`: an advisory-severity finding fails the gate with no
convergent remediation available. The gate is red for that reason and no other; it is not green.

The `auto` boundary is the one to get right. `auto` can resolve to a PR-Agent route at runtime,
so it belongs with the strict modes despite not naming a provider up front. Treating it as
secret-optional would move the failure from install time to review time, which is the silent
failure mode the durable lane exists to eliminate.
