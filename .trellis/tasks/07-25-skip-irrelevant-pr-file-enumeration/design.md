# Skip irrelevant PR file enumeration Design

## Boundary

- Entry orchestration decides whether path evidence is needed; `GitHubClient` remains the pagination owner.
- Policy receives an explicit empty path result only after orchestration proves no evaluation is needed.

## Data Flow

```text
event/explicit gate -> parse patterns -> need paths? -> optional pagination -> policy
```

## Compatibility

Preserve the current public behavior except where A-014 identifies behavior that is unsafe, incorrect, or unsupported. Any changed failure must be explicit, bounded, and covered by a regression test.

## Rollback

Keep changes reversible at the owning boundary. If validation exposes a new duplicate side effect, data escape, secret exposure, or incompatible consumer transition, restore the prior implementation while retaining the new failing fixture.
