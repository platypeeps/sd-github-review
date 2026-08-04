# Consolidate routing policy boundaries — Design

## Problem (A-008)

`router.js` is a de-facto "everything" module holding three unrelated concerns —
pure route **policy** (`routeReview`), value **canonicalizers**
(`normalizeMode`, `normalizeEscalationRoute`, `normalizeConfidence`, label/command
parsers), and **path-matching** utilities (`globToRegExp`, `findSensitiveFiles`).
That forces two layering inversions (not a JS cycle — the graph is a DAG):

- **Codec → policy**: `protocol.js` (versioned decoders) imports `router.js` and
  hosts route-selection policy (`selectProtocolRoute` + floors/local-evidence/
  successor at `protocol.js:942-1105`).
- **Persistence → router**: `receipt.js` imports `globToRegExp` from `router.js`
  purely for bookkeeping path matching.

There is also duplicated inline composition across the two entrypoints:
risk-context assembly (`index.js:162-244` ≈ `operations.js:339-391`) and the
copilot presence-probe + `requestReviewer` dispatch (`index.js:262-281` ≈
`operations.js:404-432`).

## Target layering (one downhill direction)

```text
leaf utils:  path-match.js (glob, findSensitiveFiles)
             normalize.js  (mode/route/confidence canonicalizers, label/command parsers)
                 ▲                         ▲
protocol.js (versioned decoders) ──────────┘   (imports normalize only; NO policy/router)
                 ▲
policy owner (router.js) ── routeReview + selectProtocolRoute + floor/local-evidence/
                 ▲          successor helpers; imports protocol decoders + normalize + path-match
   ┌─────────────┴───────────────┐
risk-context.js            reviewer-dispatch.js
   ▲                             ▲
entrypoints: index.js, operations.js  ── build context via risk-context.js,
                                          dispatch via reviewer-dispatch.js
receipt.js (persistence) ── imports protocol decoders + path-match.js  (NOT router/policy)
```

Every edge now points from a higher layer to a lower one. `protocol.js` and
`receipt.js` import no policy internals (AC1). `router.js` becomes the single
route-policy owner.

## Seams

1. **`src/path-match.js` (new leaf)** — move `globToRegExp` and
   `findSensitiveFiles` out of `router.js`. Consumers (`receipt.js`, `router.js`,
   `risk-context.js`) import from here. Removes the `receipt.js → router.js` edge.

2. **`src/normalize.js` (new leaf)** — move the value canonicalizers and input
   parsers `protocol.js` and the entrypoints consume (`normalizeMode`,
   `normalizeEscalationRoute`, `normalizeConfidence`, `parseList`,
   `parseReviewCommand`, `modeFromLabels`, `resolveExplicitMode`, `reviewLabels`,
   `isTrustedCommand`, `ignoredEventDecision`). These are canonicalization, not
   policy. `protocol.js` imports its canonicalizers from here, so it no longer
   imports `router.js` at all. Exact export set is finalized during
   implementation by following current `router.js` consumers.

3. **Single policy owner — `router.js`** — keep `routeReview`; move the route
   **policy** (`ROUTE_STRENGTH`, `resolvedRoute`, `weakerRoute`, `strongerRoute`,
   `successorMatchesRequest`, and the floor/local-evidence/successor blocks at
   `protocol.js:942-1105`) into `router.js`, and host the public
   `selectProtocolRoute` callable there.

   **Decode boundary (resolves C-1).** Today `selectProtocolRoute`
   (`protocol.js:975`) is entangled with private codec validators —
   `decodeReviewRequest`, `objectValue`, `booleanValue`, `stringArray`,
   `integerValue`, `enumValue`, `decodeSuccessorEvidence`. Those are codec/
   validation, not policy, and must NOT be exported raw to the policy owner
   (that would leak codec internals and re-invert the layering). Instead
   `protocol.js` exposes ONE new codec function — `decodeRoutingInputs({request,
   routingContext, policy})` — that returns a fully-validated, typed routing-input
   record. It must enumerate **every** value `selectProtocolRoute` currently
   validates through a protocol-private helper (G-A), not a vague "policy flags"
   bucket. The complete typed record is: `request` (via `decodeReviewRequest` —
   its `route`, `policyVersion`, decoded `localReview`); the codec-validated
   `sensitiveFiles` (`stringArray` ≤3000×512B), `changedLines`/`changedLineThreshold`
   (`integerValue`, threshold min 1), `confidence` (`enumValue` over
   `CONFIDENCE_LEVELS`), `draft`/`reviewDrafts`/`allowBookkeepingNone`
   (`booleanValue`), `localConfidenceThreshold` (`integerValue` max 100), and
   `successorEvidence` (`decodeSuccessorEvidence`, or `undefined`); and the
   `normalize.js`-canonicalized `lowConfidenceRoute`/`highRiskRoute`
   (`normalizeEscalationRoute`).

   **Codec/policy split for route-strength fields.** `independentReviewFloor`
   and `localEvidenceRoute` are validated today with `resolvedRoute` — a route-
   **strength** helper (`ROUTE_STRENGTH`), i.e. policy, not codec.
   `decodeRoutingInputs` therefore does NOT resolve them; it passes them through
   as raw `policy` strings and the policy owner applies `resolvedRoute` after
   decode. This keeps `resolvedRoute`/`strongerRoute`/`weakerRoute` in the policy
   owner and every structural/type validator private in `protocol.js`. The
   policy owner's `selectProtocolRoute` calls `decodeRoutingInputs` (protocol),
   then applies `routeReview` + floors/local-evidence/successor over the typed
   record. `protocol.js` keeps all private validators private and imports no
   policy; `router.js` imports `decodeRoutingInputs` from `protocol.js` (+
   `normalize`). New one-way edge `router → protocol`; no `protocol → router`.

   Preserve `selectProtocolRoute`'s public signature and exact return shape
   `{route, reason, policyVersion, floorApplied, localEvidence, successorEvidence}`
   for both the explicit and automatic branches. `test/protocol.test.js` is
   repointed to import `selectProtocolRoute` from the policy owner (NOT a
   re-export from `protocol.js`, which would reintroduce the inverted edge).

4. **`src/risk-context.js` (new service)** — one builder producing the shared
   risk context (changedLines, changedLineThreshold, sensitiveFiles, confidence,
   low-confidence/high-risk routes, draft flags). Both entrypoints call it.
   Entrypoint-specific extras stay at the entrypoint: standalone's
   command/label/trust derivation, durable's `policy` block and `route==="auto"`
   file gating and `store.compareSuccessor`.

5. **`src/reviewer-dispatch.js` (new service)** — one helper for the copilot
   presence-probe (requested-reviewer check + reviewed-at-head check skipping
   `DISMISSED`, case-insensitive `commit_id`) and the conditional `requestReviewer`.
   Standalone calls it directly; durable wraps it with its existing
   `store.observe`/reconciliation try/catch.

## Compatibility (must preserve public v1 behavior)

- **Standalone stays policy-free.** `index.js` today calls `routeReview` directly
  and applies NO floor/local-evidence/successor policy; only the durable path runs
  `selectProtocolRoute`. The shared risk-context/dispatch services must NOT reroute
  the standalone path through `selectProtocolRoute`. Standalone continues to invoke
  `routeReview` with its existing (policy-free) inputs. This is the top regression
  risk — guarded by `test/action.test.js` route expectations before/after.
- Preserve `routeReview` shape `{route, reason}`.
- Preserve `selectProtocolRoute` return shape and reason codes (asserted across
  `test/protocol.test.js:408-633`).
- Preserve `protocol.js` decoder behavior, `stableProtocolJson`, and privacy-
  boundary throws.
- Preserve `receipt.js` bookkeeping classification outcomes (same glob semantics,
  now via `path-match.js`).
- Preserve standalone/durable action outputs incl. `copilot-requested`.
- `CONFIDENCE_LEVELS` is currently duplicated (`router.js:3`, `protocol.js:17`);
  fold to one definition in `normalize.js` only if behavior is provably identical,
  otherwise leave both and note it — not required by A-008.

## Data flow (matches prd)

```text
decoded input (protocol) -> normalized risk context (risk-context.js)
  -> pure policy (router.js: routeReview | selectProtocolRoute)
  -> authorized dispatch (reviewer-dispatch.js) -> receipt/output
```

v2 seams attach at `risk-context.js` (alternate context for standalone/managed
planners) and at the policy owner (a managed planner becomes a second policy
caller) without touching the codec or persistence layers.

## Allowed-import matrix (target)

The dependency test enforces this whole matrix, not just a few edges (C-5). Each
`src` module may import only from modules to its right; leaf modules import no
local module.

| Module | May import (local) |
|---|---|
| `path-match.js` | (none — leaf) |
| `normalize.js` | (none — leaf) |
| `protocol.js` | `normalize.js` |
| `router.js` (policy) | `protocol.js`, `normalize.js`, `path-match.js` |
| `receipt.js` | `protocol.js`, `path-match.js` |
| `risk-context.js` | `path-match.js`, `normalize.js` |
| `reviewer-dispatch.js` | `github.js` (client only) |
| `operations.js` | `protocol.js`, `router.js`, `receipt.js`, `risk-context.js`, `reviewer-dispatch.js`, `normalize.js`, `path-match.js` |
| `index.js` | `github.js`, `operations.js`, `router.js`, `risk-context.js`, `reviewer-dispatch.js`, `normalize.js`, `path-match.js` |
| `github.js` | (none — leaf) |

Forbidden in every case: `protocol.js`→`router.js`, `receipt.js`→`router.js`,
any import of a policy symbol by `protocol.js`/`receipt.js`, and any local import
by `path-match.js`/`normalize.js`.

## Verification

- **AC1** — new `test/dependency-boundaries.test.js`: statically parse every
  `src/*.js` module's import statements and assert the full allowed-import matrix
  above, including that `path-match.js` and `normalize.js` have zero local
  imports and that `selectProtocolRoute` is defined in exactly one module
  (the policy owner). Not just the `protocol`/`receipt` edges (C-5).
- **AC2** — new parity fixture with a **discriminating** case (C-4): (a) shared
  risk-context builder + dispatch service produce identical structures for the
  same inputs across both entrypoints; (b) a configured independent-review floor
  raises the durable route via `selectProtocolRoute` while the standalone route
  (`routeReview`, same risk inputs) stays unchanged — proving standalone did not
  silently gain policy. Dispatch parity covers already-requested, exact-head
  reviewed, `DISMISSED`, and newly-requested cases.
- **AC3** — existing `router`, `protocol`, `receipt`, `operations`, `action`
  suites stay behaviorally unchanged (parity fixtures). Add exact-key assertions
  on the `selectProtocolRoute` return object for both the explicit and automatic
  branches, including `policyVersion` and stable `reason` values (C-6).
- **AC4** — update `DESIGN.md` / directory-structure spec to describe the new
  module boundaries.

## Rollback

Each seam is an independent, reversible move. If validation exposes a standalone
behavior change, a duplicated side effect, a privacy/ownership regression, or a
consumer break, restore the prior module while retaining the new failing fixture.
The A-008 regression fixture (dependency-boundaries + standalone-policy-free
parity) is the ship gate.
