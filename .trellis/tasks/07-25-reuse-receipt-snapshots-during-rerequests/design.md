# Reuse receipt snapshots during rerequests Design

## Boundary

- Snapshot reuse is internal to `ReceiptStore`; callers do not cache durable state.
- Head validation remains live and separate from receipt-list reuse.

## Data Flow

```text
begin -> one decoded snapshot -> validate rerequest + identity -> mutation -> required reconciliation refresh
```

## Compatibility

Preserve the current public behavior except where A-015 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
