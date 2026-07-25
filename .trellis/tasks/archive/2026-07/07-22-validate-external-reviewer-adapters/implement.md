# External Reviewer Adapter Pilot Implementation Plan

## Execution Order

1. Confirm the source branch is based on synchronized `main`, record the exact
   source candidate SHA, and run repository tests, metadata validation, install
   audit, and full check.
2. Re-query the private pilot's workflows, open smoke PRs, variables, secret
   names, and recent runs. Record only the sanitized readiness fields defined
   in `design.md`.
3. Obtain the capped OpenRouter key through GitHub's hidden secret input. Never
   accept the key in chat, a file, a command argument, or a task artifact.
4. Clone or update the private pilot checkout. Run the consumer installer in
   dry-run mode with the approved OpenRouter/Kimi values and inspect the exact
   file and GitHub mutation plan.
5. Prepare one private pilot change that disables or removes the existing
   provider-free event workflow and installs the managed PR-Agent workflow and
   manifest. Do not alter the provider-free durable workflow.
6. Apply the approved installer plan, review the private diff, and land it only
   after confirming one event workflow owns each trigger path.
7. On a same-repository synthetic smoke PR, run `review:cheap`. Verify the
   selected route/model, pinned PR-Agent step, successful workflow, and
   conversation-comment finding without copying its body.
8. Clear the prior route control, run `review:deep` or trusted
   `/review deep`, and verify the same bounded evidence for the deep tier.
9. Inspect workflow metadata, logs, and GitHub finding surfaces for the secret,
   source, path, prompt, transcript, or raw-output leakage prohibited by the
   PRD. Record only pass/fail and bounded limitations.
10. Exercise the uninstall/disable dry-run, verify the ownership boundary, and
    record the rollback state. Restore or leave the pilot in the explicitly
    approved terminal configuration.
11. Update the sanitized task research and only those live docs whose operating
    contract changed. Run checks, review the repository diff, and ship the
    repo-local evidence PR. Leave the full durable pilot to its owning task.

## Validation

- `npm test`
- `npm run check`
- `npm run validate:metadata`
- `python3 scripts/sd-ai-command-pack-install-audit.py`
- `bash scripts/sd-ai-command-pack-full-check.sh`
- `node scripts/install-consumer.mjs check --target <private-checkout>`
- Direct GitHub checks for exact pilot head, workflow run conclusion, finding
  channel, and unresolved review threads; never print secret values.

## Stop Conditions

- `PR_AGENT_MODEL_API_KEY` is absent or not a capped pilot credential.
- The installer plan would overwrite an unmanaged workflow or take ownership
  of a conflicting variable/label.
- More than one active workflow would own the same event trigger.
- The candidate or pilot head changes after evidence is staged.
- PR-Agent checks out or executes PR-controlled source with the provider key.
- Any log, task artifact, or public diff exposes a credential or forbidden raw
  pilot content.
- Provider execution, GitHub permissions, or the finding surface is ambiguous.

## Rollback Points

- Before provider execution: abandon the private pilot change and remove no
  existing resources.
- After installation but before a successful run: disable the workflow and
  use the installer ownership record for an idempotent retry or uninstall.
- After a failed run: preserve Actions history for reconciliation, disable the
  workflow, and do not retry through a fallback provider or model.
- Never delete the provider secret without separate explicit authorization.
