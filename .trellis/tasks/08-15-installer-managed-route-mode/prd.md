# Make REVIEW_ROUTE_MODE an installer-managed variable

## Goal

Bring the event-driven lane's route variable under the consumer installer's
ownership, so that `check` detects it missing and `uninstall` removes it,
instead of relying on the lane failing at run time.

## Background

`08-15-remote-review-channel-authority` installed this repository as a consumer
of its own Action. The event-driven lane (`examples/pr-agent-router.yml`) routes
on the `mode` input, wired to the repository variable `REVIEW_ROUTE_MODE`.

That variable is set by hand. It is not in `CONFIG_VARIABLES`
(`scripts/consumer-installer/codecs.mjs:116-120`, which manages
`PR_AGENT_MODEL_PROVIDER`, `CHEAP_REVIEW_MODEL`, and `DEEP_REVIEW_MODEL`), so:

- `install-consumer.mjs check` reports a healthy installation without it;
- `install-consumer.mjs uninstall` leaves it behind; and
- the manifest records no evidence that the lane depends on it.

The lane compensates by failing closed: its first step rejects an unset or
invalid value rather than defaulting to `auto`, because `auto` can select
`cheap` or `deep` and bill the operator's provider key. That was added after a
real billing event on PR #85 — see that task's `design.md` for the sequence.

So this is a robustness improvement, not a live defect. The failure mode is
already loud and already costs nothing; what is missing is detection *before*
the next pull request opens, and cleanup on uninstall.

## Requirements

- `REVIEW_ROUTE_MODE` is managed like the three existing configuration
  variables: written on install, recorded in the manifest, verified by `check`,
  and removed by `uninstall` when the installer owns it.
- A pre-existing variable the installer did not create stays unowned and
  preserved, matching the rule in
  `.trellis/spec/backend/consumer-installer.md:128-130`.
- The accepted values are exactly `auto`, `cheap`, `deep`, `copilot`, `none` —
  the same set the workflow gate enforces. The two must not be able to drift
  apart silently.
- The installed lane's fail-closed gate stays. Installer management is a second
  line of defence, not a replacement: a consumer can always delete the variable
  after installing.
- The manifest schema version is bumped if the recorded resource set changes,
  and existing schema-3 manifests are migrated or rejected deliberately rather
  than misread.

## Acceptance criteria

- [ ] `install-consumer.mjs install` on a fresh consumer creates
      `REVIEW_ROUTE_MODE` and records it in the manifest.
- [ ] `check` fails, with a message naming the variable, when it is deleted
      after a successful install.
- [ ] `uninstall` removes an installer-created variable and preserves a
      pre-existing one.
- [ ] A test asserts the installer's accepted value set and the workflow gate's
      accepted value set are the same set, so the two cannot drift.
- [ ] `.trellis/spec/backend/consumer-installer.md` no longer describes
      `REVIEW_ROUTE_MODE` as unmanaged.
- [ ] `npm test`, `validate-action-metadata.mjs`, and `validate-ci-parity.mjs`
      all pass.

## Notes

Priority is low. The gate already converts every known failure path into a
loud, free failure, and the fleet rollout in `08-08-fleet-rollout-smoke` is what
would make the missing detection matter at scale — a consumer installed by
someone who never reads the lane's error message. Sequence this before that
rollout if both are in play, otherwise it can wait.
