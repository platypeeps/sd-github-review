# Implementation Plan

1. [x] Add and parse `--finish-work-head <oid>` in the housekeeping script.
2. [x] Refuse the ready-open-PR merge path when the exact-head attestation is absent or stale, without
   changing cleanup-only behavior or any existing merge predicate.
3. [x] Extend the hermetic self-test for both sides of the handoff.
4. [x] Align `sd-housekeeping`, `sd-ship`, and the cross-layer thinking guide with
   the executable contract.
5. [x] Add a repository-owned Node regression test that detects future pack drift.
6. [x] Record reviewed local-override hashes without relabeling the bytes as the
   unchanged upstream payload.
7. [x] Run the focused self-test, shell lint, project test/check/metadata gates,
   install audit, and `git diff --check`.
