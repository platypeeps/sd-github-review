# Design — Reuse one current-head receipt snapshot during same-head rerequests (A-015)

## Current loads in `begin` (`src/receipt.js`)

```
await #assertLiveHead(request)                       // getPullRequest
receipt = #newReceipt(request, ...)                  // no client
await #validateRerequest(...)                        // rerequest: query -> #electedRecords -> listCheckRuns  [LOAD 1]
existing = await #recordForIdentity(request)         // #electedRecords -> listCheckRuns                      [LOAD 2]
... createCheckRun ...
election = await #electedRecords(...)                // listCheckRuns (post-create reread)                    [LOAD 3]
```

LOAD 1 and LOAD 2 are the same pre-create `(pullRequestNumber, headSha)` elected
set. LOAD 3 is post-mutation and must stay.

`#validateRerequest` uses `this.query({ pullRequestNumber, headSha,
logicalDispatchId })`, and `query` = `#electedRecords` + a filter/multi-match
guard. `#recordForIdentity` = `#electedRecords` + `elected.get(logicalDispatchId)`.

## Fix

Extract the pure selection from `query`, then load one pre-create snapshot in
`begin` and pass its `elected` map to both consumers.

1. New private helper (pure; no I/O):

```
#selectElectedReceipt(elected, { logicalDispatchId, correlationId }) {
  if (!logicalDispatchId && !correlationId) {
    throw new Error("receipt query requires logicalDispatchId or correlationId");
  }
  const matches = [...elected.values()].filter(({ receipt }) =>
    (!logicalDispatchId || receipt.logicalDispatchId === lower(logicalDispatchId))
    && (!correlationId || receipt.correlationIds.includes(correlationId)));
  if (matches.length > 1) {
    throw new Error("receipt query matched multiple durable receipts");
  }
  return matches[0]?.receipt ?? null;
}
```

2. `query` becomes load + helper (behavior identical):

```
const { elected } = await this.#electedRecords(pullRequestNumber, lower(headSha));
return this.#selectElectedReceipt(elected, { logicalDispatchId, correlationId });
```

3. `#validateRerequest` takes the pre-loaded `elected` and uses the helper
   instead of `this.query`:

```
async #validateRerequest(request, selectedRoute, backend, authorized, elected) {
  if (!request.rerequestOf) return;
  if (!authorized) throw ...;
  const prior = this.#selectElectedReceipt(elected, {
    logicalDispatchId: request.rerequestOf.priorLogicalDispatchId,
  });
  // ...unchanged identity/attempt/policy/route/backend checks...
}
```

4. `begin` loads once and shares; `#recordForIdentity` is inlined:

```
const receipt = this.#newReceipt(request, ...);
const preElection = await this.#electedRecords(request.pullRequestNumber, request.headSha);
await this.#validateRerequest(request, receipt.selectedRoute, receipt.backend,
                              rerequestAuthorized, preElection.elected);
const existing = preElection.elected.get(request.logicalDispatchId) ?? null;
```

The post-create `#electedRecords` (LOAD 3) is untouched.

## Load count

| begin kind      | listCheckRuns before | after |
|-----------------|----------------------|-------|
| rerequest       | 3                    | 2     |
| non-rerequest   | 2                    | 2     |

## Correctness notes

- `begin` already uses `request.headSha` (raw) for the identity load
  (`#recordForIdentity`, line 544); the shared `preElection` uses the same,
  matching pre-existing behavior. `query` keeps its defensive `lower(headSha)`
  for external callers.
- `#selectElectedReceipt` preserves `query`'s `lower(logicalDispatchId)`
  matching and the multi-match throw, so rerequest prior-lookup semantics are
  identical.
- A rerequest carries a new attempt-keyed `logicalDispatchId`, so
  `preElection.elected.get(request.logicalDispatchId)` is normally `null` and the
  create path runs exactly as before.

## Blast radius

- Single file: `src/receipt.js` (add one helper, rewire `query`,
  `#validateRerequest`, `begin`; remove/inline `#recordForIdentity`).
- No public method signature change; `query` behavior identical.

## Compatibility / rollback

- Pure read-consolidation; no write ordering, schema, or output change.
- Rollback = revert the single-file diff and the added test.
