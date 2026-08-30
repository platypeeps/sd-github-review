---
title: Restore sd-check shipped-helper rows under a thin pack install
status: done
created: 2026-08-16
branch: task/archive-thin-install-record
---
# Restore sd-check shipped-helper rows under a thin pack install

## Goal

`sd-check` cannot aggregate to `passed` in this repository, so `sd-review`
fails closed at its capability phase and the whole `sd-ship` chain is
unreachable. Five built-in rows resolve their helper from `repo/scripts/`, a
directory the thin conversion emptied. The helpers are installed and working —
just not where the check looks.

This blocks every pull request in this repository, not one task.

## Background

The thin conversion (`9a4787a`, on `main`) deleted 25
`scripts/sd-ai-command-pack-*` files. That is the intended design, recorded in
`.trellis/spec/backend/directory-structure.md`:

> This repository runs a thin install: the payload is not vendored here at all,
> it lives in the machine install under `~/.agents/bin/`, and the only pack
> files left in the tree are the repo-native surfaces plus the resolver at
> `.sd-ai-command-pack/bin/sd-ai-command-pack-review-layout.py`.

`sd-ai-command-pack-check.py` was not updated for that design. Its
`shipped_helper_row` factories resolve one path and no other:

```python
# ~/.agents/bin/sd-ai-command-pack-check.py:998
audit = repo / "scripts/sd-ai-command-pack-install-audit.py"
```

`grep -n "agents/bin" ~/.agents/bin/sd-ai-command-pack-check.py` returns
nothing: the file has no awareness of the machine install at all.

**Observed at pack 0.71.24**, `sd-check --json` in this repository:

| status | id | diagnostic |
|---|---|---|
| passed | `git.whitespace.unstaged` | check passed |
| passed | `git.whitespace.staged` | check passed |
| unavailable | `pack.review-preflight` | deterministic review preflight helper is not present |
| unavailable | `pack.install-audit` | installed payload audit helper is not present |
| unavailable | `knowledge.obsidian-kb` | Obsidian KB exists but its read-only freshness helper is missing |
| unavailable | `pack.review-scope` | tooling and generated review-scope helper is not present |
| unavailable | `pack.pr-body-scope` | PR-body scope helper is not present |

Aggregate `unavailable`, exit 3. `sd-review` then reports `status: "blocked"`,
`diagnostic: "typed sd-check did not pass"`,
`limitations: ["deterministic-check-not-passed"]`, and never reaches dispatch.

Every one of the five helpers is present and executable on the machine:

```text
sd-ai-command-pack-review-preflight.mjs   repo/scripts:NO  ~/.agents/bin:yes
sd-ai-command-pack-install-audit.py       repo/scripts:NO  ~/.agents/bin:yes
sd-ai-command-pack-review-scope.sh        repo/scripts:NO  ~/.agents/bin:yes
sd-ai-command-pack-pr-body-scope.py       repo/scripts:NO  ~/.agents/bin:yes
sd-ai-command-pack-update-spec-kb.py      repo/scripts:NO  ~/.agents/bin:yes
```

`node ~/.agents/bin/sd-ai-command-pack-review-preflight.mjs` runs green from
this repository root — 0 failures, 1 warning — so the checks are not merely
absent, they are absent *and* passing when invoked directly.

**Not introduced by the 0.71.24 refresh.** The plugin-cache copy at 0.71.22
carries the identical `repo / "scripts/..."` line at 998. The blocker dates to
the thin conversion, not to today's pack bump.

**A repository-owned `check.json` is not the remedy**, despite what three of
the five remediation strings suggest. Built-in rows are appended
unconditionally before configuration is read
(`sd-ai-command-pack-check.py:1089-1099`), and the coordinator rejects a
duplicate row ID, so a configured entry can neither replace nor suppress an
`unavailable` built-in. Verify before assuming otherwise — that assumption is
the obvious first move and it does not work.

## Requirements

- `sd-check` must reach `passed` in a thin-install consumer whose helpers are
  present in the machine install.
- Resolution must stay evidence-based. A helper genuinely missing from both the
  repository and the machine install stays `unavailable`; the fix widens where
  the check looks, never what counts as present.
- A fat/vendored consumer keeps today's behaviour: `repo/scripts/` wins where
  it exists, so existing consumers see no change.
- Do not weaken the aggregate contract. `unavailable` must keep blocking; the
  fix is to stop manufacturing false `unavailable` rows.
- The fix lands upstream in `platypeeps/sd-ai-command-pack`. Nothing in
  `scripts/` may be restored here to work around it — `pack.install-audit`
  fails any local edit to a pack-owned path, and the next refresh would
  overwrite it.

## Acceptance criteria

- [x] `sd-check --json` in this repository reports aggregate `passed` with exit
      `0` and zero `unavailable` rows, with the pack refreshed to the version
      carrying the fix.
- [x] Each of the five rows resolves to the machine-install helper and executes
      it, rather than being skipped or assumed present.
- [x] A consumer that still vendors `scripts/sd-ai-command-pack-*` resolves the
      repository copy, proven by an upstream test covering both layouts.
- [x] A helper absent from both locations is still `unavailable` with its
      existing diagnostic, proven by an upstream test.
- [x] `sd-review scope=pr` in this repository advances past the capability
      phase to remote dispatch.

## Resolution

Delivered upstream, not here — which is what the requirements demanded. The fix
shipped as `platypeeps/sd-ai-command-pack#482` in pack **0.71.26**, and this
repository was refreshed to it. Nothing was restored under `scripts/`.

Evidence per criterion:

1. `sd-check --json` from this repository root at 0.71.26: aggregate `passed`,
   exit `0`, 7 rows, **0** `unavailable` — against aggregate `unavailable`,
   exit `3`, and five `unavailable` rows at 0.71.24.
2. All five formerly-`unavailable` rows report `passed`:
   `pack.review-preflight`, `pack.install-audit`, `knowledge.obsidian-kb`,
   `pack.review-scope`, `pack.pr-body-scope`. A `passed` row is one that ran,
   and `unavailable` is what "skipped" looks like here, so none were assumed.
3. Covered by upstream tests in #482, which extended the sibling resolution
   suite to the thin layout, including the case that review caught as missing:
   `knowledge.obsidian-kb` present in the machine install.
4. Covered by the same suite's pre-existing absent-from-both case, which must
   stay `unavailable` — the fix widens where the check looks, never what counts
   as present.
5. Proven the strong way rather than the stated one: `sd-review scope=pr` did
   not merely pass the capability phase, it completed five live routed rounds
   against PR #93 and reached a terminal `status: ready` report with remote
   observation materialized.

The `.sd-ai-command-pack/bin/sd-ai-command-pack-review-layout.py` seam suggested
in the notes below is the one the upstream fix used.

This record is archived rather than reopened as planned work: there is no
consumer-side work left in it, and leaving it open would put a phantom in the
backlog.

## Notes

Found by the `sd-work-backlog` run `26da1a72f4aa4bed9cb5577a0dc386b1` while
shipping `08-16-bind-copilot-review-evidence`. That task's PR (#93) is open and
unreviewed because of this blocker, and its last acceptance criterion — a live
routed `sd-review` printing `Limitations: remote-evidence-not-dispatch-caused`
beside real Copilot findings — cannot be met until this is fixed.

The fix is upstream and therefore needs explicit approval for that cross-repo
pull request; it is outside the autonomous run's authority.

Consider whether the resolver already installed at
`.sd-ai-command-pack/bin/sd-ai-command-pack-review-layout.py` is the intended
seam for this, rather than teaching `check.py` a second hardcoded path.
