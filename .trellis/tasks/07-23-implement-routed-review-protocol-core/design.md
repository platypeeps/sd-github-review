# Routed-Review Protocol Core Design

## Overview

Add `src/protocol.js` as the single owner of protocol-v1 decoding,
canonicalization, hashing, receipt-envelope validation, and pure policy inputs.
It imports only Node standard-library hashing and pure router helpers.

## Proposal

- Export explicit constants and decoders for request, local summary, successor
  evidence, backend descriptors, adapter acknowledgment, and receipts.
- Normalize repository owner/name casing, full lowercase Git OIDs, integers,
  enums, bounded text, sorted ID/channel arrays, and allow-listed objects.
- Serialize normalized objects through one stable key-order encoder and hash
  with SHA-256. Logical identity covers repository/PR/head/attempt; request
  fingerprint covers every dispatch-relevant field except correlation aliases
  and compatibility-derived fields.
- Add `selectProtocolRoute()` around the existing pure router precedence. It
  may adjust `auto` based only on validated local/successor evidence and then
  applies the configured independent-review floor.
- Keep canonical fixtures under `fixtures/protocol/v1/`; tests load fixtures
  and also construct focused edge cases.

## Boundaries And Non-Goals

- No network, filesystem, environment, GitHub output, or reviewer side effect.
- No JSON Schema runtime dependency; explicit dependency-light decoders remain
  consistent with this Action's standard-library-first contract.
- A caller-provided path list or bookkeeping label is never trusted successor
  evidence; later GitHub transport owns that normalization.

## Affected Files

- `src/protocol.js`
- `src/router.js` only for reusable pure floor/selection helpers when needed
- `fixtures/protocol/v1/*.json`
- `test/protocol.test.js` and focused router regressions
- backend spec updates for the protocol contract

## Data And Command Contracts

- `decodeReviewRequest(value) -> normalizedRequest`
- `deriveLogicalDispatchId(request) -> sha256 string`
- `deriveRequestFingerprint(request) -> sha256 string`
- `decodeReceipt(value) -> normalizedReceipt`
- `selectProtocolRoute({ request, routingContext, policy }) -> decision`
- Invalid input throws one field-specific `Error`; it never returns a partially
  trusted object.

## Risks And Edge Cases

- Stable serialization drift would break idempotency; fixtures assert exact
  canonical strings/digests.
- JavaScript number coercion is forbidden at the boundary; integer fields
  require exact numeric types and ranges.
- Recursive forbidden-field detection is required before allow-list projection
  so sensitive extra fields cannot be silently discarded.
- Unicode and casing normalization must be documented and tested without
  changing opaque model/backend identifiers unexpectedly.

## Validation

- `node --test test/protocol.test.js test/router.test.js`
- `npm test`
- `npm run check`
- `npm run validate:metadata`
- install audit and review preflight
