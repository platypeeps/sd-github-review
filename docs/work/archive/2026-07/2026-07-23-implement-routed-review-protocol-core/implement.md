# Routed-Review Protocol Core Implementation Plan

## Execution Order

1. Add fixture directories and failing decoder/canonicalization tests.
2. Implement bounded primitive/object validators and recursive forbidden-field
   rejection in `src/protocol.js`.
3. Implement stable canonical serialization, logical identity, fingerprint,
   and compatibility-value checks.
4. Implement receipt/backend/acknowledgment envelopes and canonical fixtures.
5. Add local-summary, successor-evidence, and independent-floor policy tests,
   then integrate the minimum pure router changes.
6. Run focused and full gates; update backend code-specs.

## Validation Plan

- Assert exact good/base/failure matrices for every decoder.
- Assert canonical digest equality for reordered equivalent input and
  inequality for new head/attempt/intent.
- Assert all forbidden privacy fields at root and nested positions.
- Run repository tests, syntax/metadata checks, install audit, and preflight.

## Documentation And Spec Updates

Add the executable protocol signatures, validation matrix, fixture ownership,
and wrong/correct identity examples to backend quality/error guidance.

## Review Notes

- Check every archived R1-R5, R7-R8, R12-R15, R18-R21 requirement against a
  test or an explicit later-child boundary.
- Review canonicalization changes as compatibility-sensitive public API.
- Confirm no network or Action orchestration enters this PR.

## Rollback Points

The new module is unreferenced by production Action orchestration until the
later dispatch child. It can be reverted without changing standalone routing.

## Follow-Ups

Durable receipt storage must import this module rather than reimplementing
receipt parsing, identity, or fingerprint rules.
