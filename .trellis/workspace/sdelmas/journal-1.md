# Journal - sdelmas (Part 1)

> AI development session journal
> Started: 2026-07-21

---



## Session 1: Harden GitHub review router for pilot

**Date**: 2026-07-21
**Task**: Harden GitHub review router for pilot
**Branch**: `codex/harden-first-release`

### Summary

Completed, reviewed, and merged the first-release hardening stream; preserved pilot evidence and release gating.

### Main Changes

- Hardened routing, GitHub API orchestration, Copilot deduplication, CI metadata validation, and Node 24 compatibility.
- Documented the architecture, GitHub and PR-Agent installation, MIT licensing, private pilot evidence, and release gate.
- Added repository-specific backend quality contracts and archived the completed Trellis task.


### Git Commits

| Hash | Message |
|------|---------|
| `5480cb1` | (see git log) |
| `6e2de0b` | (see git log) |
| `9d10ac1` | (see git log) |
| `8308353` | (see git log) |
| `e12ad52` | (see git log) |
| `1f72733` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- Continue with the repo-local GitHub API retry-policy task; keep external adapter validation and pilot work parked until credentials and authority are available.


## Session 2: Complete Trellis project guidelines

**Date**: 2026-07-21
**Task**: Complete Trellis project guidelines
**Branch**: `codex/archive-bootstrap-guidelines`

### Summary

Replaced generic Trellis scaffolding with repository-derived backend contracts and explicit non-applicable frontend/database boundaries.

### Main Changes

- Documented runtime module, error, logging, testing, and stateless persistence contracts with real repository examples.
- Documented the absent frontend layer so future tasks do not invent unsupported UI architecture.
- Addressed and resolved all Copilot documentation findings across four review rounds.


### Git Commits

| Hash | Message |
|------|---------|
| `293c562` | (see git log) |
| `1220888` | (see git log) |
| `28d2167` | (see git log) |
| `a12920d` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Finish-work merge attestation and pack refresh

**Date**: 2026-07-22
**Task**: Finish-work merge attestation and pack refresh
**Branch**: `codex/enforce-housekeeping-finish-work`

### Summary

Enforced exact-head finish-work attestation before housekeeping merge, refreshed sd-ai-command-pack to 0.30.4, addressed Copilot feedback with explicit derived provenance, and completed the PR review loop.

### Main Changes

- Added the fail-closed finish-work head gate, adapter guidance, and repository contract coverage.
- Refreshed installed command-pack assets and provenance to upstream 0.30.4.
- Addressed all four Copilot findings, including positive merge coverage, actionable post-finish-work diagnostics, and test/tests path classification.


### Git Commits

| Hash | Message |
|------|---------|
| `291a9f2` | (see git log) |
| `f618ec1` | (see git log) |
| `5165ad2` | (see git log) |
| `2c2d614` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Close tracked workspace review loop

**Date**: 2026-07-22
**Task**: Close tracked workspace review loop
**Branch**: `codex/enforce-housekeeping-finish-work`

### Summary

Aligned tracked Trellis records with the final pack provenance and corrected the housekeeping stale-head regression fixture through three Copilot review rounds.

### Main Changes

- Aligned archived task provenance and the tracked workspace index with the final repository state.
- Replaced the stale finish-work-head test fixture with a production-shaped Git OID and refreshed its vouched provenance hash.


### Git Commits

| Hash | Message |
|------|---------|
| `5171df4` | docs: align Trellis records with final provenance |
| `87be303` | test: use realistic stale finish-work head |

### Testing

- [OK] Deterministic full review check passed with Prism and Gito disabled.
- [OK] npm test passed 32 tests and npm run check passed.
- [OK] Housekeeping self-test passed 13 tests; installation audit verified 151 targets.
- [OK] GitHub CI passed and all Copilot review threads were resolved.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Publish routed-review receipt contract plan

**Date**: 2026-07-22
**Task**: Publish routed-review receipt contract plan
**Branch**: `codex/publish-routed-review-receipt-contract`

### Summary

Published and reviewed the versioned routed-review receipt planning package, grounding Trellis context and tightening identity, terminology, and normalized outcome contracts through four Copilot rounds.

### Main Changes

- Published the P1 PRD, design, implementation plan, task metadata, and grounded Trellis context for the exact-head routed-review receipt protocol.
- Made idempotency identities router-derived, normalized cost/quality and skipped-outcome terminology, and resolved all review feedback.


### Git Commits

| Hash | Message |
|------|---------|
| `4b922f4` | docs: plan routed review receipt contract |
| `01b0d7b` | fix: ground Trellis review context |
| `157b031` | fix: derive routed review idempotency identity |
| `0e1982c` | docs: normalize routed review policy terminology |
| `a4b743e` | docs: normalize skipped review outcomes |

### Testing

- [OK] Deterministic PR full-check passed with Prism and Gito disabled.
- [OK] Review preflight passed with zero failures and zero advisories; installation audit verified 151 targets.
- [OK] GitHub CI passed on the reviewed head.
- [OK] Four Copilot rounds completed; all five review threads are resolved.

### Status

[OK] **Completed**

### Next Steps

- After PR #6 merges, start the still-planned routed-review receipt implementation task.


## Session 6: Finalize routed-review receipt contract PR

**Date**: 2026-07-22
**Task**: Finalize routed-review receipt contract PR
**Branch**: `codex/publish-routed-review-receipt-contract`

### Summary

Reused PR #6, refreshed repository knowledge, validated the synchronized bookkeeping head, completed an exact-head Copilot pass with no findings, and archived the reviewed planning task.

### Main Changes

- Refreshed the generated Obsidian knowledge base without tracked spec or architecture changes.
- Validated the current PR head with the deterministic review gate, passing CI, and zero unresolved review threads.
- Archived the completed routed-review receipt contract planning task after the clean review loop.


### Git Commits

| Hash | Message |
|------|---------|
| `b0717e1` | chore: sync workspace session count |

### Testing

- [OK] Deterministic PR full-check passed with Prism and Gito disabled
- [OK] GitHub CI passed on exact head b0717e1
- [OK] Copilot reviewed 9 of 9 files with no new comments
- [OK] Delayed GraphQL poll found zero unresolved review threads

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Validate Trellis task metadata consistency

**Date**: 2026-07-23
**Task**: Validate Trellis task metadata consistency
**Branch**: `codex/validate-trellis-task-metadata`

### Summary

Adopted the verified SD command-pack task metadata contract, moved two consumer-discovered regressions upstream, and refreshed the consumer through v0.32.2 with clean review evidence.

### Main Changes

- Installed the upstream priority-provenance and task-context validation contract across Claude, Gemini, GitHub, and OpenCode surfaces.
- Restored portable test-directory review signals through upstream PR #230 and fail-closed malformed-context parsing through upstream PR #231.
- Verified immutable release v0.32.2 at 8293d0e and refreshed consumer provenance to its exact payload.


### Git Commits

| Hash | Message |
|------|---------|
| `0e2f57a` | chore: refresh sd command pack to 0.32.0 |
| `59afe99` | docs: record published pack release |
| `9a690ea` | fix: retain test directory review signals |
| `8face3a` | fix: adopt fail-closed task context parsing |

### Testing

- [OK] Source-authoritative install audit passed for all 151 targets with zero changes required.
- [OK] npm test passed 32 tests; npm run check and npm run validate:metadata passed.
- [OK] Consumer full-check and exact-head review-full-check passed.
- [OK] CI passed on 8face3a; Copilot review completed and direct delayed polling found zero unresolved threads.

### Status

[OK] **Completed**

### Next Steps

- Merge PR #8 through exact-head housekeeping and verify clean synchronized main.


## Session 8: Consolidate roadmap into Trellis backlog

**Date**: 2026-07-22
**Task**: Consolidate roadmap into Trellis backlog
**Branch**: `codex/consolidate-project-roadmap`

### Summary

Converted all open roadmap phases and issues into six Trellis tasks, removed duplicate planning documents, and completed PR review remediation.

### Main Changes

- Created six prioritized Trellis backlog tasks and preserved the migration mapping in an archived parent task.
- Removed the obsolete standalone project plan and consolidated README, design, and Trellis planning ownership guidance.
- Clarified deliberate priority promotions and historical archived-path semantics after Copilot review.


### Git Commits

| Hash | Message |
|------|---------|
| `cef1651` | chore: consolidate roadmap into Trellis backlog |
| `eb89c28` | docs: clarify roadmap migration priorities |

### Testing

- [OK] npm test: 32 tests passed
- [OK] npm run check and npm run validate:metadata passed
- [OK] All seven Trellis task validations passed
- [OK] SD review full-check passed with Prism and Gito disabled
- [OK] GitHub CI passed and Copilot round 2 produced no new comments

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: Reconcile roadmap PR with current main

**Date**: 2026-07-23
**Task**: Reconcile roadmap PR with current main
**Branch**: `codex/consolidate-project-roadmap`

### Summary

Integrated the merged task-metadata stream into the roadmap branch, preserved append-only session history, and added reciprocal topology links required by the current preflight.

### Main Changes

- Merged current main into the published roadmap branch without rewriting its reviewed history.
- Preserved main session 7 byte-for-byte and appended the roadmap record as session 8.
- Linked all six planning tasks reciprocally to the archived roadmap-migration parent.


### Git Commits

| Hash | Message |
|------|---------|
| `f5623e4` | Merge branch 'main' into codex/consolidate-project-roadmap |
| `0871b80` | fix: reconcile roadmap task history |

### Testing

- [OK] npm test passed 32 tests; npm run check and npm run validate:metadata passed.
- [OK] The current SD full check passed with all task metadata, topology, context, journal, provenance, and documentation gates.

### Status

[OK] **Completed**

### Next Steps

- Push the exact finish-work head, complete final CI/review polling, and merge PR #7 through housekeeping.


## Session 10: Enforce public repository metadata policy

**Date**: 2026-07-23
**Task**: Enforce public repository metadata policy
**Branch**: `codex/define-public-trellis-metadata-policy`

### Summary

Defined and enforced the public Trellis and AI-tool metadata boundary without rewriting history.

### Main Changes

- Published the public metadata allow/deny policy and retained bounded workspace journals as deliberate public project history.
- Added Git-backed tracked-path validation, ignore rules, force-add regression coverage, and the backend quality contract.


### Git Commits

| Hash | Message |
|------|---------|
| `9a49c8aedc4564892a303ffaa8794f3ceb9313c1` | feat: enforce public metadata policy |

### Testing

- [OK] npm test passed 34 tests; npm run check and npm run validate:metadata passed.
- [OK] Command-pack installation audit and deterministic review full-check passed.
- [OK] GitHub CI passed; Copilot reviewed the exact head with no comments and GraphQL found zero unresolved threads.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: Decompose routed-review runtime delivery

**Date**: 2026-07-23
**Task**: Decompose routed-review runtime delivery
**Branch**: `codex/decompose-routed-review-runtime`

### Summary

Split the oversized routed-review runtime contract into four ordered, independently reviewable Trellis implementation tasks and completed the parent planning lifecycle.

### Main Changes

- Mapped all routed-review runtime requirements into protocol core, durable receipt, on-demand dispatch, and pilot/handoff child tasks.
- Preserved reciprocal task dependencies and isolated private-pilot and upstream handoff authority boundaries.


### Git Commits

| Hash | Message |
|------|---------|
| `88c2ee3555ab8d48d3d8538feb9ff8a25a0d0a2a` | docs: split routed review runtime delivery |

### Testing

- [OK] npm test (34 tests passed)
- [OK] npm run check
- [OK] action metadata, review preflight, and all five Trellis task contexts validated
- [OK] Copilot reviewed PR #10 with no comments; CI passed and review threads were empty

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: Implement routed-review protocol core

**Date**: 2026-07-23
**Task**: Implement routed-review protocol core
**Branch**: `codex/implement-routed-review-protocol-core`

### Summary

Added the dependency-free routed-review protocol boundary, deterministic identities, strict privacy validation, canonical fixtures, and pure policy routing; completed five Copilot review rounds with every actionable thread resolved.

### Main Changes

- Added v1 request, receipt, backend, acknowledgment, local-review, and successor-evidence decoders with deterministic canonical hashing.
- Added pure route selection with explicit-route precedence, local-evidence reductions, successor handling, and independent-review floors.
- Hardened external boundaries for non-plain objects, nesting, encoded size, embedded URL credentials, repeated references, field-specific confidence errors, and ignored successor evidence.
- Added canonical fixture matrices and focused regression coverage, and updated executable Trellis backend specifications.


### Git Commits

| Hash | Message |
|------|---------|
| `4d29fe3ec9e3005e2fe76e32f31f945bac7f2c8c` | feat: add routed review protocol core |
| `a28ce2a812dd831cefb30dc0737157d11940ef6a` | fix: harden canonical protocol input |
| `6e907f46d24e9c4e593983212ace489c7228542b` | fix: bound protocol input nesting |
| `ecd283897aa1ad57586c94e08e358b8b33dee9f9` | fix: enforce protocol envelope consistency |
| `be126cb84fd1de5c47fef0d48a4bff0ed15df3f9` | fix: tighten protocol boundary validation |
| `f7657e7d13febec04afd1a0b464f4f774e02c7f7` | fix: validate ignored successor evidence |

### Testing

- [OK] npm test: 68 tests passed
- [OK] npm run check: JavaScript syntax checks passed
- [OK] sd-ai-command-pack-review-full-check.sh: passed with two documented preflight warnings and no failures
- [OK] GitHub Actions CI: success on f7657e7d13febec04afd1a0b464f4f774e02c7f7
- [OK] Copilot review: five rounds, nine actionable comments fixed, replied to, and resolved; zero unresolved threads

### Status

[OK] **Completed**

### Next Steps

- Proceed to the dependent durable routed-review receipt task.


## Session 13: Implement durable routed-review receipts

**Date**: 2026-07-23
**Task**: Implement durable routed-review receipts
**Branch**: `codex/implement-durable-routed-review-receipts`

### Summary

Added exact-head GitHub Check Run receipt persistence, strict fail-closed reconciliation, bounded successor comparison evidence, and transport support for the routed-review protocol.

### Main Changes

- Added canonical exact-head receipt Check Run encoding, lookup, creation, updates, idempotency, phase transitions, and policy-authorized rerequests.
- Added bounded GitHub compare normalization that stores digests and counts without raw paths, with ambiguous and oversized fail-closed classifications.
- Hardened post-mutation reconciliation and compare pagination validation from Copilot review findings.


### Git Commits

| Hash | Message |
|------|---------|
| `9b9fd9bcd6294dc6f8223e100010140f22fa9170` | feat: add durable routed review receipts |
| `4f16606c36b7138962d7bbf747c5d1f1dde63bcf` | fix: fail closed on ambiguous receipt mutations |

### Testing

- [OK] npm test: 85 tests passed
- [OK] npm run check
- [OK] npm run validate:metadata
- [OK] git diff --check
- [OK] sd-ai-command-pack review full-check: 0 failures
- [OK] GitHub CI passed on exact head 4f16606c36b7138962d7bbf747c5d1f1dde63bcf
- [OK] Copilot review: 2 rounds, 2 findings fixed, 0 unresolved threads

### Status

[OK] **Completed**

### Next Steps

- Merge PR #12 and continue with the on-demand routed-review dispatch task.


## Session 14: Implement on-demand routed-review dispatch

**Date**: 2026-07-23
**Task**: Implement on-demand routed-review dispatch
**Branch**: `codex/implement-on-demand-routed-review-dispatch`

### Summary

Added explicit durable route, finalize, and query operations with exact-head dispatch, durable setup discovery, and a no-checkout consumer workflow.

### Main Changes

- Added durable operation orchestration and fail-closed receipt mirroring for native Copilot and external adapters.
- Published the setup descriptor, discovery fixtures, and no-checkout on-demand workflow.
- Aligned Action metadata, README, design, release guidance, and executable backend specifications.


### Git Commits

| Hash | Message |
|------|---------|
| `013f78256f0a3c5f01be15cef768f5da06fd8f23` | feat: add on-demand routed review dispatch |
| `10a5729bcc4989923891dcff65501129823b9b18` | fix: validate durable workflow URLs |

### Testing

- [OK] npm test: 99 tests passed
- [OK] npm run check and metadata validation passed
- [OK] Full review gate, exact-head CI, Copilot round 2, and delayed thread poll passed

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: Add bounded GitHub API retry policy

**Date**: 2026-07-23
**Task**: Add bounded GitHub API retry policy
**Branch**: `codex/add-github-api-retry-policy`

### Summary

Added safe, bounded GitHub REST read retries with rate-limit-aware delays while preserving one-attempt mutation reconciliation.

### Main Changes

- Added a three-attempt GET-only retry policy for transient transport and GitHub response failures.
- Honored bounded retry-after, primary reset, and secondary fallback delays with allow-listed diagnostics.
- Kept reviewer and Check Run mutations single-attempt and documented the fail-closed boundary.


### Git Commits

| Hash | Message |
|------|---------|
| `522f87361a6a96adc75e0867a78290fe4156eaf8` | feat: add bounded GitHub API retries |
| `8b7c2c4608eb27899dfac63de85abe6af1b39b33` | chore: link retry-policy task PR |
| `a902681aa3a6f9513816e5e2bf0f1e0a0563f10c` | fix: fail closed on malformed retry delays |

### Testing

- [OK] npm test: 109 tests passed
- [OK] Focused GitHub transport suite: 20 tests; 93.39% line and 84.17% branch coverage
- [OK] Syntax, metadata, task validation, full review gate, CI, and two Copilot rounds passed

### Status

[OK] **Completed**

### Next Steps

- Remaining tasks require maintainer approval, private-pilot or external-adapter credentials, or three-consumer adoption evidence; resume only when the relevant gate is satisfied.


## Session 16: Add PR-Agent adapter support

**Date**: 2026-07-23
**Task**: Add PR-Agent adapter support
**Branch**: `codex/add-pr-agent-support`

### Summary

Published and reviewed executable standalone and durable PR-Agent adapters with generic single-key provider configuration and bounded acknowledgments.

### Main Changes

- Added strict adapter-request decoding and a side-effect-free acknowledgment operation with durable summaries.
- Added digest-pinned standalone and durable PR-Agent workflows, setup guides, and thirteen single-key provider mappings.
- Fixed review findings by enforcing immutable Action refs in examples while allowing explicit substitution placeholders.


### Git Commits

| Hash | Message |
|------|---------|
| `b2bf702` | feat: add PR-Agent adapter support |
| `000210b` | fix: address PR review feedback |

### Testing

- [OK] npm test (115 tests)
- [OK] npm run check and npm run validate:metadata
- [OK] deterministic review full-check with Prism and Gito disabled
- [OK] GitHub CI green and Copilot round two produced no new comments

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: Publish v0.1.0 and complete consumer smoke

**Date**: 2026-07-24
**Task**: Publish v0.1.0 and complete consumer smoke
**Branch**: `codex/complete-v010-release-consumer-smoke`

### Summary

Published the approved immutable v0.1.0 release after the private pilot gate, verified the released SHA in a provider-free consumer smoke, documented rollback, and converged PR review.

### Main Changes

- Froze and validated the release candidate, completed the replacement private pilot and 24-hour observation window, and recorded explicit publication approval.
- Published annotated tag and GitHub release v0.1.0 at the approved immutable commit.
- Ran the released-SHA consumer smoke, verified deep routing output, exercised workflow disable and restore, and preserved the public evidence boundary.
- Pinned all runnable first-party installation examples and setup metadata to the v0.1.0 commit while retaining only explicit template-owned adapter placeholders.
- Addressed and resolved Copilot documentation-drift feedback, then archived the completed Trellis task.


### Git Commits

| Hash | Message |
|------|---------|
| `d6cbb69` | docs: plan v0.1.0 pilot and release gates |
| `87f519a` | docs: record v0.1.0 candidate evidence |
| `178e71a` | docs: record v0.1.0 pilot evidence |
| `938ab6d` | docs: restart v0.1.0 pilot candidate |
| `b4dc415` | docs: record replacement candidate pilot |
| `b977696` | docs: anchor candidate facts to selection time |
| `73a71b6` | docs: record completed v0.1.0 observation gate |
| `b803bc3` | docs: pin installation guidance to v0.1.0 |
| `f95c39e` | chore(task): record v0.1.0 release evidence |
| `b652b2b` | fix: address review feedback round 1 |
| `0216228` | fix: address review feedback round 2 |

### Testing

- [OK] Source CI run 30036609751 passed at the released commit.
- [OK] Provider-free pilot run 30132372458 selected deep with pilot-deep and external-adapter flag true.
- [OK] npm test passed 115 tests; npm run check and npm run validate:metadata passed.
- [OK] Deterministic SD full-check passed with zero preflight failures or warnings.
- [OK] PR #16 CI passed and Copilot round 3 reported no new comments; zero unresolved review threads.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: Close setup automation evaluation

**Date**: 2026-07-24
**Task**: Close setup automation evaluation
**Branch**: `codex/close-setup-automation-no-build`

### Summary

Documented the bounded adoption evidence, recorded the no-build decision, completed remote review, and prepared the task for merge.

### Main Changes

- Recorded bounded organization-level adoption evidence and its limitations.
- Closed the setup-automation evaluation with an explicit three-consumer reconsideration threshold.
- Clarified the acceptance criteria after Copilot review while preserving the canonical Trellis task lifecycle.


### Git Commits

| Hash | Message |
|------|---------|
| `bdb05e8` | docs: record setup automation no-build decision |
| `adcf1c0` | fix: remove trailing task whitespace |
| `5fb6116` | docs: clarify setup automation outcome criteria |

### Testing

- [OK] npm test (115 passed)
- [OK] npm run check
- [OK] npm run validate:metadata
- [OK] SD review full-check passed with Prism and Gito disabled
- [OK] GitHub CI test passed and all review threads resolved

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: Select Kimi K2.6 for PR-Agent pilot

**Date**: 2026-07-24
**Task**: Select Kimi K2.6 for PR-Agent pilot
**Branch**: `codex/use-kimi-26-for-pr-agent-pilot`

### Summary

Updated the pending PR-Agent pilot plan and setup guidance to use Kimi K2.6 through the existing OpenRouter integration while retaining generic Gemini support.

### Main Changes

- Documented the exact OpenRouter provider, model IDs, and consumer-owned secret for the bounded Kimi K2.6 pilot.
- Recorded Kimi K2.6 as the pending adapter pilot choice without adding a new provider contract or implicit Gemini fallback.


### Git Commits

| Hash | Message |
|------|---------|
| `0e738ae` | docs: use Kimi K2.6 for PR-Agent pilot |

### Testing

- [OK] Trellis task context validation
- [OK] npm run check
- [OK] npm run validate:metadata
- [OK] SD review full-check passed with Prism and Gito disabled
- [OK] GitHub CI passed and Copilot reported no comments

### Status

[OK] **Completed**

### Next Steps

- Run the bounded credentialed Kimi K2.6 pilot after the capped OpenRouter key
  and provider-use authority are available.


## Session 20: Consumer installer lifecycle

**Date**: 2026-07-24
**Task**: Consumer installer lifecycle
**Branch**: `codex/add-consumer-installer`

### Summary

Added and reviewed a safe lifecycle CLI for installing, updating, checking, and uninstalling PR-Agent review routing in consumer repositories.

### Main Changes

- Implemented manifest-owned consumer workflow and GitHub metadata lifecycle operations.
- Documented setup, architecture, provider configuration, and Trellis executable contracts.
- Addressed Copilot's missing-origin diagnostic finding with a regression test and resolved the review thread.


### Git Commits

| Hash | Message |
|------|---------|
| `8a41dc8191f3139806efcfbc027b84f734ef4369` | feat: add consumer installer lifecycle |
| `a6352654bbbebb656d51c063d87449ca86ca916a` | fix: improve missing-origin diagnostic |

### Testing

- [OK] npm test (130 tests)
- [OK] npm run check
- [OK] npm run validate:metadata (531 tracked paths)
- [OK] SD full check with Prism and Gito disabled
- [OK] Copilot round 2 reported no new comments; GitHub CI passed

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 21: Validate PR-Agent adapter pilot

**Date**: 2026-07-24
**Task**: Validate PR-Agent adapter pilot
**Branch**: `codex/validate-external-reviewer-adapters`

### Summary

Repaired the PR-Agent CLI container workdir contract, completed the private OpenRouter/Kimi cheap and deep pilot, and converged source PR review.

### Main Changes

- Ran the digest-pinned PR-Agent CLI image directly without mounting the Actions workspace.
- Recorded sanitized successful cheap/deep pilot evidence and verified rollback ownership on private merged main.
- Addressed and resolved Copilot feedback on spec clarity and complete Docker mount-flag regression coverage.


### Git Commits

| Hash | Message |
|------|---------|
| `4f78755` | fix: preserve PR-Agent CLI image workdir |
| `0af452f` | docs: record PR-Agent pilot evidence |
| `e15656d` | docs: clarify PR-Agent forbidden patterns |
| `88585ea` | test: reject all Docker workspace mount forms |

### Testing

- [OK] npm test: 130 tests passed
- [OK] metadata test: 8 focused tests passed after review fixes
- [OK] npm run check and npm run validate:metadata passed
- [OK] SD review full-check passed with 151 command-pack targets and a fresh 256-copy KB
- [OK] Private cheap run 30141534479 and deep run 30141602172 passed; merged-main installer check reported no issues

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 22: Pilot durable routed-review runtime

**Date**: 2026-07-24
**Task**: Pilot durable routed-review runtime
**Branch**: `codex/pilot-routed-review-runtime-handoff`

### Summary

Closed the published workflow-control gap, proved the durable PR-Agent and Copilot lifecycle in the approved private pilot, and prepared an immutable command-pack handoff.

### Main Changes

- Exposed rerequest authorization and independent-review-floor inputs in both durable workflow examples with symmetry tests and updated contracts.
- Recorded sanitized exact-head replay, conflict, authorized rerequest, successor, Copilot, security, and rollback evidence from the private pilot.
- Prepared a paste-ready v1 command-pack handoff without creating an unauthorized upstream PR.


### Git Commits

| Hash | Message |
|------|---------|
| `743c0f90358466f2a05b564f27c731a1a4d6c9b2` | feat: expose durable review policy controls |

### Testing

- [OK] npm test (130 passing)
- [OK] npm run check and npm run validate:metadata
- [OK] installer audit, metadata preflight, exact-head CI, and Copilot review with no comments

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 23: Use Qwen for cheap PR-Agent reviews

**Date**: 2026-07-24
**Task**: Use Qwen for cheap PR-Agent reviews
**Branch**: `main`

### Summary

Made Qwen3-Coder 30B A3B the default cheap PR-Agent model, retained Kimi K2.6 for deep reviews, and updated the private pilot configuration.

### Main Changes

- Changed fresh consumer installs to use Qwen3-Coder 30B A3B for the cheap review tier while preserving Kimi K2.6 for deep reviews.
- Updated installer regression coverage, setup documentation, and the consumer-installer contract.
- Applied and verified the same cheap-model mapping in the private pilot without modifying its provider secret.


### Git Commits

| Hash | Message |
|------|---------|
| `24915bd` | feat: use Qwen for cheap PR-Agent reviews |

### Testing

- [OK] npm test (130 passing)
- [OK] npm run check
- [OK] npm run validate:metadata
- [OK] python3 scripts/sd-ai-command-pack-install-audit.py (151 targets)
- [OK] git diff --check

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 24: Converge Qwen cheap-review default PR

**Date**: 2026-07-25
**Task**: Converge Qwen cheap-review default PR
**Branch**: `codex/qwen-cheap-review-default`

### Summary

Resolved final Copilot findings, grounded archived task context references, and added regression coverage proving flagless consumer updates preserve an existing non-default provider and model configuration.

### Main Changes

- Removed and grounded obsolete archived task placeholder context records.
- Added an end-to-end installer regression for preserving non-default provider and model settings during flagless updates.


### Git Commits

| Hash | Message |
|------|---------|
| `0c3e761` | chore: remove archived task placeholders |
| `991be66` | chore: ground archived task contexts |
| `3400ad6` | test: preserve consumer models on flagless update |

### Testing

- [OK] npm run check
- [OK] npm test (131/131)
- [OK] Copilot exact-head review (11/11 files, no new comments)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 25: Converge routed-review planning wave

**Date**: 2026-07-25
**Task**: Converge routed-review planning wave
**Branch**: `codex/routed-review-planning-wave`

### Summary

Repaired planning metadata, grounded task context references, clarified retention policy, and converged the stacked planning PR after Copilot review.

### Main Changes

- Repaired routed-review planning task metadata and parent-child topology.
- Grounded cheap-review failover and cost-control task contexts in concrete design evidence.
- Clarified the review-data retention detail windows.


### Git Commits

| Hash | Message |
|------|---------|
| `41ded21` | fix: repair routed-review planning metadata |
| `6d53117` | docs: ground cheap failover task contexts |
| `69e7d18` | docs: curate cheap cost task contexts |
| `6605475` | docs: distinguish retention detail windows |

### Testing

- [OK] npm run check
- [OK] npm test (131/131)
- [OK] Review preflight (0 failures)
- [OK] Copilot exact-head review (263/263 files, no new comments)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 26: Repository audit remediation planning and task repair

**Date**: 2026-07-25
**Task**: Repository audit remediation planning and task repair
**Branch**: `codex/use-qwen-for-cheap-pr-agent-reviews`

### Summary

Recorded the repository audit, created explicit Trellis ownership for all findings, repaired pre-existing task and configuration metadata, and published the clean planning wave.

### Main Changes

- Added the audit ledger, report, remediation parent, and dedicated finding tasks while extending existing owners.
- Repaired task hierarchy bases, parent-child maps, future-path documentation, and grounded context manifests across the planning backlog.


### Git Commits

| Hash | Message |
|------|---------|
| `cc1e755` | Add audit remediation backlog and repair task metadata |

### Testing

- [OK] Review preflight (0 failures)
- [OK] npm test (130/130 at original planning capture)
- [OK] Syntax, metadata, 151-target install audit, and diff checks

### Status

[OK] **Planning captured and published; implementation remains open**

### Next Steps

- Implement the audit-remediation children in severity order. Keep
  `07-25-support-standalone-review-mode` open until its implementation and
  acceptance criteria are complete.


## Session 27: Converge audit remediation planning PR

**Date**: 2026-07-25
**Task**: Converge audit remediation planning PR
**Branch**: `codex/use-qwen-for-cheap-pr-agent-reviews`

### Summary

Resolved final Copilot findings across audit wording, task targeting, operation terminology, and ledger-delta documentation, then normalized the stacked PR onto merged main.

### Main Changes

- Corrected audit wording and normalized remediation task base targets.
- Standardized operation-specific terminology across task contracts.
- Clarified which audit ledger changes belong to this PR.


### Git Commits

| Hash | Message |
|------|---------|
| `89e05b` | fix: correct audit wording and task targets |
| `3a256c` | docs: hyphenate operation-specific contract |
| `f69e617` | docs: clarify audit ledger delta |

### Testing

- [OK] npm run check
- [OK] npm test (131/131)
- [OK] Review preflight (0 failures)
- [OK] Copilot exact-head review (135/135 files, no new comments)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 28: Route high-risk PR-Agent reviews

**Date**: 2026-07-26
**Task**: Route high-risk PR-Agent reviews
**Branch**: `codex/route-high-risk-to-external-reviewer`

### Summary

Added configurable deep or Copilot high-risk routing across standalone and durable modes, set managed PR-Agent profiles to deep, preserved explicit Copilot routing, and validated runtime, metadata, installer update, and documentation behavior.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `4ca429b` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 29: Refresh sd-ai-command-pack to 0.54.0

**Date**: 2026-07-26
**Task**: Refresh sd-ai-command-pack to 0.54.0
**Branch**: `codex/refresh-sd-ai-command-pack-0-54-0`

### Summary

Installed the immutable v0.54.0 command-pack release, verified provenance and managed targets, and completed the guarded PR review lifecycle.

### Main Changes

- Created and completed a dedicated Trellis rollout task.
- Refreshed all configured Claude, Gemini, GitHub, and OpenCode command-pack surfaces to v0.54.0.
- Verified exact release provenance and retained repository-owned integration context.


### Git Commits

| Hash | Message |
|------|---------|
| `a3759488ef445254f7c8d07a544b192cc186c3a8` | chore(task): start command pack refresh |
| `55f4db89168c6c6249a82be8743397c3211582cb` | chore: refresh sd-ai-command-pack to 0.54.0 |

### Testing

- [OK] install audit passed for 174/174 managed targets
- [OK] npm ci and npm test passed (136 tests)
- [OK] npm run check and npm run validate:metadata passed
- [OK] typed sd-check passed 7/7 and GitHub CI passed

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 30: Refresh sd-ai-command-pack to 0.55.2

**Date**: 2026-07-27
**Task**: Refresh sd-ai-command-pack to 0.55.2
**Branch**: `codex/refresh-sd-ai-command-pack-0-55-2`

### Summary

Installed and verified the immutable sd-ai-command-pack 0.55.2 release, published PR #28, and cleared exact-head review and CI.

### Main Changes

- Refreshed all managed pack payloads and provenance to 0.55.2.
- Adopted the newly shareable Claude and Trellis runtime payload exposed by the managed ignore policy.
- Validated and resolved the exact-head Copilot review finding while deferring the non-blocking classifier parity hardening to the source pack.


### Git Commits

| Hash | Message |
|------|---------|
| `75b10fe153e7c0de143c6c7b14584702438d12e6` | chore: refresh sd-ai-command-pack to 0.55.2 |

### Testing

- [OK] Immutable release audit passed for all 174 managed targets.
- [OK] Repository full gate passed: 136 tests, npm run check, and npm run validate:metadata.
- [OK] Exact-head Copilot review, GitHub Actions checks, mergeability, and review-thread gates passed.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 31: Refresh sd-ai-command-pack to 0.64.3

**Date**: 2026-08-03
**Task**: Refresh sd-ai-command-pack to 0.64.3
**Branch**: `refresh-sd-ai-command-pack-0.64.3`

### Summary

Installer-managed refresh of vendored sd-ai-command-pack 0.64.0 to 0.64.3 (TOCTOU helper-loader hardening); install audit passed, 4 platforms.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `e3ba20d18770de076630053a93cc456c11fe73c8` | chore: refresh sd-ai-command-pack to 0.64.3 |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 32: A-007 in-authority code/docs: schema-2 traceable installer provenance

**Date**: 2026-08-04
**Task**: A-007 in-authority code/docs: schema-2 traceable installer provenance
**Branch**: `publish-traceable-installer-release`

### Summary

Implemented the in-authority code/docs portion of A-007 (publish-traceable-installer-release): consumer manifest schemaVersion 1->2 with git-resolved source provenance (commit/tag/released), provenance-aware check drift detection, update migration, and a two-tier release-validation gate. Release cut and version choice remain deferred to the operator; task stays in_progress (ACs 1/2/4 depend on the release cut).

### Main Changes

- consumer-installer.mjs: MANIFEST_SCHEMA_VERSION=2; resolveSourceRelease git-resolves commit/tag/released; decodeManifest accepts schema 1 or 2 with provenance invariants; createManifest writes source.{commit,tag,released}; checkInstallation flags migration/newer-commit/release drift; --source-tag/--source-commit override
- validate-action-metadata.mjs: validateReleaseConsistency two-tier release gate; parseReleaseTag; first-party pin consistency; package version + contract-major checks; runCli release/metadata dispatch
- Docs: spec/backend/consumer-installer.md provenance contract; SETUP-PR-AGENT.md source-provenance + migration/rollback advisory; README provenance note; CHANGELOG Unreleased
- Tests: consumer-installer + metadata suites extended for provenance, drift, schema-1 decode/migration, override guards, release gate


### Git Commits

| Hash | Message |
|------|---------|
| `d72918f` | feat(installer): record source provenance in a schema-2 consumer manifest |
| `b49a30c` | fix(review): address Copilot review on provenance and release-gate |

### Testing

- [OK] Copilot review: 4 findings, all verified real and fixed in b49a30c; 2nd pass no new comments; 0 unresolved threads
- [OK] CI test job green on head b49a30c

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 33: Publish v0.2.0 traceable installer release (A-007)

**Date**: 2026-08-04
**Task**: Publish v0.2.0 traceable installer release (A-007)
**Branch**: `main`

### Summary

Cut the deferred A-007 release: operator chose v0.2.0, stamped package.json/lock/CHANGELOG, converged Copilot review on PR #34, merged, tagged v0.2.0, created the GitHub release bundling installers, verified released-bytes provenance, and archived the task.

### Main Changes

- Bumped package.json + package-lock.json to 0.2.0 and stamped CHANGELOG top heading '## 0.2.0 - 2026-08-04' to satisfy the release-changelog gate
- Merged PR #34 (squash b8d4872) after two verified Copilot fixes: lockfile version sync, and CHANGELOG heading format conformance to full-check.sh:782
- Tagged v0.2.0 on the release commit and created the GitHub release with consumer-installer.mjs + install-consumer.mjs assets
- Archived task publish-traceable-installer-release with all 4 acceptance criteria satisfied (27 satisfied-by-proxy; live consumer smoke test noted as follow-up)


### Git Commits

| Hash | Message |
|------|---------|
| `b8d4872` | chore(release): stamp v0.2.0 for traceable installer release (A-007) (#34) |
| `3c7d53f` | chore(task): archive 07-25-publish-traceable-installer-release |

### Testing

- [OK] validate:release v0.2.0 on release commit: Validated action.yml, 1 workflow, 5 examples, 1062 tracked public paths
- [OK] npm test: 162/162 pass
- [OK] release-bytes provenance: resolveSourceRelease from v0.2.0 tag checkout = released:true, tag v0.2.0, commit b8d4872 == HEAD
- [OK] criterion 24: git ls-tree v0.2.0 contains both installers + action.yml + all 5 example routers

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 34: Reject symlinked installer targets (A-005)

**Date**: 2026-08-04
**Task**: Reject symlinked installer targets (A-005)
**Branch**: `fix/reject-symlinked-installer-targets`

### Summary

Implemented the A-005 containment guard: an lstat-based ancestor walk beneath the canonical consumer worktree threaded through all six installer lifecycle paths, with TOCTOU rechecks before both the temp write and the rename. Converged two verified Copilot findings and merged via the work-loop ship flow.

### Main Changes

- Add makePathGuard/assertContainedPath: lstat ancestor walk rejecting symlink/non-dir/non-regular-leaf/escape before any mutation; threaded through loadLocalState, atomicWrite, removeOptional across install/update/check/adoption/rollback/uninstall
- TOCTOU rechecks immediately before both the temp write (Copilot finding) and the atomic rename/removal
- Precise parent-escape boundary (relative==='..' || '../'-prefixed) instead of startsWith('..') (Copilot finding)
- 8 total containment regression tests incl. two teeth-proven TOCTOU swaps; documented the containment contract in the consumer-installer spec


### Git Commits

| Hash | Message |
|------|---------|
| `e559742` | fix: reject symlinked installer targets (A-005) |
| `d8fc6e9` | fix: precise parent-escape check in installer containment guard |
| `157aae1` | fix: recheck installer containment before the temp write (A-005 TOCTOU) |
| `85e23f7` | chore(task): archive 07-25-reject-symlinked-installer-targets |

### Testing

- [OK] npm test: 169/169 pass (+7 vs baseline 162)
- [OK] npm run check / validate:metadata / git diff --check: all clean
- [OK] TOCTOU pre-write test proven: fails without the recheck (0/1), passes with it (1/1)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 35: A-006: subprocess coverage for shipped Action + installer entrypoints

**Date**: 2026-08-04
**Task**: A-006: subprocess coverage for shipped Action + installer entrypoints
**Branch**: `test/shipped-review-process-boundaries`

### Summary

Added hermetic subprocess tests exercising the real src/index.js and scripts/install-consumer.mjs composition roots, plus a coverage-floor CI gate. Fixed a latent readFile(fd) stdin bug the new test surfaced.

### Main Changes

- test/action-entrypoint.test.js + test/installer-entrypoint.test.js run the real entrypoints as subprocesses (temp event/output/summary files, fake gh on PATH, git-init target, unroutable GITHUB_API_URL)
- test/support/subprocess.mjs holds reusable subprocess + fake-gh fixtures
- scripts/check-coverage.mjs enforces global + per-file coverage floors; wired into CI as npm run test:coverage
- Fixed install-consumer.mjs --secret-stdin: node:fs/promises.readFile(0) rejects numeric fd on Node >=24; switched to readFileSync(0)
- Documented subprocess-boundary testing + coverage-floor convention in backend/quality-guidelines.md


### Git Commits

| Hash | Message |
|------|---------|
| `3442f55` | test: cover shipped Action and installer process entrypoints (A-006) |
| `f221675` | chore(task): record branch for finalization |
| `d991083` | chore(task): archive 07-25-test-shipped-review-process-boundaries |

### Testing

- [OK] npm test — 182 pass (+12)
- [OK] npm run test:coverage — global 91.31% lines / 81.19% branches / 92.69% funcs; teeth-verified exit 1 when floor raised
- [OK] npm run check, npm run validate:metadata (1066 paths), git diff --check clean
- [OK] CI PR #36 test job pass (15s) on Node 24 — confirms subprocess coverage capture + gate green

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 36: Implement adopt operation for manually installed review workflows (A-019)

**Date**: 2026-08-04
**Task**: Implement adopt operation for manually installed review workflows (A-019)
**Branch**: `feat/adopt-manual-review-installations`

### Summary

Added an explicit consumer-installer adopt operation that brings a manually copied ai-review-router.yml under installer ownership: exact-hash recognition against the current template or a versioned historical allow-list, converge-to-current, pending->active manifest, confirmation gate, and reuse of the A-005 containment guard. Shipped via PR #37 (Copilot approved).

### Main Changes

- Add recognizeTemplate + HISTORICAL_TEMPLATE_HASHES registry and adoptInstallation to scripts/consumer-installer.mjs
- Wire adopt into parseArguments (command, --yes/secret/source gating) and runConsumerInstaller; extend HELP
- Update consumer-installer spec, SETUP-PR-AGENT.md adoption guidance, and add 12 adopt tests
- Address Copilot review: group test imports; rename secret/source HELP headings to include adopt


### Git Commits

| Hash | Message |
|------|---------|
| `50d2d53` | feat: adopt manually installed review workflows into installer ownership (A-019) |
| `9d15726` | fix: address Copilot review on adopt (A-019) |
| `1d9d892` | chore(task): record branch for adopt-manual-review-installations |
| `ab82fc3` | chore(task): archive 07-25-adopt-manual-review-installations |

### Testing

- [OK] npm test: 194 pass, 0 fail
- [OK] npm run check / validate:metadata clean; sd-check 7/7 passed
- [OK] Copilot review APPROVED on PR #37; all threads resolved; CI test job pass

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 37: Align local full-check with CI package gates (A-017)

**Date**: 2026-08-04
**Task**: Align local full-check with CI package gates (A-017)
**Branch**: `codex/align-local-full-check-with-ci`

### Summary

Added a repo-owned check:full package script that runs the exact CI npm gates (test, test:coverage, check, validate:metadata) plus a new validate:ci-parity guard, then the pack full-check with generic package scripts skipped; PR #38 review loop converged clean.

### Main Changes

- check:full mirrors CI package gates and runs pack full-check with SKIP_PACKAGE_SCRIPTS=1, replacing the generic stage defaults for the sd-review-pr local entrypoint
- scripts/validate-ci-parity.mjs fails when check:full is missing or omits any ci.yml npm gate; wired as a check:full step and a CI step
- Reverted an edit to pack-managed docs/SD_AI_COMMAND_PACK.md (install-audit drift); hardened the validator CLI entrypoint guard with pathToFileURL per Copilot review
- PR template names npm run check:full


### Git Commits

| Hash | Message |
|------|---------|
| `787b8e4` | feat: align local full-check with CI package gates (A-017) |
| `5943855` | fix: revert edit to pack-managed docs/SD_AI_COMMAND_PACK.md |
| `37a8d56` | fix: harden validate-ci-parity CLI entrypoint guard (Copilot review) |
| `b376d60` | chore(task): record branch for align-local-full-check-with-ci finalization |
| `01fd778` | chore(task): archive 07-25-align-local-full-check-with-ci |

### Testing

- [OK] npm run check:full — 199 tests, coverage OK, check, validate:metadata, validate:ci-parity, pack full-check (exit 0)
- [OK] bash scripts/sd-ai-command-pack-review-full-check.sh — selects check:full (exit 0)
- [OK] node --test test/ci-parity.test.js — 7/7 pass
- [OK] sd-check 7/7; CI green; Copilot 2nd pass no new comments

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 38: Bound review remote operations (A-012): request + subprocess timeouts

**Date**: 2026-08-04
**Task**: Bound review remote operations (A-012): request + subprocess timeouts
**Branch**: `codex/bound-review-remote-operations`

### Summary

Added explicit, testable deadlines to GitHub HTTP requests and consumer-installer gh/git subprocesses, distinguishing timeout from other failures and matching recovery guidance to whether the operation is read-only or mutating. Converged a 4-round Copilot review (secret redaction, then read-vs-mutating timeout-guidance consistency across git, gh, and GET paths).

### Main Changes

- src/github.js: per-attempt AbortController+deadline race with injectable timers; GET retries within MAX_READ_ATTEMPTS, mutations never retry on timeout; read/mutating-specific guidance
- scripts/consumer-installer.mjs: bounded gh (120s) and git (30s) subprocess timeouts; readOnly flag threads through runCommand so read queries advise plain retry, mutations advise reconciliation; consistent secret redaction across timeout/startup/nonzero-exit paths
- Finalization: recorded task branch, archived 07-25-bound-review-remote-operations


### Git Commits

| Hash | Message |
|------|---------|
| `a8a9523` | feat: bound GitHub requests and installer subprocesses with timeouts (A-012) |
| `c91e9e2` | fix: redact secret from gh nonzero-exit error args (Copilot review) |
| `b48e8a5` | fix: give read-appropriate git timeout guidance (Copilot review) |
| `c44afc1` | fix: match gh timeout guidance to read vs mutating subcommand (Copilot review) |
| `68c4819` | fix: give GET timeouts actionable retry guidance (Copilot review) |
| `958c759` | chore(task): record branch for bound-review-remote-operations finalization |
| `1436553` | chore(task): archive 07-25-bound-review-remote-operations |

### Testing

- [OK] node --test test/github.test.js — 25/25 pass
- [OK] node --test test/consumer-installer.test.js — 53/53 pass
- [OK] sd-check review-preflight — 0 failures
- [OK] Copilot review PR #39 — converged clean on head 68c4819 (no new/suppressed/inline comments); CI SUCCESS

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 39: Consolidate routing policy boundaries (A-008)

**Date**: 2026-08-04
**Task**: Consolidate routing policy boundaries (A-008)
**Branch**: `codex/consolidate-routing-policy-boundaries`

### Summary

Gave routing policy, protocol codecs, risk context, and reviewer dispatch one dependency direction: router.js is the single policy owner, protocol.js/receipt.js no longer import it, via a protocol-side decodeRoutingInputs codec seam and two new leaf modules plus two shared services. AC1/AC2 boundary+parity tests added; Copilot review converged in one round.

### Main Changes

- Extract src/path-match.js + src/normalize.js leaf modules (zero local imports)
- Add protocol decodeRoutingInputs codec; move selectProtocolRoute + route-strength policy to router.js (new one-way router->protocol edge); remove protocol/receipt->router inversion
- Extract src/risk-context.js + src/reviewer-dispatch.js shared services; standalone stays policy-free (routeReview direct)
- Add test/dependency-boundaries.test.js (AC1 import matrix) + test/shared-service-parity.test.js (AC2); harden boundary detection for side-effect imports and const-form defs per Copilot review


### Git Commits

| Hash | Message |
|------|---------|
| `8743298` | refactor: consolidate routing policy boundaries (A-008) |
| `874f47a` | test: harden AC1 boundary detection (Copilot review) |
| `785bb52` | chore(task): record branch for consolidate-routing-policy-boundaries finalization |
| `deda6a0` | chore(task): archive 07-25-consolidate-routing-policy-boundaries |

### Testing

- [OK] npm test — 223 pass, 0 fail
- [OK] npm run test:coverage — global 92.11% lines / 82.30% branches / 94.16% funcs, no floor lowered
- [OK] npm run check / validate:metadata / validate:ci-parity — all green
- [OK] Copilot review PR #40 — 2 findings round 1 (both fixed), 0 round 2

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 40: Decompose consumer installer lifecycle (A-009)

**Date**: 2026-08-04
**Task**: Decompose consumer installer lifecycle (A-009)
**Branch**: `refactor/a-009-decompose-consumer-installer`

### Summary

Split scripts/consumer-installer.mjs (1459->488 lines) into codecs/transport/persistence/plan submodules with downhill deps enforced by a boundary test; orchestrator re-exports the full public surface so existing tests import unchanged. Closed audit A-009.

### Main Changes

- Created scripts/consumer-installer/{codecs,transport,persistence,plan}.mjs; reduced consumer-installer.mjs to orchestration + re-exports
- Added test/installer-dependency-boundaries.test.js (import matrix + acyclicity) and test/installer-modules.test.js (22 boundary tests)
- Updated check-coverage.mjs INCLUDES + per-file floors, package.json check wiring, directory-structure.md spec, and marked A-009 fixed in the audit ledger


### Git Commits

| Hash | Message |
|------|---------|
| `22d4399` | refactor: decompose consumer installer lifecycle (A-009) |

### Testing

- [OK] npm test: 288 pass / 0 fail
- [OK] npm run test:coverage: OK (93.73% L / 84.03% B / 95.02% F)
- [OK] npm run check / validate:metadata / install-audit / git diff --check
- [OK] sd-check 7/7; gito clean; prism 2 findings verified false-positive; Copilot COMMENTED no comments

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 41: Ship v2 budget-review contract core (07-25) with Copilot CAS + gate-hole fixes

**Date**: 2026-08-04
**Task**: Ship v2 budget-review contract core (07-25) with Copilot CAS + gate-hole fixes
**Branch**: `feat/define-budget-review-v2-contracts`

### Summary

Shipped the v2 contract core slice and closed two Copilot review findings on PR #42: authorizeProjectionWrite now enforces a true same-head compare-and-swap on the current projection token, and decodeReviewOutcomes now blocks the gate on any review skipped for a non-budget reason. All 9 core acceptance criteria met; remaining v2 families delegated to four follow-up tasks.

### Main Changes

- src/protocol-v2.js: same-head recovery requires presented token == current.latestAuthorizedAttemptToken (CAS witness), closing a stale-token bypass
- src/protocol-v2.js: non-budget skipped review now blocks the gate; budget_exhausted_deferred remains the sole gate-free skip
- Paired reject/accept tests + durable invalid outcomes fixture


### Git Commits

| Hash | Message |
|------|---------|
| `3069c55` | feat: define budget review v2 contract core (07-25-define-budget-review-v2-contracts) |
| `7e2e3d1` | fix(protocol-v2): close CAS stale-token bypass and non-budget review-skip gate hole |

### Testing

- [OK] node --test test/protocol-v2.test.js: 28 pass, 0 fail
- [OK] npm run check:full deterministic gates: 316 tests pass, coverage 93.29% lines / 84.54% branches, metadata + ci-parity OK

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 42: Compile parallel reviewer plans (07-25) — implement + ship PR #43

**Date**: 2026-08-04
**Task**: Compile parallel reviewer plans (07-25) — implement + ship PR #43
**Branch**: `feat/compile-parallel-reviewer-plans`

### Summary

Added the parallel reviewer-plan compiler to src/protocol-v2.js (slot/selector/catalog/plan decoders, chain expansion, overrides, parent/child identities) with fixtures and 10 tests. Dispositioned two Copilot findings on PR #43: bound timeoutSeconds into plan identity and rejected case-colliding chain names, both fixed with paired tests. Full deterministic gate green (326 tests, coverage 93.20% lines). Copilot re-review at fix head generated no new comments; both threads resolved.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `116e1ca` | (see git log) |
| `2114409` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
