# Compiled Review Configuration Promotion Design

## Boundary

The sibling compiler owns semantics; this child owns mode-specific input
retrieval and managed state transition. The catalog management credential
exists only in the managed retrieval step and never enters compiler input
beyond the safe projection. Standalone input is local setup discovery only.

```text
active N -> prepare source/catalog -> compile candidate N+1 -> semantic diff
         -> pending N+1 -> validate -> active N+1
```

Runtime reads only active state. Failed preparation, compilation, or validation
leaves active N unchanged. Drift blocks overwrite; uninstall removes only
resources still matching managed ownership.

The semantic diff treats each explicit `budgetExhaustion.<lane>.merge` value as
policy-critical. Promotion rejects missing or legacy values and never carries a
value forward implicitly from active state.

## Rollback

Rollback promotes a previously validated explicit v2 source/input pair using
the same lifecycle. It never edits active state in place.
