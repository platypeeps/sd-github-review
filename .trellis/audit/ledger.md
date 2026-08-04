# Audit ledger
Committed cross-session audit findings managed by sd-audit-repo.

## A-001 — Authorized Copilot rerequests are suppressed as duplicates
- status: fixed
- notes: Trellis owner `08-04-harden-copilot-rerequest-dispatch` (dedicated audit child; reassigned from `07-25-integrate-copilot-review-adapter` 2026-08-04); verified fixed on main (2026-08-04) — `src/reviewer-dispatch.js` `requestCopilotReviewer` gained a `forceRerequest` path that bypasses `alreadyReviewed` and removes-then-re-requests an `alreadyRequested` reviewer, plumbed from `src/operations.js` as `Boolean(request.rerequestOf) && rerequest-authorized`; `src/github.js` gained `removeRequestedReviewer` (DELETE requested_reviewers). Receipt/identity dedup was already correct via attempt-keyed logicalDispatchId. Regression tests: operations.test.js "policy-authorized Copilot rerequest issues a new native review while replay stays suppressed" + shared-service-parity forced cases; full suite 224/224. Note: the fix issues a fresh review request; GitHub re-notification of the Copilot bot on remove+re-add is external behavior not exercised by the fake client.
- severity: P1 · effort: S · confidence: Verified
- dimension: correctness
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/receipt.js:476 — a new authorized attempt can permit dispatch.
  - src/operations.js:401 — a prior exact-head review suppresses the new request.
- why: A valid rerequest creates a new receipt without requesting a new review.
- fix: Distinguish authorized rerequests from replay while retaining pending-request deduplication.

## A-002 — A PR-number override can route one PR and mutate another
- status: fixed
- notes: Trellis owner `07-25-harden-pull-request-identity-overrides`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — src/index.js resolvePullRequestNumber binds one PR identity, strictly decodes the pr-number override, and rejects an override that conflicts with the event-carried PR number; the single pullRequestNumber threads through metadata, reads, and mutations. Shipped via PR #31.
- severity: P1 · effort: S · confidence: Verified
- dimension: correctness
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/index.js:138 — the override is parsed independently and permissively.
  - src/index.js:179 — event metadata remains the routing source.
  - src/index.js:235 — mutations use the override target.
- why: Routing facts and reviewer side effects can target different PRs.
- fix: Strictly parse and bind one PR identity across metadata, reads, and mutations.

## A-003 — Concurrent begins can duplicate durable receipts and wedge an identity
- status: fixed
- notes: Trellis owner `07-25-make-durable-receipt-creation-concurrency-safe`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — src/receipt.js elects a canonical fingerprint and rejects conflicting durable receipts.
- severity: P1 · effort: M · confidence: Verified
- dimension: correctness
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/receipt.js:486 — read-before-create has no atomic uniqueness boundary.
  - src/receipt.js:323 — duplicate logical identities make later reads fail.
- why: Two concurrent runs can both authorize dispatch and permanently break later receipt operations.
- fix: Elect one authoritative Check Run and reconcile duplicates before dispatch.

## A-004 — Third-party PR-Agent receives durable-receipt authority
- status: fixed
- notes: Trellis owner `08-04-isolate-pr-agent-receipt-authority` (dedicated audit child; reassigned from `07-25-integrate-pr-agent-review-adapter` 2026-08-04); verified fixed on main (2026-08-04) — `examples/pr-agent-on-demand-review-router.yml` split into three jobs: `review` and `finalize` hold `checks: write` for receipt writing; the third-party `pr-agent` reviewer job holds only `contents: read` + `pull-requests: write`, so its `github.token` cannot forge durable receipts. Workflow-level permissions reduced to `contents: read`. `test/metadata.test.js` asserts the reviewer job lacks `checks`/`issues` (A-004 regression lock); npm test 224/224, validate:metadata clean. The installer-shipped `pr-agent-router.yml` grants no `checks: write` and was already receipt-safe.
- severity: P1 · effort: M · confidence: Verified
- dimension: security
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - examples/pr-agent-on-demand-review-router.yml:28 — the reviewer job has checks write permission.
  - examples/pr-agent-on-demand-review-router.yml:90 — the same token enters the reviewer container.
- why: A compromised reviewer can forge receipt state used for dispatch deduplication.
- fix: Isolate reviewer execution from the dedicated receipt-writing job and token.

## A-005 — Installer writes can escape through symlinked path ancestors
- status: fixed
- notes: Trellis owner `07-25-reject-symlinked-installer-targets`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — scripts/consumer-installer.mjs canonicalizes ancestors via lstat and refuses symlinked ancestors before writes/renames.
- severity: P1 · effort: M · confidence: Verified
- dimension: security
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - scripts/consumer-installer.mjs:438 — destinations are joined without canonicalizing ancestors.
  - scripts/consumer-installer.mjs:242 — writes and renames follow existing symlinked ancestors.
- why: A repository-controlled symlink can redirect fixed-name writes outside the checkout.
- fix: Reject symlinked ancestors and revalidate containment immediately before mutation.

## A-006 — Shipped process boundaries are untested and CI has no coverage gate
- status: fixed
- notes: Trellis owner `07-25-test-shipped-review-process-boundaries`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — subprocess boundary tests (action-entrypoint.test.js, installer-entrypoint.test.js) exist and ci.yml runs npm run test:coverage.
- severity: P1 · effort: M · confidence: Verified
- dimension: testing
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - test/consumer-installer.test.js:7 — tests bypass the production CLI and real GitHub CLI transport.
  - action.yml:193 — the shipped Action entrypoint is not exercised as a process.
  - .github/workflows/ci.yml:20 — CI enforces no coverage floor.
- why: Entrypoint, exit, transport, stdin, and redaction regressions can remain green.
- fix: Add subprocess boundary tests and conservative critical-file coverage gates.

## A-007 — The only release lacks the current installer and working PR-Agent template
- status: fixed
- notes: Trellis owner `07-25-publish-traceable-installer-release`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — release v0.2.0 published and scripts/consumer-installer.mjs writes schema-2 manifests with source provenance.
- severity: P1 · effort: M · confidence: Verified
- dimension: release-hygiene
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - README.md:38 — current guidance invokes the post-release installer.
  - SETUP-PR-AGENT.md:19 — current docs reject the release's Docker Action pattern.
  - v0.1.0:examples/pr-agent-router.yml:61 — the only tag retains that incompatible pattern.
  - scripts/consumer-installer.mjs:530 — manifests omit source release identity.
- why: Release-pinned consumers cannot follow current guidance or prove installer provenance.
- fix: Publish a traceable release and enforce identity, migration, version, and pin synchronization.

## A-008 — Routing responsibility is split across protocol, event, and mode composition
- status: fixed
- notes: Trellis owner `07-25-consolidate-routing-policy-boundaries`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — router.js is the single policy owner via the decodeRoutingInputs edge; protocol.js and receipt.js no longer import router.js.
- severity: P2 · effort: M · confidence: Plausible
- dimension: architecture
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/protocol.js:975 — protocol code owns route policy.
  - src/index.js:170 — standalone mode composes policy and dispatch.
  - src/operations.js:333 — durable mode repeats composition.
- why: Policy, codecs, and modes can drift and cannot evolve independently.
- fix: Centralize normalized policy and shared dispatch services behind thin composition roots.

## A-009 — The consumer installer is an undecomposed lifecycle subsystem
- status: open
- notes: Trellis owner `07-25-decompose-consumer-installer-lifecycle`; remediation planning created 2026-07-25.
- severity: P2 · effort: M · confidence: Plausible
- dimension: architecture
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - scripts/consumer-installer.mjs:115 — one module owns transport.
  - scripts/consumer-installer.mjs:273 — the same module owns validation.
  - scripts/consumer-installer.mjs:487 — the same module owns planning and mutation.
- why: Lifecycle concerns cannot change independently as migration and rollback grow.
- fix: Split codecs, planning, transport, persistence, and orchestration.

## A-010 — The Action contract is neither operation-specific nor mechanically aligned
- status: open
- notes: Trellis owner `07-25-define-operation-specific-action-contract`; remediation planning created 2026-07-25.
- severity: P2 · effort: M · confidence: Plausible
- dimension: design
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - action.yml:6 — one global input contract covers incompatible operation needs.
  - src/operations.js:517 — acknowledgment does not need a GitHub client.
  - scripts/validate-action-metadata.mjs:206 — validation does not compare runtime semantics.
- why: Metadata, runtime parsing, permissions, and documentation can drift independently.
- fix: Define and validate a shared tagged operation contract or thin wrappers.

## A-011 — Lower-priority label conflicts can block fixed modes and trusted commands
- status: fixed
- notes: Trellis owner `08-04-apply-control-precedence-before-labels` (dedicated audit child; reassigned from `07-25-authorize-budget-aware-review-plans` 2026-08-04); verified fixed on main (2026-08-04) — `src/index.js` now resolves `commandMode` (trusted `/review`) before parsing labels and computes `higherPrecedenceMode = configuredMode !== "auto" ? configuredMode : commandMode`; `modeFromLabels(labels)` (the conflict-throwing parse) runs only when `higherPrecedenceMode` is falsy, so a fixed mode or trusted command routes past conflicting `review:*` labels instead of throwing. `resolveExplicitMode` already discarded `labelMode` in those cases, so non-conflict routes are unchanged. Auto mode with no trusted command still throws on conflict (no silent misroute). `modeFromLabels` throw contract untouched (`test/router.test.js:111` green). Regression tests: `test/action.test.js` A-011 cases (fixed mode / trusted command route despite conflicting labels; auto+conflict still throws); npm test 227/227, check:full 0 failures.
- severity: P2 · effort: S · confidence: Plausible
- dimension: correctness
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/index.js:179 — labels are normalized before higher-priority controls.
  - src/router.js:71 — conflicting labels throw.
- why: Fixed mode and trusted commands cannot recover conflicting route labels.
- fix: Apply configured and trusted-command precedence before label parsing.

## A-012 — External calls have no execution timeout
- status: fixed
- notes: Trellis owner `07-25-bound-review-remote-operations`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — src/github.js bounds fetch with a timeout/abort and scripts/consumer-installer.mjs applies a per-command child-process timeout.
- severity: P2 · effort: S · confidence: Plausible
- dimension: correctness
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/github.js:156 — fetch has no abort signal.
  - scripts/consumer-installer.mjs:89 — child processes have no timeout.
- why: Network or subprocess stalls can hang finite workflows until platform termination.
- fix: Add bounded per-attempt and child-process timeouts with explicit errors.

## A-013 — An interrupted update can leave pending state that cannot resume
- status: fixed
- notes: Trellis owner `08-04-resume-interrupted-installer-update` (dedicated audit child; reassigned from `07-25-manage-compiled-review-configuration-promotion` 2026-08-04); verified fixed on main (2026-08-04) — `scripts/consumer-installer.mjs` `assertWorkflowCanBeManaged` now scopes the workflow-modification guard to non-pending manifests (`local.manifest.state !== "pending"` conjunct). An `install`/`update` interrupted after the pending-manifest write but before the workflow replacement leaves a pending manifest recording the new hash while disk holds the old workflow; `installOrUpdate` rewrites the workflow unconditionally, so that mismatch is expected interrupted state and now resumes instead of throwing `modified after installation`. Active-install operator-drift protection is unchanged (locked by a regression test). No manifest schema change (the audit's stage-artifacts alternative was unnecessary). Regression tests: `test/consumer-installer.test.js` "resumes an update interrupted before the workflow was replaced (A-013)" + "active install still rejects an operator-modified workflow (A-013 lock)"; npm test 229/229, check:full 0 failures. Sole guard caller is `installOrUpdate`; pending is written only mid-transaction (install/update/adopt), never persisted, so relaxing it cannot clobber a completed operator install.
- severity: P2 · effort: M · confidence: Plausible
- dimension: correctness
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - scripts/consumer-installer.mjs:633 — pending manifest is written before workflow replacement.
  - scripts/consumer-installer.mjs:478 — the known old workflow is rejected after interruption.
- why: Installer-owned interrupted state is indistinguishable from operator drift.
- fix: Preserve prior hashes or stage artifacts so recovery can resume safely.

## A-014 — Empty sensitive-path policy still paginates every PR file
- status: open
- notes: Trellis owner `07-25-skip-irrelevant-pr-file-enumeration`; remediation planning created 2026-07-25.
- severity: P2 · effort: S · confidence: Plausible
- dimension: performance
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/index.js:207 — standalone loading ignores empty patterns.
  - src/operations.js:340 — durable routing loads files before parsing patterns.
- why: Disabled path routing still consumes latency and GitHub quota.
- fix: Enumerate files only when at least one sensitive pattern exists.

## A-015 — Same-head rerequests load the same receipt set twice
- status: open
- notes: Trellis owner `07-25-reuse-receipt-snapshots-during-rerequests`; remediation planning created 2026-07-25.
- severity: P2 · effort: S · confidence: Plausible
- dimension: performance
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/receipt.js:396 — rerequest validation loads current-head records.
  - src/receipt.js:486 — begin immediately reloads the same identity records.
- why: Rerequests duplicate Check Run latency and quota use.
- fix: Reuse one current-head receipt snapshot throughout begin.

## A-016 — OpenCode plugin dependency is unlocked and apparently unused
- status: open
- notes: Trellis owner `07-25-resolve-opencode-plugin-dependency`; remediation planning created 2026-07-25.
- severity: P2 · effort: S · confidence: Plausible
- dimension: dependencies
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - .opencode/package.json:2 — the nested ranged dependency has no lockfile.
  - .opencode/package.json:4 — no code reference to the package exists.
- why: Executable dependency code can drift outside root locking and auditing.
- fix: Remove the declaration or freeze and audit the nested install.

## A-017 — The prescribed local full-check skips every CI package gate
- status: fixed
- notes: Trellis owner `07-25-align-local-full-check-with-ci`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — package.json check:full runs test, test:coverage, check, validate:metadata, validate:ci-parity, and validate:ci-parity enforces CI/local gate parity.
- severity: P2 · effort: S · confidence: Plausible
- dimension: tooling
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - scripts/sd-ai-command-pack-full-check.sh:1033 — generic stages omit package script names.
  - package.json:12 — package-specific gates are test, check, and validate metadata.
  - .github/workflows/ci.yml:20 — CI runs all three.
- why: The prescribed local gate can pass after skipping every remote gate.
- fix: Configure the local gate to run exactly the package checks enforced by CI.

## A-018 — Guarded lifecycle support does not cover every first-party profile
- status: open
- notes: Trellis owner `07-25-deliver-routed-review-configuration`; remediation planning created 2026-07-25.
- severity: P2 · effort: L · confidence: Plausible
- dimension: improvements
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - README.md:24 — lifecycle support is limited to event-driven PR-Agent.
  - SETUP-COPILOT.md:55 — Copilot setup remains manual.
- why: Supported profiles lack consistent ownership, drift, update, rollback, and uninstall safety.
- fix: Drive every first-party profile through one declarative lifecycle engine.

## A-019 — Installer cannot adopt existing manual installations
- status: fixed
- notes: Trellis owner `07-25-adopt-manual-review-installations`; remediation planning created 2026-07-25; verified fixed on main @ a546883 (2026-08-04) — scripts/consumer-installer.mjs carries an A-019 adoption registry of approved historical hashes for safe adoption.
- severity: P2 · effort: M · confidence: Plausible
- dimension: consumer-impact
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - SETUP-PR-AGENT.md:207 — manual workflow copying is supported.
  - scripts/consumer-installer.mjs:458 — unmanaged differing workflows are rejected.
- why: Manual and v0.1.0 consumers cannot transition safely into managed updates.
- fix: Add explicit adoption for approved historical hashes with semantic review and rollback.

## A-020 — Exported review-label registry is mutable
- status: open
- notes: Trellis owner `07-25-encapsulate-review-label-registry`; remediation planning created 2026-07-25.
- severity: P3 · effort: S · confidence: Plausible
- dimension: design
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - src/router.js:167 — a mutable Set is exported.
- why: Importers can silently alter routing label behavior for the process.
- fix: Export a predicate or immutable collection instead.

## A-021 — `hasManagedFiles` is an unreachable public export
- status: open
- notes: Trellis owner `07-25-remove-unused-installer-export`; remediation planning created 2026-07-25.
- severity: P3 · effort: S · confidence: Plausible
- dimension: bloat
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - scripts/consumer-installer.mjs:890 — only the definition references the symbol.
- why: The helper expands the supported surface without serving behavior.
- fix: Delete the unused export.

## A-022 — Consumer installation serializes independent GitHub CLI calls
- status: open
- notes: Trellis owner `07-25-parallelize-installer-github-operations`; remediation planning created 2026-07-25.
- severity: P3 · effort: M · confidence: Plausible
- dimension: performance
- first-seen: 2026-07-25 @ 2eeca60
- last-seen: 2026-07-25 @ 2eeca60
- evidence:
  - scripts/consumer-installer.mjs:90 — commands use blocking spawnSync.
  - scripts/consumer-installer.mjs:117 — independent inspections run serially.
- why: Cold installation time is the sum of every process and network round trip.
- fix: Use asynchronous bounded concurrency while keeping state transitions ordered.
