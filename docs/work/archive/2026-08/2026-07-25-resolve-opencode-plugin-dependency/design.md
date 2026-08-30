# Resolve OpenCode plugin dependency Design

## Boundary

- This task owns only the nested OpenCode runtime dependency, not command-pack-wide dependency policy.
- No new runtime dependency may be introduced without evidence from the probe.

## Data Flow

```text
OpenCode runtime probe -> remove unused declaration | lock required dependency -> audit/smoke
```

## Compatibility

Preserve the current public behavior except where A-016 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
