# Design: a `declined` terminal dispatch state

## Boundary

Four layers touch the change, in dependency order:

1. `src/github.js` — the REST client must let a caller tell a response GitHub
   *sent* apart from a transport failure. Today `responseError` folds the HTTP
   status into prose, so every throw looks alike to `reviewer-dispatch.js`.
2. `src/reviewer-dispatch.js` — classifies the `requestReviewer` outcome.
3. `src/protocol.js` / `src/receipt.js` — carry and gate the new state.
4. `src/operations.js` — writes it and reports it.

## What is observable

GitHub answers a request it understood and refused with **HTTP 422**
(`Validation Failed` / a reviewer-specific message such as `Review cannot be
requested from pull request author`, or Copilot's own refusal text). A 422 is
a statement by the backend about *this pull request*: the POST reached GitHub,
was parsed, and was rejected on its merits. Retrying it without changing the
pull request cannot succeed.

Everything else stays `failed`: transport errors, timeouts, 5xx, 403/404/429.
A 403 or 404 is deterministic too but is about the token or the endpoint, not
the pull request, and an operator fixes it differently. The PRD forbids
inferring a decline from a heuristic; the HTTP status is the only signal the
API gives, so the design keys on it and nothing else. The size-limit lead from
issue #154 is not encoded anywhere.

## Contracts

### `src/github.js`

`responseError` returns an `Error` carrying two additional own properties:

```js
error.status = response.status;      // number, the HTTP status GitHub sent
error.apiMessage = message;          // string, GitHub's `message` or "<status> <statusText>"
```

Transport and timeout errors carry neither. Nothing else in the message text
changes, so every existing regex over error messages holds.

### `src/reviewer-dispatch.js`

```js
export const LANDING_DECLINED = "declined";

// returned shape when GitHub refused the reviewer request
{
  alreadyRequested, alreadyReviewed, alreadyPresent,
  requested: false,
  rerequested: false,
  landing: "declined",
  declined: { status: 422, message: "<GitHub's message>" },
}
```

Rule: `requestReviewer` throws with `status === 422` → return the shape above.
Any other throw propagates unchanged (existing `failed` path). Applies to both
the first-request path and the `forceRerequest` path; on the latter the pending
reviewer has already been removed, which is the same state a transport failure
leaves and is already routed to a human.

### `src/protocol.js`

```js
const DISPATCH_STATUSES = new Set(["requested", "already-present", "skipped", "failed", "declined"]);
```

`dispatchValue` accepts an optional `declineReason` (string, 1..512 bytes):

| status       | phase       | declineReason |
|--------------|-------------|---------------|
| `declined`   | `started`   | required      |
| `declined`   | other       | rejected      |
| not declined | any         | rejected      |

`declined` is valid only for remote routes (same rule as `failed`); `none`
still requires `skipped`.

### `src/receipt.js`

- `receiptState`: `declined` at phase `started` → `reconciliation-required`,
  age-irrelevant, exactly like `failed`. No new durable state: the gate that
  blocks on `failed` blocks on `declined` with zero consumer changes, and the
  legibility lives in `dispatch-status` plus the reason.
- `completedReceipt`: `declined` is terminal.
- `checkConclusion`: `declined` → `failure`.
- `observe`: a `declined` receipt cannot transition to observed.
- `dispatchFailed`: an already-`declined` receipt is settled; report
  reconciliation-required without rewriting.
- New writer `dispatchDeclined({ …, reason })`: same guards as `dispatchFailed`
  (only a live `started` dispatch), writes `status: "declined"`,
  `phase: "started"`, `declineReason`, `completedAt`.

### `src/operations.js`

After `requestCopilotReviewer`: `landing === LANDING_DECLINED` →
`declineDispatch(...)` (sibling of `failDispatch`) which persists via
`store.dispatchDeclined` and returns the same result shape with
`error: "reviewer request declined by GitHub (HTTP 422): <message>"`. The
`reconciliation-error` output and the job failure message therefore name the
refusal. `queryOperation` maps a `declined` receipt through the existing
phase-`started` branch, so a later run reads it as reconciliation-required
with `dispatch-status: declined`.

## Rejected alternatives

- **New durable state `declined`.** Would require every consumer switching on
  `durable-state` to learn a value before it could gate on it; an unknown
  state is exactly the shape that fails open in a coordinator that only knows
  `reconciliation-required`. Legibility is delivered through
  `dispatch-status` and `reconciliation-error` instead.
- **Classifying 403 as declined.** Permission failures are about the token,
  and fixing them does not touch the pull request. Left as `failed`.
- **Inferring from diff size.** Forbidden by the PRD; the trigger on #274 was
  never confirmed.

## Rollout / rollback

Additive protocol change: old receipts have no `declined` status and decode
unchanged. Rolling back leaves any written `declined` receipt undecodable by
the older action, which would read it as a malformed check and fail closed —
acceptable, and the same posture every protocol addition has taken.

## Validation

- `test/protocol.test.js`: `declined` requires `declineReason`; the reason is
  rejected on every other status; fixtures gain a valid declined receipt and an
  invalid declined-without-reason receipt.
- `test/receipt.test.js`: `dispatchDeclined` writes the state; `receiptState`
  reads it as reconciliation-required at age zero; `observe` refuses it.
- `test/operations.test.js`: a 422 `requestReviewer` and a transport throw
  produce receipts differing in `dispatch.status` and `reconciliation-error`;
  `dispatch-allowed` is `false` on replay; the 422 message is in the output.
- `test/github.test.js`: `status` and `apiMessage` are present on a response
  error and absent on a transport error.
- `test/reviewer-dispatch` coverage via operations: `forceRerequest` + 422.

## Adversarial review ledger

- **C-1** (medium, addressed): first draft added `declined` to
  `DURABLE_STATES`; every consumer gate would have had to learn it. Mapped to
  `reconciliation-required` instead; see "Rejected alternatives".
- **C-2** (low, addressed): `dispatchFailed` on an already-declined receipt
  would have overwritten a specific refusal with a generic failure. Guarded.
- **C-3** (low, rebutted): "422 can also mean a malformed request body we
  sent." The body is a fixed `{ reviewers: [<login>] }` built from validated
  config; a 422 on it is still GitHub refusing that reviewer for this pull
  request, and the message is recorded verbatim so the operator sees which.
