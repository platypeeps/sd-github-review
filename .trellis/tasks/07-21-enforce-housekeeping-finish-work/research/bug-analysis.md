# Bug Analysis: Housekeeping merged before finish-work

## 1. Root Cause Category

- **Category**: B/D - Cross-Layer Contract and Test Coverage Gap
- **Specific Cause**: The agent-facing skill required `sd-finish-work` before
  merge, but the shell merge gate accepted no evidence that the lifecycle step
  completed. The script's hermetic tests covered GitHub readiness predicates
  only, so a caller could skip finish-work while every executable test passed.

## 2. Why Fixes Failed

1. **Documentation-only sequencing**: The earlier command-pack correction put
   finish-work before housekeeping in skill prose but left the shell merge
   entry point independently callable.
2. **Incomplete scope**: Platform adapters still told agents to run the plain
   script, which made the shared skill and adapter instructions contradictory.
3. **Missing integration assertion**: No repository-owned test survived a
   vendored pack refresh and asserted the lifecycle handoff scenario by name.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Require an exact `--finish-work-head` before open-PR auto-merge | DONE |
| P0 | Test coverage | Test attested success and un-attested refusal hermetically | DONE |
| P1 | Change propagation | Align shared skills, all installed adapters, and operator docs | DONE |
| P1 | Provenance | Vouch the reviewed local override with an explicit derived version | DONE |
| P2 | Upstream propagation | Port the contract to the command-pack source and fleet | OUT OF SCOPE |

## 4. Systematic Expansion

- **Similar Issues**: Any agent skill that promises a prerequisite before a
  mutating shell command can fail the same way if the executable has no
  handoff value.
- **Design Improvement**: Treat lifecycle completion as an explicit input to
  the protected executable, while leaving inspection and post-merge cleanup
  available without it.
- **Process Improvement**: Generated adapters must be reviewed as contract
  consumers, and at least one non-vendored test should detect silent refresh
  drift.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [x] Updated the relevant skills, platform adapters, and pack documentation.
- [x] Added executable and repository-owned regression coverage.
- [x] Recorded local override provenance.
- [x] Verified there is no consumer-owned template source tree to sync; the
  installed adapters are the complete local platform surface.
