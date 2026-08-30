# Define operation-specific Action contract (A-010) — Design

## Boundary

One declarative module owns the Action's operation shapes. Runtime decoders stay
the trust boundary (they still parse and reject caller data); they read their
required/forbidden/permission expectations *from* the contract instead of
hardcoding them. Metadata validation and tests import the same module, so
`action.yml`, examples, `config/routed-review-setup-v1.json`, runtime, and docs
can no longer drift independently.

The contract governs the **Action's own operations** only. It must not model or
strip permissions an external adapter *container* legitimately holds (A-004's
PR-Agent job keeps `issues:write` for its comment channel). Container extras are
an explicit, documented allowlist in the workflow validator, never contract
inputs.

## The contract module

New module `src/operation-contract.js`. Exports a frozen structure and helpers.

Per operation, declare:
- `name` — canonical operation string.
- `needsClient` — whether a GitHub client/token is constructed.
- `requiredInputs` / `optionalInputs` / `forbiddenInputs` — `action.yml` input
  names (kebab-case) the operation must, may, and must-not receive.
- `permissions` — the Action GITHUB_TOKEN permissions the operation needs
  (`{ contents: "read", ... }`).
- `outputs` — the `action.yml` output names the operation may emit.

Authoritative operation set (verified against `src/operations.js:15`,
`:229-233`, `src/index.js`):

| operation  | needsClient | permissions                                   | entrypoint            |
|------------|-------------|-----------------------------------------------|-----------------------|
| standalone | lazy        | contents:read (+pull-requests:write w/Copilot)| `src/index.js`        |
| route      | yes         | contents:read, pull-requests:write, checks:write | `runDurableAction` |
| acknowledge| **no**      | *(none — no token/client)*                     | `runAcknowledgmentAction` |
| finalize   | yes (store) | contents:read, checks:write                   | `runDurableAction`    |
| query      | yes (store) | contents:read, checks:write                   | `runDurableAction`    |

Helpers: `operationNames` (frozen array, drives `normalizeOperation`),
`getOperationContract(name)`, `contractInputNames()` / `contractOutputNames()`
(unions used by metadata validation), `durableOperations` (names whose
entrypoint is `runDurableAction`: route, acknowledge, finalize, query).

`standalone` is the default and is modeled with `needsClient: "lazy"` — the
metadata validator treats a lazy/`yes` client as "may require github-token", so
github-token is *optional* in metadata and enforced at runtime only for
operations that construct a client eagerly.

## Data flow

```text
src/operation-contract.js
   |-- src/operations.js         normalizeOperation + runtime token/forbidden-input enforcement
   |-- scripts/validate-action-metadata.mjs   action.yml + examples + config cross-check
   |-- test/*.test.js            drift-fixture regression + acknowledge forbidden-input
   `-- DESIGN.md / README.md      permission & output prose (validated by eye + a doc-sync note)
```

## Runtime changes (`src/operations.js`, `src/index.js`, `action.yml`)

1. Replace the hardcoded `OPERATIONS` Set and the literal error string
   (`operations.js:15`, `:233`) with `operationNames` from the contract;
   `normalizeOperation` builds its error message from the contract names.
2. `github-token`: flip `action.yml:8` to `required: false`. In
   `runDurableAction`, before constructing the client for route/finalize/query
   (`operations.js:521`), assert the token is present and throw a bounded
   explicit error when absent. `acknowledge` is unaffected (it returns at
   `:517-518` before the client).
3. `acknowledge` forbidden-input enforcement: in `runAcknowledgmentAction`
   (`:257`), reject inputs carrying *another operation's* semantics
   (`review-request`, `cheap-backend`, routing inputs, etc.) with a bounded
   error. The universal envelope inputs `operation` and `github-token` are
   tolerated (acknowledge's contract lists them optional) — the shipped
   `finalize` job's acknowledge step passes `github-token: ${{ github.token }}`
   (`examples/pr-agent-on-demand-review-router.yml:171`) and MUST keep working.
   So the contract models acknowledge as required `{adapter-request,
   adapter-outcome}`, optional `{operation, github-token}`, forbidden = all
   other action.yml inputs. The reader still reads only adapter-request +
   adapter-outcome; enforcement fails closed only on forbidden inputs.

Standalone (`src/index.js`) keeps its own decode path; it only reads
`operationNames` for validation. Routing, receipt semantics, and reviewer
mapping are untouched (out of scope).

## Metadata validation (`scripts/validate-action-metadata.mjs`)

Add a contract cross-check pass to `validateMetadata`:
- Every `action.yml` input name ∈ `contractInputNames()`; every contract input ∈
  `action.yml` inputs. Symmetric for outputs, at **union granularity** — the
  per-operation `outputs`/inputs fields drive docs and the union, but the check
  asserts set-equality between action.yml and the contract union, not that each
  operation emits exactly its declared outputs (runtime `emitDurableResult` emits
  a flat superset with empty strings). An `action.yml` input or output claimed by
  no operation is itself A-010-class drift: surface it as a validation failure
  (author either maps it to the operation that truly reads/emits it or removes
  the dead field) rather than silently adding it to the contract to pass.
- No `action.yml` input is `required: true` unless **every** operation requires
  it. github-token is required by no operation's metadata (enforced at runtime),
  so a global `required: true` now fails validation — the A-010 drift catch.
- Per shipped/example workflow, **lower-bound only**: for each job that runs this
  Action (detected via a step whose `uses:` references this action, reading the
  step's `operation` input), the job's `permissions` must be a superset of the
  union of contract permissions over every operation that job runs. There is NO
  upper-bound check: a job runs multiple operations (the `finalize` job runs
  `acknowledge` + `finalize`) and holds extra permissions for comment/side-effect
  and non-Action steps — both the `review` and `finalize` jobs hold
  `issues:write`/`pull-requests:write` beyond the receipt set, which is correct
  and must pass. Jobs with no step invoking this Action (the isolated `pr-agent`
  container) are out of contract scope and unchecked, preserving A-004 with no
  fragile adapter-container allowlist. (An earlier upper-bound + allowlist design
  was rejected: it would false-reject these real jobs and depends on an
  unreliable "is this an adapter container" heuristic.)
  - Dynamic `operation`: the `review` job passes `operation: ${{ inputs.operation }}`
    (`examples/pr-agent-on-demand-review-router.yml:55`), a non-literal the static
    validator cannot bind to one operation. Rule: when the step's `operation` is a
    literal, lower-bound against that operation; when it is a `${{ }}` expression,
    lower-bound against the union over the workflow-reachable dispatch operations
    (`config.supportedOperations` = route/finalize/query → contents:read,
    pull-requests:write, checks:write), which the `review` job grants. Never skip
    the check silently.
- Reconcile `config/routed-review-setup-v1.json`: `supportedOperations` ⊆
  `durableOperations`, and `requiredPermissions` equals the union of contract
  permissions over `supportedOperations`. (Current config `[route,finalize,query]`
  → union `contents:read, pull-requests:write, checks:write` — already matches;
  the validator locks it against future drift. `acknowledge` is deliberately not
  in `supportedOperations` because the setup provisions receipt permissions it
  does not need; the validator permits a documented subset, it does not force
  every durable op into the setup list.)

## Compatibility

Preserve all current public behavior except the two deliberate, bounded new
failures, each regression-tested:
- github-token global `required: true` → `required: false` in metadata; runtime
  presence enforced for eager-client operations (net: a route/finalize/query run
  with no token now fails with a clear message instead of an opaque downstream
  client error — strictly clearer, same reachable outcome).
- `acknowledge` with an unrelated input now rejects instead of silently ignoring.

No routing/receipt/reviewer behavior changes. A-003, A-004, and the durable
permission model are invariants.

## Rollback

Reversible at the contract-module boundary. If the metadata cross-check or the
runtime token/forbidden-input assertion exposes a real incompatibility (an
example that legitimately needs a permission the contract omits, or a consumer
depending on the opaque token error), restore the prior hardcoded path while
keeping the new failing fixture, and reconcile the contract to reality before
re-enabling the check.
