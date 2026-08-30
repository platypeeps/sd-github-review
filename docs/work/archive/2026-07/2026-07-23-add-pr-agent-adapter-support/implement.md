# PR-Agent Adapter Support Implementation Plan

## Execution Order

1. Add and test strict adapter-request decoding.
2. Add the additive `acknowledge` operation, inputs, output, and outcome
   mapping.
3. Replace the standalone PR-Agent example with the pinned CLI container.
4. Add the no-checkout durable PR-Agent example and descriptor guidance.
5. Strengthen Docker-reference metadata validation.
6. Consolidate README and DESIGN documentation, including dedicated Copilot
   and PR-Agent setup guides plus current upstream maintenance, MIT license,
   and image-pinning facts.
7. Replace the OpenAI-specific workflow secret with a provider selector and a
   provider-neutral key, then map the documented single-key provider
   credentials only on the PR-Agent container step.

## Validation Plan

- Unit-test valid success/failure acknowledgment construction and rejection of
  malformed, wrong-kind, and unsupported outcomes; structurally test the
  PR-Agent backend-ID and model preflight.
- Parse both PR-Agent workflows and assert the exact container digest,
  route/dispatch conditions, permissions, no checkout, provider/model
  preflight, every conditional single-key provider mapping, and secret
  placement.
- Add a metadata-validator regression for floating and digest-pinned Docker
  references.
- Run `npm test`, `npm run check`, `npm run validate:metadata`, the command-pack
  install audit, and `git diff --check`.

## Review Gates

- No provider secret may appear in router inputs, outputs, summaries, logs,
  fixtures, or task evidence.
- No example may execute pull-request-controlled shell or checkout code.
- A failed PR-Agent step must still produce a failed acknowledgment and run
  finalization, without authorizing fallback dispatch.
- The generic external-adapter contract must remain usable by non-PR-Agent
  consumers.

## First-Review Risk Evidence

- The diff is one reviewable outcome: the new adapter acknowledgment helper,
  standalone and durable PR-Agent workflows, provider configuration, setup
  documentation, executable spec, fixtures, and tests move together. The
  second changed Trellis directory is the parent adapter-validation task and
  records this child relationship; it is not an independent feature.
- Normalization good case: a canonical adapter request plus `success` preserves
  its logical dispatch ID, backend ID, and finding channels in one canonical
  acknowledged result.
- Normalization base case: `failure`, `cancelled`, and `skipped` normalize to a
  failed acknowledgment with their bounded documented error codes.
- Normalization failure case: malformed or wrong-kind requests and unsupported
  outcomes fail before any acknowledgment output or GitHub client creation.
- Focused coverage lives in `test/operations.test.js`, `test/protocol.test.js`,
  and `test/metadata.test.js`; the full repository and metadata gates remain
  required before publication.

## Rollback

Revert the new operation and examples together. Consumers can continue using
the existing generic adapter contract; no stored receipt schema changes.

## Follow-Up

Run the private credentialed PR-Agent pilot under the parent validation task
after a test provider key is provisioned. Record only receipt IDs, workflow
URLs, finding-channel type, and pass/fail status.
