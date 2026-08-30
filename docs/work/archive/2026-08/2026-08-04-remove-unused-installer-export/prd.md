---
title: Remove unreachable hasManagedFiles installer export (A-021)
status: done
created: 2026-08-04
---
# Remove unreachable hasManagedFiles installer export (A-021)

## Goal

Close audit finding A-021 by deleting the unreachable `hasManagedFiles`
export from the consumer installer, without changing installer behavior, and
lock the export surface against silent dead-code reintroduction.

## Audit Finding

- ID: A-021 · severity P3 · effort S · confidence Plausible · dimension bloat
- first-seen / last-seen: 2026-07-25 @ 2eeca60
- Summary: `hasManagedFiles` is an unreachable public export — the helper
  expands the supported surface without serving behavior.

## Evidence Boundary

- `scripts/consumer-installer.mjs:1408` — `export async function
  hasManagedFiles(target)`; the definition is the only reference.
- Confirmed on main @ HEAD (2026-08-04): a repo-wide search for
  `hasManagedFiles` across `*.js`/`*.mjs`/`*.ts` finds it only at its
  definition (all other hits are audit/task documents). No test, no `src/`,
  no other installer code path calls it. The installer computes manifest and
  workflow presence inline where needed, so removing this helper cannot change
  install/update/adopt/uninstall behavior.

## Requirements

- The `hasManagedFiles` export and its function body are removed from
  `scripts/consumer-installer.mjs`.
- The private helper `pathExists` (`consumer-installer.mjs:386-394`), whose only
  callers are inside `hasManagedFiles`, is removed in the same change so the fix
  does not leave a new orphaned helper.
- No external installer code path or test depends on either symbol (verified:
  `hasManagedFiles` has no caller; `pathExists` is called only by
  `hasManagedFiles`), so no call site needs rewiring and `readOptional` — which
  keeps `readFile` in use — is untouched.
- The installer's remaining public surface and behavior are unchanged.

## Acceptance Criteria

- [x] `hasManagedFiles` and its orphaned-on-removal private helper `pathExists`
      are no longer defined or exported by `scripts/consumer-installer.mjs`.
- [x] A regression test asserts the installer module namespace does not export
      `hasManagedFiles` (guards against reintroducing the dead export).
- [x] Full suite green (baseline 233/233 after A-016; new test on top → 234/234).
- [x] `check:full` reports 0 failures.
- [x] `.trellis/audit/ledger.md` A-021 set to fixed only after verification;
      owner reassigned to this dedicated child.

## Verification Limits

- This is a pure dead-code deletion with no runtime call sites. The regression
  test plus the full installer suite fully exercise the change; there is no
  external-runtime gap.

## Out of Scope

- Any other unused-export audit or broader installer decomposition (A-009).
- Behavioral change to installer lifecycle commands.
