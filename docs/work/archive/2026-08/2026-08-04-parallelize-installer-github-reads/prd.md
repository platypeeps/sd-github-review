---
title: Parallelize installer inspect GitHub reads (A-022)
status: done
created: 2026-08-04
---
# Parallelize installer inspect GitHub reads (A-022)

## Goal

Close audit finding A-022 so the consumer installer's independent repository
inspection reads run concurrently, reducing cold-install wall-clock, without
changing the ordering of any state-mutating operation or the installer's
redaction and timeout behavior.

## Audit Finding

- ID: A-022 · severity P3 · effort M · confidence Plausible · dimension performance
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: consumer installation serializes independent GitHub CLI calls; cold
  installation time is the sum of every process and network round trip.

## Evidence Boundary

- Ledger cites `scripts/consumer-installer.mjs:90` (blocking `spawnSync`) and
  `:117` (independent inspections run serially). On main @ HEAD (2026-08-04) the
  entire `GitHubCli` runs through synchronous `runCommand` → `spawnSync`, and
  `GitHubCli.inspect(repository)` issues four **independent, read-only** `gh`
  queries in sequence: `repo view`, `variable list`, `secret list`, and
  `label list`. Their latency adds up even though none depends on another.
- Because `spawnSync` blocks the event loop, wrapping the current calls in
  `Promise.all` alone yields no speedup — real concurrency requires an
  asynchronous subprocess seam.

## Requirements

- The four independent `inspect` reads execute concurrently, not serially.
- All state-mutating gh operations (`setVariable`, `deleteVariable`,
  `createLabel`, `deleteLabel`, `setSecret`, `deleteSecret`) keep running on the
  existing ordered synchronous path — installation state transitions stay
  sequenced exactly as today.
- Secret redaction on error is unchanged: no secret value can appear in any
  error surfaced by the new async path (the four reads carry no secret, but the
  shared error-interpretation must preserve redaction for the sync path).
- Timeout behavior is unchanged: a read-only timeout still yields the
  "read was interrupted — retry once GitHub is responsive" guidance and never
  the mutation-reconciliation wording; a mutation timeout still yields the
  reconciliation guidance.
- A non-timeout spawn failure (e.g. `gh` not installed) is still reported as
  "could not start", not a timeout.
- The subprocess seam stays injectable so tests drive concurrency, timeout, and
  failure deterministically without a real subprocess.

## Acceptance Criteria

- [x] `GitHubCli.inspect` issues its four reads through an async seam and they
      overlap (a deterministic test observes all four in flight at once).
- [x] Mutation methods remain on the synchronous `spawnImpl` path; their
      existing timeout/redaction tests pass unchanged.
- [x] Read-only timeout guidance and secret redaction are preserved on the new
      async path (asserted by tests), including the C-1 maxBuffer guard.
- [x] `inspect` returns the same `{repository, variables, secrets, labels}`
      shape and values as before for equivalent inputs.
- [x] Full suite green (baseline 235/235 after A-020; +5 new → 240/240).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-022 set to fixed only after verification;
      owner reassigned to this dedicated child.

## Verification Limits

- Concurrency, timeout, redaction, and result-shape are all verified with an
  injected fake exec seam (no real `gh`/network). Actual wall-clock improvement
  against live GitHub is an operator observation, not exercised here; the test
  proves overlap (max-in-flight = 4), which is the mechanism behind the speedup.

## Out of Scope

- Converting mutation operations to async or reordering the install lifecycle.
- Broader installer decomposition (A-009).
- Adding ret/backoff or a general concurrency pool beyond the fixed four-read
  fan-out.
