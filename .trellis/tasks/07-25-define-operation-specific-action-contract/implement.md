# Define operation-specific Action contract (A-010) — Implementation Plan

Ordered, each step ends green before the next. Review gate at step 6.

## 1. Author the contract module
- Create `src/operation-contract.js` with the frozen per-operation structure and
  helpers (`operationNames`, `getOperationContract`, `contractInputNames`,
  `contractOutputNames`, `durableOperations`) per design.md.
- Ground every input/output/permission entry in the current `action.yml` and
  `src/operations.js`/`src/index.js` reads — do not invent inputs.
- Add `test/operation-contract.test.js`: contract is frozen; every operation's
  required∪optional inputs exist in `action.yml`; helper unions are correct.
- Validate: `node --test test/operation-contract.test.js`.

## 2. Wire runtime operation set
- Replace `OPERATIONS` Set + literal error string in `src/operations.js`
  (`:15`, `:233`) with contract-derived names; `normalizeOperation` builds its
  error from `operationNames`.
- Validate: `node --test test/operations.test.js test/router.test.js`.

## 3. github-token: metadata optional, runtime-enforced
- `action.yml:8` → `required: false`.
- In `runDurableAction` before the client build (`operations.js:521`), assert
  token presence for route/finalize/query; bounded explicit error when absent.
- Add regression tests: route with no token throws the bounded error;
  acknowledge with no token still succeeds (locks `operations.test.js:228`
  no-client path).
- Validate: `node --test test/operations.test.js`.

## 4. acknowledge forbidden-input enforcement
- In `runAcknowledgmentAction` (`operations.js:257`), reject inputs carrying
  another operation's semantics with a bounded error. Contract: acknowledge
  required `{adapter-request, adapter-outcome}`, optional `{operation,
  github-token}`, forbidden = all other action.yml inputs. `github-token`/
  `operation` must NOT be rejected — the shipped `finalize` job's acknowledge
  step passes `github-token` (`examples/pr-agent-on-demand-review-router.yml:171`).
- Add regression tests: acknowledge with `review-request` populated rejects;
  acknowledge with only `github-token`+`operation`+adapter inputs (the shipped
  shape) still passes.
- Validate: `node --test test/operations.test.js`.

## 5. Metadata + config + workflow cross-check
- Extend `scripts/validate-action-metadata.mjs` `validateMetadata`:
  - action.yml ↔ contract input/output symmetry.
  - no globally-required input unless every operation requires it (github-token
    drift catch).
  - per-example/shipped-workflow permission validation, lower-bound only: for
    each job with a step invoking this Action, granted `permissions` ⊇ union of
    contract permissions over the operations that job runs. No upper-bound, no
    adapter-container allowlist; jobs not invoking this Action (`pr-agent`) are
    unchecked (preserves A-004). The real `examples/*` must pass unchanged —
    including the `review`/`finalize` jobs' extra `issues:write`. Literal
    `operation` binds one operation; a `${{ }}` expression binds the union over
    `config.supportedOperations` (never skip silently).
  - `config/routed-review-setup-v1.json`: `supportedOperations` ⊆
    `durableOperations`; `requiredPermissions` = union over `supportedOperations`.
- Add deliberately-drifted fixtures proving each check fails: (a) an extra
  action.yml input absent from the contract, (b) globally-required github-token,
  (c) a workflow job that runs `route` but omits `checks:write` (under-grant).
  Assert the real repo + real `examples/*` pass.
- Validate: `npm run validate:metadata`; `node --test` on the metadata test.

## 6. Review gate
- Run the full local gate; do not proceed to docs if any A-010 regression fixture
  or an existing exact-head/receipt/privacy guarantee fails.

## 7. Documentation reconciliation
- DESIGN.md / README.md: per-operation permission + output semantics match the
  contract; state that durable authorization to run an external adapter is the
  emitted `adapter-request` (not `run-external-reviewer`, the standalone gate),
  and that durable jobs' `issues:write` belongs to the adapter channel, not the
  receipt operations. Fix the DESIGN.md:324-325 permission prose.
- Validate: `git diff --check`; re-read changed prose against the contract table.

## Validation (full)
- `npm test`
- `npm run check`
- `npm run validate:metadata`
- `npm run check:full` (0 preflight failures)
- `git diff --check`

## Rollback gate
Do not ship if any A-010 regression fixture fails, if metadata/config/workflow
cross-check produces a false positive against the real repo, or if any existing
exact-head, privacy, ownership, no-duplicate-side-effect, or A-004 isolation
guarantee regresses. Restore the prior hardcoded path (keeping the failing
fixture) and reconcile the contract to reality before re-enabling.
