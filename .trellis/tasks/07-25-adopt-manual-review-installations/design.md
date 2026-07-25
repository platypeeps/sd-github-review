# Adopt manual review installations Design

## Boundary

- Adoption converts verified existing state into installer ownership; it does not normalize arbitrary workflows.
- Historical hashes and semantic mappings are versioned repository data, not contextual guesses.

## Data Flow

```text
explicit adopt -> inspect/hash/decode -> supported mapping + dry run -> confirmation -> pending ownership -> converge -> active
```

## Compatibility

Preserve the current public behavior except where A-019 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
