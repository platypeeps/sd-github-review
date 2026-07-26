# Test shipped review process boundaries Design

## Boundary

- Subprocess fixtures test the shipped composition roots; existing unit tests continue to test injected modules.
- A fake executable records bounded calls without receiving real credentials.

## Data Flow

```text
test process -> real entrypoint -> injected filesystem/environment/PATH boundary -> observable exit/output
```

## Compatibility

Preserve the current public behavior except where A-006 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
