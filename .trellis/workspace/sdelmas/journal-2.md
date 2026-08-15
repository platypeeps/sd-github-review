# Journal - sdelmas (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-08-05

---



## Session 50: Ship deferred review recovery contract (PR #51)

**Date**: 2026-08-05
**Task**: Ship deferred review recovery contract (PR #51)
**Branch**: `feat/07-25-define-deferred-review-recovery`

### Summary

Work-loop iteration 4: implemented the pure-leaf deferred review recovery contract, converged the Copilot review loop (one real fix + one evidenced rebuttal), and finalized for merge.

### Main Changes

- Added src/review-deferred-recovery.js: bounded deferred records, explicit idempotent authorized recovery with distinct linked attempts, changed-head supersession, exact-head Check projection with monotonic revision + compare-and-swap, repository-lifecycle eligibility, injected-time retention classification wired into retention-policy.js
- Fixed Copilot round-1 finding: cross-tenant transfer kept identity immutable (destination tenant now non-key audit metadata) so digest-addressed deferralFingerprint/headKey stay consistent with stored identity; rebutted the collection-cardinality finding with per-record/retention bound evidence


### Git Commits

| Hash | Message |
|------|---------|
| `bbd720a` | feat: add deferred review recovery contract |
| `ff20e5a` | fix: keep deferred-recovery identity immutable across cross-tenant transfer |
| `7680c5b39870735a83e701d4918cc2920363fb6f` | chore(task): archive 07-25-define-deferred-review-recovery |

### Testing

- [OK] node --test test/review-deferred-recovery.test.js: 38/38 pass
- [OK] node --test full suite: 579/579 pass
- [OK] npm run check: exit 0
- [OK] sd-check gate 7/7; Prism 0 findings; Gito no issues; Copilot round 2 clean (0 unresolved threads)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 51: Ship v2 review:none enforcement + local-attestation envelope proofs (08-04)

**Date**: 2026-08-05
**Task**: Ship v2 review:none enforcement + local-attestation envelope proofs (08-04)
**Branch**: `feat/08-04-define-v2-local-attestation-envelope`

### Summary

Closed the review:none under-enforcement hole in decodeReviewOutcomes with two fail-closed guards keyed on the reason code, and added AC-mapped fixtures/tests proving the envelope binding (AC1), review:none enforcement (AC2a), and v1-receipt rejection (AC2b). Three-round planning-adversarial review (host + Codex) converged clean; both review providers (Prism advisory-only, Copilot no comments) clean on PR #52.

### Main Changes

- decodeReviewOutcomes: review_none reason can neither satisfy assurance nor free the gate (two guards, reason-keyed, independent-axes preserved)
- Added sanctioned review:none valid outcome + three invalid review_none outcomes (incl. {completed,review_none} full-pass hole)
- AC1/AC2a/AC2b tests; AC2b passes real v1 receipts directly to v2 local decoders (schema-major rejection)


### Git Commits

| Hash | Message |
|------|---------|
| `9026211` | feat(protocol-v2): enforce review:none gate/assurance and prove v1 rejection |
| `78bb5df` | chore(task): record branch for 08-04-define-v2-local-attestation-envelope |
| `338b560` | chore(task): archive 08-04-define-v2-local-attestation-envelope |

### Testing

- [OK] node --test test/protocol-v2.test.js: 49/49
- [OK] npm test: 582/582
- [OK] npm run test:coverage x2: 93.0% lines / 82.4% branches (above floors)
- [OK] npm run check, validate:metadata, validate:ci-parity
- [OK] deterministic sd-check 7/7; review-preflight 0 failures

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 52: Ship v2 quarantine status and clearance contracts (task 08-04)

**Date**: 2026-08-05
**Task**: Ship v2 quarantine status and clearance contracts (task 08-04)
**Branch**: `feat/08-04-define-v2-quarantine-clearance-contracts`

### Summary

Added three fail-closed v2 decoders (quarantine status, clearance request, clearance response) completing parent AC13, plus residual outcome reason-code fixtures for input_ineligible/incomplete_token_limit/budget_overrun/candidate_quarantined (parent AC10 residual). Shipped via PR #53.

### Main Changes

- decodeQuarantineStatus enforces decisionFingerprint<->state invariant and cross-links cleared status to clearing response fingerprint
- decodeClearanceRequest kept identity-/authority-free via extended forbidden-field walk; decodeClearanceResponse binds audit identity + requestFingerprint
- Added valid/invalid fixtures for three contracts and four residual outcome reason codes


### Git Commits

| Hash | Message |
|------|---------|
| `33e31ca` | feat: add v2 quarantine status and clearance contracts |
| `7c6dfeb` | chore(task): archive 08-04-define-v2-quarantine-clearance-contracts |

### Testing

- [OK] npm test: 588 pass / 0 fail
- [OK] npm run test:coverage: 93.11% lines / 82.49% branches / 97.17% funcs
- [OK] check, validate:metadata, validate:ci-parity green; Prism 0 findings; Copilot 0 comments

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 53: Ship v2 standard-v1 deletion-receipt decoder + residual retention fixtures (PR #54)

**Date**: 2026-08-05
**Task**: Ship v2 standard-v1 deletion-receipt decoder + residual retention fixtures (PR #54)
**Branch**: `feat/08-04-define-v2-retention-standard-v1-contracts`

### Summary

Added decodeDeletionReceipt (idempotent, digest-self-verifying, status-gated deadlines, recursive authority deny-list) and the four residual AC2 fixture families to complete the parent retention contract. Converged Copilot review: fixed nested-authority bypass and size-gate ordering.

### Main Changes

- decodeDeletionReceipt: digest recompute over {tenant,repository,actor,reason,requestId,requestedAt}; status-gated deletedAt (live 7d / backup 35d); deadlines hard-asserted to standard-v1
- Recursive authority deny-list (rejectFieldNames) rejects request-form + result-form grants at any nesting depth; size-gate runs first
- Residual AC2 fixtures: destructive-authorization, transfer/removal lifecycle, deletion-journal restore, coverage-gaps (5 valid/invalid pairs, self-validated)


### Git Commits

| Hash | Message |
|------|---------|
| `94edfac` | feat: add v2 standard-v1 deletion-receipt decoder and residual retention fixtures |
| `b704e95` | fix: reject deletion-receipt authority grants at any nesting depth |
| `5a9fd57` | refactor: size-gate deletion-receipt before the authority walk |
| `391ed90` | chore(task): archive 08-04-define-v2-retention-standard-v1-contracts |

### Testing

- [OK] npm test — 595 pass / 0 fail
- [OK] npm run test:coverage — 93.22% lines / 82.76% branches / 97.18% funcs
- [OK] check + validate:metadata + validate:ci-parity + review-preflight (0 fail)
- [OK] Copilot PR #54 — APPROVED after 2 verified fixes

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 54: Move the published setup descriptor off the consumer discovery path

**Date**: 2026-08-09
**Task**: Move the published setup descriptor off the consumer discovery path
**Branch**: `feat/08-09-descriptor-contract-path`

### Summary

This repository published routed-review-setup-v1.json at config/, the single path the consumer setup-discovery probe reads, so probing this repository classified it as having the durable on-demand lane installed and then failed looking up workflow metadata that does not exist. Moved the published copy to contract/ and classified every reference into readers that move, consumer instructions that must name both paths, and consumer-probe references that stay.

### Main Changes

- Moved config/routed-review-setup-v1.json to contract/ and repointed every reader: validate-action-metadata.mjs, test/metadata.test.js, test/operation-contract.test.js, DESIGN.md, and two backend specs
- Kept config/ as the documented consumer install destination in README, SETUP-COPILOT, and SETUP-PR-AGENT, and stated the published-versus-installed distinction explicitly in DESIGN.md
- Recorded the path rule as a Wrong/Correct pair in .trellis/spec/backend/consumer-installer.md so a future edit cannot move the file back silently
- Fixed a Copilot finding in 08-08-installer-durable-lane: its prerequisite grep matched the bare basename, returning identical hits before and after the move, so it could never fail
- Parked 08-08-installer-durable-lane on this task and redirected its design D1


### Git Commits

| Hash | Message |
|------|---------|
| `38a8042` | fix(contract): publish the setup descriptor at contract/, off the probe path |
| `4eea38d` | docs(spec): record the published-descriptor path rule as a consumer-installer contract |
| `32a156b` | docs: name both descriptor paths instead of a mismatched link |
| `e25d0d2` | docs: state the descriptor source and destination as an explicit copy |
| `aa750e3` | fix(task): make the 08-08 prerequisite check able to fail |
| `3a89173` | docs(task): reconcile the descriptor grep counts with the shipped tree |
| `d930ffe` | chore(task): record the task branch before finalization |

### Testing

- [OK] npm test: 608 tests, 608 pass, 0 fail
- [OK] npm run validate:metadata: 1171 tracked public paths, pinned to v0.3.0
- [OK] typed sd-check: 7/7 passed
- [OK] review preflight: 0 failures, 1 warning (two task directories, the documented split)
- [OK] setup probe against this repository: absent / setup-descriptor-absent (was unavailable / HTTP 404)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 55: Follow-ups from the descriptor contract-path ship

**Date**: 2026-08-09
**Task**: Follow-ups from the descriptor contract-path ship
**Branch**: `chore/08-09-followups`

### Summary

Cleared the blockedOn marker on 08-08-installer-durable-lane now that 08-09-descriptor-contract-path merged in #68, and recorded the review-coordinator state-replay defect found while shipping it as its own task with a reproduction and evidence.

### Main Changes

- Removed blockedOn from 08-08-installer-durable-lane so the backlog ranker can select it; 08-08-fleet-rollout-smoke correctly stays blocked on 08-08
- Created 08-09-review-coordinator-stale-check with the cached-check reproduction, the _state_identity analysis, and a correction of the two earlier environment-isolation misdiagnoses


### Git Commits

| Hash | Message |
|------|---------|
| `7e854554eb52d55867219462017d40e4457eee77` | chore(task): unblock the installer lane and record the coordinator replay defect |

### Testing

- [OK] sd-review scope=pr on #69: ready, local clean, 0 findings
- [OK] typed sd-check: 7/7 passed
- [OK] review preflight: 0 failures

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 56: Installer ships the discovery descriptor and the durable sd-review.yml lane

**Date**: 2026-08-09
**Task**: Installer ships the discovery descriptor and the durable sd-review.yml lane
**Branch**: `feat/08-08-installer-durable-lane`

### Summary

Added the durable workflow_dispatch lane and the setup discovery descriptor to the consumer installer alongside the event-driven lane, bumped the consumer manifest to schema 3 with version-tier gating, and derived every managed-resource list from one table.

### Main Changes

- Added examples/sd-review.yml, the durable workflow_dispatch template declaring the workflow name the descriptor names
- Bumped the consumer manifest 2 -> 3 with descriptor and durableWorkflow ownership blocks; the decoder admits 1, 2, and 3 and gates each invariant on the version it was introduced at, never on equality with the current constant
- Extended all five guards (collision, check drift, check source freshness, update overwrite refusal, uninstall removal refusal) to both new resources, with the schema-2 migration using the collision guard rather than the overwrite guard
- Made released: true require every copied source artifact clean, not just the event-driven template
- Made a converged run perform no work at all: empty actions, no GitHub calls, no filesystem write
- Introduced MANAGED_RESOURCES as the single source of truth and derived every dependent list from it, closing the review-recurrence drift the repo's own prism rules target


### Git Commits

| Hash | Message |
|------|---------|
| `64f0a2b` | feat(installer): install the setup descriptor and the durable sd-review.yml lane |
| `ffe3917` | docs(spec): record the durable-lane contract and its two silent-failure traps |
| `d982841` | docs(spec): record the managed-resource enumeration sites as a contract |
| `2dd02f8` | refactor(installer): derive every managed-resource list from one table |
| `84da6b2` | refactor(installer): close the two residual managed-resource duplications |
| `8fffc76` | fix(installer): pass sources at both createManifest call sites, plus review fixes |
| `c9e49c7` | docs(task): check the two criteria PR #68 delivered, with reverified evidence |

### Testing

- [OK] npm test: 635 passing / 0 failing (baseline 608/0)
- [OK] npm run test:coverage: OK (global 94.08% lines / 84.86% branches / 95.18% funcs)
- [OK] npm run check, validate:metadata (7 examples), validate:ci-parity: all OK
- [OK] end-to-end against this repository as the installer source: 21/21 assertions
- [OK] mutation testing: removing one MANAGED_RESOURCES entry fails 48 tests; the naive hash-only convergence predicate fails 6; provenance gated on equality fails the schema-2 test
- [OK] review preflight and pre-archive gate: 0 failures

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 57: Record the two review-gate defects surfaced by PR #70

**Date**: 2026-08-09
**Task**: Record the two review-gate defects surfaced by PR #70
**Branch**: `docs/08-09-pr70-followups`

### Summary

Captured the follow-up defects PR #70 exposed as Trellis task records: a fourth recurrence of the review coordinator replaying a stale sd-check failure, and a new task for the local review gate that cannot converge when providers emit advisory-only findings. Filled the new task's context manifests with the specs a sub-agent needs.

### Main Changes

- Added a fourth-recurrence section to 08-09-review-coordinator-stale-check documenting the per-attempt cache evidence from PR #70 and correcting the record: --attempt-id is a real CLI flag, just undocumented in the sd-review skill.
- Created task 08-09-review-gate-advisory-convergence for the _remote_gate blocking-on-any-finding defect, with the 3-round/30-finding/0-defect evidence table from PR #70.
- Replaced the generated _example scaffold rows in the new task's check.jsonl and implement.jsonl with real spec references (directory-structure, error-handling, quality-guidelines).


### Git Commits

| Hash | Message |
|------|---------|
| `34a5372` | chore(task): record the two review-gate defects PR #70 surfaced |
| `0e89282` | docs(task): fill review-gate-advisory-convergence context manifests |

### Testing

- [OK] sd-review scope=pr attempt 2: status ready, sd-check passed, 0 findings, remoteGate eligible
- [OK] node scripts/sd-ai-command-pack-review-preflight.mjs: 0 failures, 1 warning (two task directories in one PR)
- [OK] every spec path referenced by the two manifests resolves to an existing file

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 58: Park the two review-defect tasks on upstream ownership

**Date**: 2026-08-09
**Task**: Park the two review-defect tasks on upstream ownership
**Branch**: `feat/08-09-review-coordinator-stale-check`

### Summary

Established that scripts/sd-ai-command-pack-review.py is vendored from sd-ai-command-pack, so neither the stale-check replay nor the advisory non-convergence defect can be fixed in this repository. Filed this repository's evidence against the existing upstream tasks (platypeeps/sd-ai-command-pack#406), parked both local tasks on that upstream boundary, marked the local design and implementation plan superseded because upstream requires recompute-every-run rather than the pass-only reuse specified here, and recorded the vendored-pack ownership boundary in spec so a future task establishes ownership before planning.

### Main Changes

- Recorded upstream ownership in 08-09-review-coordinator-stale-check/prd.md: the owning task is 08-07-review-check-stale-cache upstream, and its recompute contract supersedes AC 3 and the third requirement here
- Marked design.md and implement.md superseded — they specify pass-only reuse, which the upstream PRD explicitly rejects ('Do not resurrect the reuse AC')
- Parked 08-09-review-gate-advisory-convergence on the same boundary; upstream PR #402 already shipped part of the fix
- Set blockedOn on both task.json records to name the upstream task and PR #406, with notes explaining why status still reads in_progress/planning (Trellis has no parked status)
- Added the vendored-pack ownership boundary to .trellis/spec/backend/directory-structure.md, deriving the editable set from pack.install-audit rather than a list that can go stale
- Added a pre-implementation checklist item to .trellis/spec/guides/cross-layer-thinking-guide.md: git log a path and treat refresh-only history as upstream ownership


### Git Commits

| Hash | Message |
|------|---------|
| `b644fc2` | docs(task): plan the review-coordinator stale-check fix |
| `a0b51c3` | chore(task): park review-coordinator-stale-check on upstream ownership |
| `9e52f31` | chore(task): park review-gate-advisory-convergence on the same boundary |
| `34703c8` | docs(task): record upstream ownership and supersede the local design |
| `109d5d6` | docs(spec): record the vendored pack-file ownership boundary |
| `1eb519c` | fix(review): resolve prism findings on the parked-task records |

### Testing

- [OK] sd-check standalone: 7/7 passed after KB refresh (copies 500/500, conflicts none)
- [OK] sd-review scope=pr round 2 at head 1eb519c: seven editable findings fixed, two refuted against the checkout as factually false
- [OK] PR #72 required checks green; MERGEABLE / CLEAN, zero unresolved review threads
- [BLOCKED] sd-review coordinator replayed the stale knowledge.obsidian-kb failure a sixth time; escaped with --attempt-id review-1eb519c-kbfresh. Both documented escapes (local=none, --successor bookkeeping) return outcome: skipped, which the clean-receipt rule refuses

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 59: Refresh SD AI command pack to 0.71.2

**Date**: 2026-08-12
**Task**: Refresh SD AI command pack to 0.71.2
**Branch**: `chore/sd-ai-command-pack-0.71.2`

### Summary

Installed the immutable v0.71.2 release for claude, gemini, github, and opencode; install audit passed 199 targets, all three candidate checks and the local gate were clean.

### Main Changes

- Installed sd-ai-command-pack 0.71.2 for four platforms


### Git Commits

| Hash | Message |
|------|---------|
| `eeb93971f614f46d29296f1fb13652cb5db81d59` | chore: refresh SD AI command pack to 0.71.2 |

### Testing

- [OK] npm test, npm run check, npm run validate:metadata: all pass
- [OK] scripts/sd-ai-command-pack-check.py --json: passed (6 passed, 0 failed, state guard clean)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 60: sd-ai-command-pack 0.71.4 refresh

**Date**: 2026-08-13
**Task**: sd-ai-command-pack 0.71.4 refresh
**Branch**: `chore/sd-ai-command-pack-0.71.4`

### Summary

Refreshed the vendored sd-ai-command-pack from 0.71.2 to the 0.71.4 corrective release and carried forward four installer targets that had drifted from the recorded 0.71.2 payload.

### Main Changes

- Installed sd-ai-command-pack 0.71.4; provenance and manifest records updated.
- Force-carried four installer targets after confirming their history holds only pack-refresh commits.


### Git Commits

| Hash | Message |
|------|---------|
| `b24257b5915532ba0e9a86c5da7b8876cc77eb4f` | chore(sd-ai-command-pack): refresh vendored pack 0.71.2 -> 0.71.4 |

### Testing

- [OK] install audit: 199 targets checked, provenance 0.71.4, vouched file hashes match
- [OK] npm test: 635 passed, 0 failed
- [OK] npm run check and npm run validate:metadata: passed
- [OK] sd-check: 6 passed, 1 skipped (obsidian-kb advisory), 0 failed

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 61: sd-ai-command-pack 0.71.5 refresh

**Date**: 2026-08-14
**Task**: sd-ai-command-pack 0.71.5 refresh
**Branch**: `chore/sd-ai-command-pack-0.71.5`

### Summary

Installed sd-ai-command-pack v0.71.5 over 0.71.4 in the second post-canary wave of fleet campaign refresh-0.71.5-20260814T113545Z. The changed always-files installed as updates with no conflict and no --force, against the corrected installer.

### Main Changes

- Installed the immutable v0.71.5 payload (source commit e115c70f, digest sha256:365af6fe); audit reports preserved=1, unchanged=198.
- Left .github/PULL_REQUEST_TEMPLATE.md preserved as locally owned.
- Recorded the refresh as an archived Trellis task rather than an unattributed installer diff.


### Git Commits

| Hash | Message |
|------|---------|
| `3a2c74f784877a6c19cc5baed15c376a350583cc` | chore: refresh sd-ai-command-pack to 0.71.5 |

### Testing

- [OK] install.py --check --audit: installed version 0.71.5, planned changes 0, audit passed
- [OK] npm test: 635 passing, 0 failing
- [OK] npm run check and npm run validate:metadata: passed
- [OK] sd-check: 6 passed, 0 failed, 1 skipped (external-symlinked .obsidian-kb advisory)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 62: chore: refresh sd-ai-command-pack to 0.71.6

**Date**: 2026-08-14
**Task**: chore: refresh sd-ai-command-pack to 0.71.6
**Branch**: `chore/sd-ai-command-pack-0-71-6`

### Summary

Fleet campaign refresh-0.71.6-20260814T170234Z, post-canary wave 2 (sd-github-review): install 0.71.6 over 0.71.5 and archive the dedicated task inside the published head.

### Main Changes

- Installed sd-ai-command-pack 0.71.6 over 0.71.5 through the vouched-upgrade path


### Git Commits

| Hash | Message |
|------|---------|
| `39460db768aa77bcbca64c573f73bfea395ad9e7` | chore: refresh sd-ai-command-pack to 0.71.6 |

### Testing

- [OK] install audit: 199 targets, provenance 0.71.6, vouched hashes match
- [OK] sd-check --json: passed (6 passed, 1 skipped, 0 failed)
- [OK] npm test, npm run check, npm run validate:metadata: passed

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 63: Close review-coordinator stale-check on the shipped upstream fix

**Date**: 2026-08-15
**Task**: Close review-coordinator stale-check on the shipped upstream fix
**Branch**: `feat/08-09-review-coordinator-stale-check`

### Summary

Verified that the upstream recompute fix for the sd-review stale deterministic-check replay reached this repository, resolved the task without a local code change, and captured the park-hygiene rule the three-day miss earned.

### Main Changes

- Cleared the stale PARKED: prefix and blocked/blockedOn markers on 08-09-review-coordinator-stale-check; the backlog ranker went from 1 actionable task to 2
- Recorded in prd.md that review.py:1931 now recomputes the deterministic check unconditionally and :1943 persists it only on a pass, arriving in 49f65dc (0.71.1) and unchanged through 0.71.6
- Resolved all five acceptance criteria against upstream coverage in ../sd-ai-command-pack/tests/test_review_controller.py:1483, :1558, :1626
- Dropped both planned local deliverables with reason: the contract test would duplicate upstream coverage of a vendored file, and the ownership convention already lived in the directory-structure spec
- Added the companion park-hygiene rule to .trellis/spec/backend/directory-structure.md: a park whose resume condition is a pack refresh is not cleared by the refresh happening, and must be verified against the vendored file rather than the pack version


### Git Commits

| Hash | Message |
|------|---------|
| `5e52330` | docs(task): close review-coordinator stale-check on the shipped upstream fix |
| `be8de04` | docs(task): check off the acceptance criteria the upstream fix satisfies |
| `5a2fc50` | chore: archive 08-09-review-coordinator-stale-check |

### Testing

- [OK] npm test: 635 pass, 0 fail
- [OK] node scripts/sd-ai-command-pack-review-preflight.mjs: 0 failures, 0 warnings
- [OK] sd-review scope=pr pr=80: status ready, sd-check 7/7 passed, prism local receipt clean
- [OK] pre-archive gate: status valid, pre_archive_valid
- [OK] work-loop rank: actionableCount 2, task ranked first and unblocked

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 64: Record machine-readable resume conditions on the parked backlog

**Date**: 2026-08-15
**Task**: Record machine-readable resume conditions on the parked backlog
**Branch**: `chore/parked-task-resume-conditions`

### Summary

Seventeen of eighteen active tasks were parked and sixteen said nothing about why: a PARKED: title prefix, no blockedOn, empty notes, rationale surviving only in the message of e2872da. All sixteen therefore ranked as candidate_block_status's bare fallback string 'parked'. Re-derived both premises of that park before writing anything, wrote the rationale plus its falsification recipe into each record's blockedOn, corrected 08-09-review-gate-advisory-convergence's now-wrong blockedOn, and captured the corollary in the directory-structure spec.

### Main Changes

- Wrote the e2872da scope-park rationale and its two falsification checks into the blockedOn of all sixteen prefix-only parked records, with a dated note pointing at this task
- Rewrote 08-09-review-gate-advisory-convergence's blockedOn: the rebuttal channel it waited on shipped (review.py:1790, review-local.py:1956), so three of four requirements are met and only the severity/category gate remains at review-local.py:900-905
- Added the park-hygiene corollary to .trellis/spec/backend/directory-structure.md -- park with a resume condition, not the prefix alone -- with a recipe that enumerates prefix-only parks from the filesystem instead of reciting a list
- Curated implement.jsonl and check.jsonl after review caught that task.py start had run against seed-only manifests, which workflow.md's ready gate excludes


### Git Commits

| Hash | Message |
|------|---------|
| `85a260f` | docs(task): record resume conditions on the 17 parked backlog tasks |
| `5d9e394` | docs(spec): require a resume condition, not just a PARKED: prefix |
| `45d01c5` | fix(task): curate the context manifests before the task was started |

### Testing

- [OK] npm test: 635 pass, 0 fail
- [OK] review-preflight: 0 failures, 1 warning (18 task directories, confirmed as one reviewable outcome)
- [OK] work-loop rank over the updated records: 17 blocked, bare-'parked' candidates 16 -> 0, actionableCount 2
- [OK] same rank against records at 9dbed23: 16 bare-'parked', proving the before/after rather than only the after
- [OK] task.py validate: passes for all 19 active task directories
- [OK] sd-review scope=pr pr=81: ready, sd-check 7/7, prism clean; 2 Copilot findings fixed and resolved
- [OK] pre-archive gate: pre_archive_valid

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 65: File the two follow-ups PR #81 earned, and correct one of them before merge

**Date**: 2026-08-15
**Task**: File the two follow-ups PR #81 earned, and correct one of them before merge
**Branch**: `chore/followup-tasks-from-pr-81`

### Summary

Filed task-manifest-ready-gate and remote-review-channel-authority as follow-ups from PR #81's review cycle. Checking the first one's premise before acting on it showed the premise was false: the seeded-task gate already exists at review-preflight.mjs:617 and is present in the installed copy; this repository simply never invokes it. Unparked and rescoped to repo-local wiring rather than filing an upstream PR for work already done. The second task records the hook-versus-sd-review contract conflict and the narrower cause behind it -- config/routed-review-setup-v1.json has never been authored here, so the router reports absent.

### Main Changes

- Filed 08-15-task-manifest-ready-gate and 08-15-remote-review-channel-authority
- Corrected the ready-gate task before merge: the seeded-task gate exists and works, verified in both directions against the installed copy, so the task is repo-local wiring at P2 rather than parked on upstream
- Curated context manifests on both new tasks and restored a trailing newline task.py create omits, after review caught the same seed-only manifest defect PR #81 was caught on
- Applied three review findings on the sibling record: full-path breadcrumb, explicit blockedOn null matching 18 of 19 sibling records, and wording that no longer implies design.md and implement.md exist


### Git Commits

| Hash | Message |
|------|---------|
| `28fd6a5` | docs(task): file the two follow-ups PR #81 earned |
| `a047494` | fix(task): curate the context manifests and restore a trailing newline |
| `dae66d9` | fix(task): unpark the ready gate -- it already exists, it is just never called |

### Testing

- [OK] npm test: 635 pass, 0 fail
- [OK] review-preflight: 0 failures, 1 warning (2 task directories, one reviewable outcome)
- [OK] seeded-task gate verified both directions: invalid on a seed-only task, valid on a curated one
- [OK] sd-review scope=pr pr=82: ready, sd-check passed, prism clean; 3 Copilot findings fixed and resolved
- [OK] work-loop rank: actionableCount 3, 0 candidates reporting the bare fallback parked

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 66: Enforce the Trellis context-manifest ready gate at task start

**Date**: 2026-08-15
**Task**: Enforce the Trellis context-manifest ready gate at task start
**Branch**: `feat/trellis-seeded-task-start-gate`

### Summary

Wired the pack's existing seeded-task check into task.py start so a task whose implement.jsonl and check.jsonl hold only the seed row is refused before any state is written, and recorded why .trellis/ is editable where the vendored pack is not.

### Main Changes

- Added scripts/trellis-task-start-gate.py and a generic pre-start hook in .trellis/scripts/task.py; an after_start hook cannot refuse a start because run_task_hooks only warns
- Fixed write_json to emit a trailing newline, removing a review finding that recurred on every PR touching a task.json
- Recorded the template-managed vs vendored distinction in .trellis/spec/backend/directory-structure.md and marked the workflow.md ready gate as enforced


### Git Commits

| Hash | Message |
|------|---------|
| `4fd0723` | feat: refuse a Trellis task start when its context manifests are seed-only |
| `d1e0561` | fix: address review findings on the pre-start ready gate |
| `026b9e1` | fix: handle a failed preflight spawn and use the repo's python command in tests |
| `41f1652` | chore(task): archive 08-15-task-manifest-ready-gate |

### Testing

- [OK] npm test: 640 pass, 0 fail (635 before)
- [OK] review preflight: 0 failures
- [OK] seed-only start refused, curated start allowed, scaffold exemption intact

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 67: Record the descriptor-collision finding and design the remote-review route

**Date**: 2026-08-15
**Task**: Record the descriptor-collision finding and design the remote-review route
**Branch**: `docs/remote-review-channel-authority-findings`

### Summary

Unblocked 08-15-remote-review-channel-authority's planning by settling the contract/ vs config/ descriptor question, then wrote design.md costing all three routes. An adversarial review of the pair caught two material defects in the first draft of the reasoning.

### Main Changes

- prd.md: added an Investigation section recording that contract/ and config/ hold the same schema in opposite roles (DESIGN.md:201-206), separated deliberately by 08-09-descriptor-contract-path (PR #68). Authoring config/routed-review-setup-v1.json back onto the probe path would restore the defect that task removed, so the honest form of the route is a full consumer install.
- prd.md: rewrote the three candidate resolutions and their rejection rationale; ticked the descriptor-collision acceptance criterion and added one requiring the rejected routes be recorded.
- design.md (new): boundaries and ownership table, routed-review data flow, the independent-review-floor decision, resource set, secret handling, verified blast radius, rollback shape, and the unproven premise that the Action has never executed anywhere.
- Adversarial review correction 1: installing does not silence the user-global hook. It is a PostToolUse matcher on Bash that re-arms on every push, so a push landing after PR creation and before sd-review dispatches still wins the race. Scoping the hook out is the closing step of the route, not an alternative to it.
- Adversarial review correction 2: installing does not unpark the sixteen v2-governance tasks. Their shared blockedOn requires distribution to fleet consumers plus a deliberate scope revalidation, and its falsification probe names external repositories.
- implement.md deliberately absent: the ordered steps differ entirely between the three routes, so it cannot be written before the operator chooses one. The task stays unstarted.


### Git Commits

| Hash | Message |
|------|---------|
| `39c9f3f` | docs(task): record the descriptor-collision finding and design the route |

### Testing

- [OK] node scripts/sd-ai-command-pack-review-preflight.mjs -- 0 failure(s), 0 warning(s)
- [OK] sd-review scope=pr on PR #84 -- status ready, deterministic check passed, prism clean, 0 findings
- [OK] cross-artifact value sweep across the task directory -- 0 disagreements over the pin, line citations, model ids, and resource paths
- [INFO] limitations router-not-configured and zero-remote-confidence; no Copilot review ran on this PR

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 68: Install the repository as a routed-review consumer (PR A)

**Date**: 2026-08-15
**Task**: Install the repository as a routed-review consumer (PR A)
**Branch**: `feat/install-routed-review-consumer`

### Summary

Installed this repository as a consumer of its own Action so the sanctioned routed-review lane is switched on here, then fixed two spend defects the lane exposed by actually running. Planning finalization: phases 5-7 (proving the durable lane) remain open for PR B.

### Main Changes

- Installed four managed resources via install-consumer.mjs, all verified byte-identical to their sources so uninstall stays available
- First execution of this Action anywhere: run 31908380030 routed cheap and billed one PR-Agent review while carrying an inert independent-review-floor input
- Root cause: independent-review-floor is durable-only (action.yml:55, src/operations.js:389); the event-driven lane runs operation=standalone, which reads mode instead
- Switched the event lane to mode via REVIEW_ROUTE_MODE, then removed the || 'auto' fallback and added a fail-closed gate, since the variable is not installer-managed
- Replaced two hardcoded inventory counts in metadata.test.js with runtime enumeration of .github/workflows and examples/
- Recorded that the install PR is unreviewable by its own lane: routerCapability is unavailable, not absent, and unavailable fails closed


### Git Commits

| Hash | Message |
|------|---------|
| `42ed46e` | feat: set the routed-review floor to copilot and plan the consumer install |
| `b3f40d7` | feat: install this repository as a routed-review consumer |
| `b6e2e88` | fix: set the review floor on the event-driven lane too |
| `40dcab1` | docs(spec): record the installed lanes and the do-not-edit-in-place rule |
| `c4d4314` | fix: stop the event-driven lane billing PR-Agent on every pull request |
| `f936946` | fix: fail closed when the event-driven lane has no explicit route |
| `cb2df2d` | chore(trellis): file the installer-managed route variable follow-up |
| `a358172` | fix: address local review findings on the route variable and task manifests |
| `8b0056b` | fix: enumerate the example inventory and flag the spec's expiry condition |
| `4a6c435` | docs(task): record that the install PR is unreviewable by its own lane |

### Testing

- [OK] npm test 640/640
- [OK] validate-action-metadata.mjs: action.yml, 3 workflows, 7 examples, 1211 tracked paths, pinned to v0.3.0
- [OK] validate-ci-parity.mjs: 5 CI package gates
- [OK] install-consumer.mjs check: healthy, manifest schema 3, state active
- [OK] review preflight: 0 failures, 2 dispositioned warnings
- [OK] route gate exercised locally across valid, unset, wrong-case, and unknown values
- [OK] production run 31908993543: Selected copilot, both PR-Agent steps skipped

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 69: Record the routed-review decision and split the unprovable criteria

**Date**: 2026-08-15
**Task**: Record the routed-review decision and split the unprovable criteria
**Branch**: `feat/install-routed-review-consumer`

### Summary

Finalization for PR A: recorded which contract owns remote review and why the two alternatives lost, corrected a spec example this branch falsified, and split the two acceptance criteria that cannot be tested from the branch that installs the lane into 08-15-prove-routed-lane.

### Main Changes

- consumer-installer.md now carries the route decision, both rejections with reasons, the per-lane policy difference, and the one-time bootstrap cost
- Fixed a spec example asserting this repository probes as setup-descriptor-absent, which stopped being true when config/routed-review-setup-v1.json was installed
- Created 08-15-prove-routed-lane (P1) carrying the hook-retirement and matching-review-state criteria verbatim


### Git Commits

| Hash | Message |
|------|---------|
| `3cb4742` | docs: record the route decision in spec and split the unprovable criteria out |
| `e456cdd` | docs(task): list the moved criteria outside the acceptance checklist |

### Testing

- [OK] pre-archive gate: status valid, pre_archive_valid
- [OK] npm test 640/640
- [OK] review preflight: 0 failures

### Status

[OK] **Completed**

### Next Steps

- None - task complete
