# Design — Apply route-control precedence before label parsing (A-011)

## Current control flow (`src/index.js`, action entrypoint)

```
198  pullRequest  = event.pull_request ?? getClient().getPullRequest(...)
199  labels       = pullRequest.labels ?? event.issue?.labels ?? []
200  labelMode    = modeFromLabels(labels)          # THROWS on conflict — too early
201  trustedAssociations = ...
206  commandIsTrusted    = isTrustedCommand({...})   # needs pullRequest.user
215  commandMode  = commandIsTrusted ? rawCommand : null
225  explicitMode = resolveExplicitMode({ configuredMode, commandMode, labelMode })
246  decision     = routeReview({ configuredMode, labelMode, commandMode, ... })
```

`resolveExplicitMode` (`src/normalize.js:97`):

```
configuredMode !== "auto" ? configuredMode : (commandMode ?? labelMode)
```

So `labelMode` is only ever the decider when `configuredMode === "auto"` and
there is no trusted `commandMode`. In every other case the conflicting-label
throw at line 200 fails the run over a value that would have been discarded.

## Fix

Resolve the two higher-precedence controls first, then parse labels only when
they can actually decide the route. `modeFromLabels` is unchanged (still throws
on genuine conflict); we simply stop calling it when a higher control wins.

Reordered flow:

```
198  pullRequest  = ...
199  labels       = ...
     # --- moved up: trusted-command resolution (was 201-215) ---
     trustedAssociations = ...
     commandIsTrusted    = isTrustedCommand({...})
     commandMode  = commandIsTrusted ? rawCommand : null
     # --- guarded label parse (replaces eager line 200) ---
     higherPrecedenceMode = configuredMode !== "auto" ? configuredMode : commandMode
     labelMode    = higherPrecedenceMode ? null : modeFromLabels(labels)
```

- `higherPrecedenceMode` is exactly the antecedent `resolveExplicitMode` uses to
  ignore `labelMode`. When it is truthy, `labelMode` is forced to `null` and the
  conflict throw is never reached — behavior-identical to today for any
  non-conflicting PR (a discarded label value becomes a discarded `null`).
- When `higherPrecedenceMode` is falsy (auto mode + no trusted command),
  `modeFromLabels(labels)` runs exactly as before, preserving the hard error on
  genuine ambiguity.

`labelMode` continues to flow into both `resolveExplicitMode` (line 225) and
`routeReview` (line 248). Passing `null` there when a higher control wins is
already the resolved-route outcome, so no downstream change is needed.

## Behavior matrix (resolved route unchanged except the fixed defect)

| configuredMode | trusted command | labels            | today            | after           |
|----------------|-----------------|-------------------|------------------|-----------------|
| auto           | none            | single `review:x` | route x          | route x         |
| auto           | none            | conflict          | **throw**        | **throw** (same)|
| auto           | `/review deep`  | conflict          | **throw (bug)**  | route deep      |
| `deep` (fixed) | none            | conflict          | **throw (bug)**  | route deep      |
| `deep` (fixed) | none            | single            | route deep       | route deep      |

## Blast radius

- Single file changed: `src/index.js` (reorder ~15 lines + one conditional).
- `src/normalize.js` untouched — `modeFromLabels` throw contract preserved, so
  `test/router.test.js:111` stays green.
- No signature or exported-surface change.

## Compatibility / rollback

- Pure control-flow reorder within one function; no persisted state, no I/O
  ordering change (client fetch already happened at line 198; the moved block
  performs no network calls). `getPullRequest` still called once before the
  block, so `pullRequest.user` is available for `isTrustedCommand`.
- Rollback = revert the single `src/index.js` diff and the added tests.
