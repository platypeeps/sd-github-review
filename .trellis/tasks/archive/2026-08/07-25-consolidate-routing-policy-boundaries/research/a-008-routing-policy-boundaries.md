# Research: A-008 consolidate routing policy boundaries

- **Query**: Investigate audit finding A-008 — routing policy / protocol codec / risk-context / reviewer-dispatch dependency direction
- **Scope**: internal
- **Date**: 2026-08-04
- **Audit head**: 2eeca60 (line numbers below are current-tree, verified by content)

## Findings

### Files Found

| File Path | Role today |
|---|---|
| `src/router.js` | Pure routing primitives + `routeReview` policy core + `globToRegExp`/`findSensitiveFiles` path matching. No local imports (leaf). |
| `src/protocol.js` | Versioned codecs (decode/canonicalize). ALSO owns `selectProtocolRoute` — floors + local-evidence + successor policy. Imports from `router.js`. |
| `src/index.js` | Standalone entrypoint. Builds risk context inline, calls `routeReview` directly, dispatches copilot inline. |
| `src/operations.js` | Durable entrypoint. Builds risk context + policy inline, calls `selectProtocolRoute`, dispatches copilot inline. |
| `src/receipt.js` | Receipt persistence. Imports `globToRegExp` from `router.js` for bookkeeping path matching. |
| `src/github.js` | GitHub client (leaf, no local imports). |

### 1. Import / dependency graph (current direction of each edge)

```text
index.js ──▶ github.js
index.js ──▶ operations.js
index.js ──▶ router.js          (findSensitiveFiles, ignoredEventDecision, isTrustedCommand,
                                 modeFromLabels, normalizeConfidence, normalizeEscalationRoute,
                                 normalizeMode, parseList, parseReviewCommand, resolveExplicitMode,
                                 reviewLabels, routeReview)

operations.js ──▶ protocol.js   (decodeAdapterRequest, decodeAdapterAcknowledgment, decodeBackend,
                                 decodeReviewRequest, selectProtocolRoute, stableProtocolJson)
operations.js ──▶ receipt.js    (ReceiptStore)
operations.js ──▶ router.js     (findSensitiveFiles, normalizeConfidence, normalizeEscalationRoute,
                                 normalizeMode, parseList)

receipt.js ──▶ protocol.js      (decodeAdapterAcknowledgment, decodeReceipt, decodeReviewRequest,
                                 decodeSuccessorEvidence, stableProtocolJson)
receipt.js ──▶ router.js        (globToRegExp)                      ◀── COUPLING A-008 flags (#4)

protocol.js ──▶ router.js       (normalizeEscalationRoute, normalizeMode, routeReview)  ◀── INVERSION A-008 targets (#2)

router.js ──▶ (nothing)         leaf
github.js ──▶ (nothing)         leaf
```

Evidence for each edge:
- `src/protocol.js:2` — `import { normalizeEscalationRoute, normalizeMode, routeReview } from "./router.js";`
- `src/index.js:3-18` — imports of `github.js`, `operations.js`, and the `router.js` block.
- `src/operations.js:2-17` — `protocol.js` block, `receipt.js`, `router.js` block.
- `src/receipt.js:2-9` — `protocol.js` block, then `import { globToRegExp } from "./router.js";`

**No literal import cycle** (the graph is a DAG). The A-008 problem is *layering inversion*, not a JS cycle:
- The **codec layer** (`protocol.js`) depends on and re-hosts **policy** (`routeReview` + floors/local-evidence). A codec importing the router policy core is backwards.
- The **persistence layer** (`receipt.js`) reaches into the **router** for a generic glob utility, coupling receipt classification to router internals.
- `router.js` is currently the de-facto shared "everything" module: it holds pure route selection, mode/confidence normalizers, AND path-matching glob utilities — three different concerns consumed by four modules.

### 2. Policy-in-codec inventory (protocol.js `:975` region)

`selectProtocolRoute` — `src/protocol.js:975-1105`. Signature:
```js
export function selectProtocolRoute({ request: requestValue, routingContext = {}, policy = {} })
```
It decodes the request (`decodeReviewRequest`, codec-appropriate) but then performs **route-selection policy**:
- Delegates the base decision to `routeReview(...)` from router.js — `src/protocol.js:1013-1027`.
- Computes the **independent review floor** and **risk floor** — `src/protocol.js:1039-1046` (`configuredFloor`, `riskFloor = sensitiveFiles.length > 0 || changedLines >= changedLineThreshold ? highRiskRoute : "none"`, `floor = strongerRoute(configuredFloor, riskFloor)`).
- Applies **local-evidence eligibility policy** — `src/protocol.js:1052-1077` (`localConfidenceThreshold` default 80, outcome in `["clean","fully-dispositioned"]`, `unresolved === 0`; lowers route via `weakerRoute`).
- Applies **successor-evidence / bookkeeping-none policy** — `src/protocol.js:1079-1089`.
- Applies the floor at the end and reports `floorApplied` — `src/protocol.js:1091-1104`.

Supporting policy helpers that live in protocol.js (also policy, not codec):
- `ROUTE_STRENGTH` map — `src/protocol.js:98-103`.
- `resolvedRoute` — `src/protocol.js:942-947`.
- `weakerRoute` / `strongerRoute` — `src/protocol.js:949-955`.
- `CONFIDENCE_LEVELS` — `src/protocol.js:17` (duplicated concept; router.js:3 has its own `CONFIDENCE_LEVELS`).

Called from: `src/operations.js:362` only (production). Tests: `test/protocol.test.js:408-633` (20+ call sites) — these are the parity fixtures for policy behavior.

Note the split brain: the **standalone** path never calls `selectProtocolRoute`; it calls `routeReview` directly (`src/index.js:245`), so floors / local-evidence / successor policy exist ONLY on the durable path today.

### 3. Duplicated composition — standalone (index.js) vs durable (operations.js)

**Risk-context construction** (identical fields, computed inline in both):

| Field | Standalone `index.js` | Durable `operations.js` |
|---|---|---|
| changedLines | `:226` `additions + deletions` | `:339` `additions + deletions` |
| changedLineThreshold | `:228` `positiveIntegerInput("changed-line-threshold",800)` | `:340-345` `integerInput("changed-line-threshold",800,{minimum:1})` |
| sensitiveFiles | `:238-244` `parseList("sensitive-paths")` + `findSensitiveFiles(files,…)` | `:346-352` same, but files gated on `request.route === "auto"` |
| confidence | `:163` `normalizeConfidence(input("confidence"))` | `:369` same (inline in routingContext) |
| lowConfidenceRoute | `:164-167` | `:354-357` |
| highRiskRoute | `:168-171` | `:358-361` |
| draft / reviewDrafts | `:227,252` | `:371-372` |
| successorEvidence | (not used) | `:353,373` via `store.compareSuccessor` |

Differences: standalone also derives command/label mode + trust (`:175-235`, GitHub-comment specific) and does NOT build the `policy` block; durable builds the `policy` block (`:375-391`: allowBookkeepingNone, independentReviewFloor, localConfidenceThreshold, localEvidenceRoute) and gates file listing on `route==="auto"`.

**Route call:** standalone `routeReview(...)` `src/index.js:245-260`; durable `selectProtocolRoute(...)` `src/operations.js:362-392`. Same underlying risk inputs; durable wraps with the extra policy layer.

**Reviewer-dispatch (copilot) sequence** — near-identical, duplicated:

| Step | Standalone `index.js:262-281` | Durable `operations.js:404-432` |
|---|---|---|
| reviewer id | `input("copilot-reviewer", …)` `:264` | `backend.reviewAuthors[0]` `:406` |
| getRequestedReviewers | `:265` | `:407` |
| alreadyRequested check | `:266` `users.some(login===reviewer)` | `:408` same |
| listPullRequestReviews / alreadyReviewed | `:268-276` match by `commit_id===headSha` & `state!=="DISMISSED"` | `:409-415` same, but lowercases `commit_id` |
| requestReviewer if neither | `:277-280` | `:416-418` |
| post-dispatch | sets `copilotRequested=true` | wraps in try/catch → `store.observe(...)` (`:420-431`), reconciliation on error (`:433-443`) |

Identical logic: reviewer-presence probe (requested + reviewed-at-head, skip DISMISSED) and conditional `requestReviewer`. Divergences: reviewer-source, case-normalization of `commit_id`, and durable's receipt `observe`/reconciliation wrapper.

### 4. Receipt ↔ router coupling & generic path matching

- `src/receipt.js:9` imports `globToRegExp` from `router.js`.
- Used in `classifyComparison` bookkeeping detection — `src/receipt.js:274-283`: `const matchers = bookkeepingPatterns.map(globToRegExp); … matchers.some((m) => m.test(path))`.
- `bookkeepingPatterns` default `[".trellis/**", ".obsidian-kb/**"]` — `src/receipt.js:299`, wired from `operations.js:328-330` (`bookkeeping-paths` input) and re-emitted at `src/receipt.js:731`.

The generic path-matching primitives that A-008 wants moved to a neutral util:
- `globToRegExp` — `src/router.js:47-73` (pure glob→RegExp, no routing knowledge).
- `findSensitiveFiles` — `src/router.js:75-78` (used by index.js:244 and operations.js:349).

Both are pure file-path utilities with zero routing-policy dependency, yet they sit in `router.js`, forcing `receipt.js` (persistence) to import the router.

### 5. Proposed target boundary (one-way dependency direction)

Recommended seams (each cites what must move and why):

1. **Neutral path-matching util** (e.g. `src/path-match.js`): host `globToRegExp` (`router.js:47-73`) and `findSensitiveFiles` (`router.js:75-78`). Consumers: `receipt.js`, `index.js`, `operations.js` import from here instead of `router.js`. Removes the receipt→router edge.

2. **Single policy owner for route selection** (e.g. `src/policy.js` / keep in `router.js` as the pure policy module): host `routeReview` plus the floor/local-evidence/successor logic currently in `protocol.js:942-1105` (`ROUTE_STRENGTH`, `resolvedRoute`, `weakerRoute`, `strongerRoute`, `selectProtocolRoute`). `protocol.js` then keeps ONLY versioned decode/canonicalize (`decodeReviewRequest`, etc.) and stops importing `router.js`. New direction: `policy → protocol` (policy calls decoders), never `protocol → policy`.

3. **Shared risk-context service**: extract the identical risk-context assembly (table in #3) into one builder consumed by both `index.js` and `operations.js`, so standalone and durable feed the same policy owner. Enables AC2 parity fixtures.

4. **Shared reviewer-dispatch service**: extract the copilot presence-probe + conditional `requestReviewer` (index.js:262-281 / operations.js:404-432) into one dispatch helper; durable keeps its `store.observe`/reconciliation wrapper around the shared call.

Resulting one-way direction:
```text
entrypoints (index.js, operations.js)
    ├─▶ risk-context service ─▶ policy owner ─▶ protocol (decoders)
    ├─▶ reviewer-dispatch service ─▶ github client
    └─▶ receipt (persistence) ─▶ protocol (decoders) + path-match util
protocol ─▶ (decoders only; no policy import)
policy ─▶ protocol + path-match util
path-match ─▶ (leaf)
```

**Public v1 behavior/exports to preserve** (parity, not just tests):
- `routeReview` shape `{route, reason}` — `test/router.test.js:31`.
- `selectProtocolRoute` return `{route, reason, policyVersion, floorApplied, localEvidence, successorEvidence}` — `src/protocol.js:1097-1104`; heavily asserted in `test/protocol.test.js:408-633`. If it moves, re-export or preserve the callable.
- `protocol.js` decoders / `stableProtocolJson` / privacy-boundary throws (`test/protocol.test.js:222,270,438`).
- `receipt.js` bookkeeping classification outcomes (`test/receipt.test.js`).
- Standalone action outputs incl. `copilot-requested` (`test/action.test.js`, `test/operations.test.js:411-416`).

**v2 seams attach at**: the risk-context service (v2 standalone/managed planners feed alternate context) and the policy owner (managed planner is a second policy caller). Design.md data flow (`decoded input → normalized risk context → pure policy → authorized dispatch → receipt/output`) maps 1:1 to seams #3 → #2 → #4 → receipt.

### 6. Existing test coverage & gaps

Parity fixtures already present:
- `test/router.test.js` (150 lines) — `routeReview` route matrix (`:31-98`). Policy-core parity.
- `test/protocol.test.js` (640 lines) — `selectProtocolRoute` floors/local-evidence/successor + decoder privacy boundaries (`:408-633`, `:222/270/438`).
- `test/receipt.test.js` (741 lines) — bookkeeping classification (exercises `globToRegExp` path via `classifyComparison`).
- `test/operations.test.js` (661 lines) — durable route+dispatch incl. `requestReviewer`/`listPullRequestReviews` assertions (`:372,411-416`).
- `test/action.test.js` (408 lines) + `test/action-entrypoint.test.js` — standalone dispatch/output parity.
- `test/ci-parity.test.js` — CI/local gate parity (pattern precedent for a structural boundary test, not routing-specific).

**Gaps (new tests A-008 needs):**
- **AC1 — no import-boundary/dependency test exists.** Grep for boundary tests found only `privacy boundary` string assertions in `protocol.test.js` and installer entrypoint checks — nothing proves `protocol.js` / `receipt.js` do not import policy internals. Need a new dependency/import-graph test (e.g. parse import statements and assert `protocol.js` and `receipt.js` do not import the policy owner; `receipt.js` imports the path-match util, not `router.js`).
- **AC2 — no shared-service parity test.** Standalone (`routeReview`) and durable (`selectProtocolRoute`) currently exercise different policy depth; no test asserts both entrypoints route the same risk context through the same service. Need a parity fixture over the shared risk-context + dispatch services.
- No existing test locks the copilot presence-probe as a shared unit (currently only asserted indirectly through `action`/`operations`).

## Caveats / Not Found

- No literal JS import cycle exists; A-008 is a layering inversion (codec/persistence depend on policy/router-utilities). Framing it as a "cycle" would be inaccurate.
- `CONFIDENCE_LEVELS` is defined twice (router.js:3 and protocol.js:17); worth reconciling when policy consolidates, but not called out in the A-008 evidence sites.
- Standalone path currently lacks floor/local-evidence/successor policy entirely; consolidating onto one policy owner could *change* standalone behavior unless the shared service is invoked with the standalone's existing (policy-free) parameters. This is the top compatibility risk — verify against `test/action.test.js` expected routes before/after.
- Line numbers are current-tree (verified by content); audit recorded them at head 2eeca60.
