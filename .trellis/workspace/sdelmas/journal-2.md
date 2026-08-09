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
