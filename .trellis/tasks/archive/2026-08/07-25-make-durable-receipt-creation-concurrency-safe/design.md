# Make durable receipt creation concurrency safe Design

## Boundary

- `ReceiptStore` owns election and reconciliation; callers receive only authoritative dispatch state.
- GitHub Check Runs remain the durable store, so the design must not assume atomic create-if-absent support.

## Data Flow

```text
concurrent begin -> create candidates -> full visibility/election -> one authoritative receipt -> at most one dispatch
```

## Compatibility

Preserve the current public behavior except where A-003 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
