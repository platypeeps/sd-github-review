# Route High-Risk Reviews to External Reviewer Implementation Plan

## Preconditions

- Approve `prd.md` and `design.md`.
- Start the Trellis task on a dedicated branch based on `main`.
- Preserve the existing v1 request, receipt, backend, and installer manifest
  schemas.

## Execution Order

1. Add a shared escalation-route validator in `src/router.js`; use it for both
   low-confidence and high-risk action inputs.
2. Extend `routeReview` with `highRiskRoute`, defaulting the internal argument
   to `copilot`, and use it for sensitive and threshold decisions.
3. Declare `high-risk-route` in `action.yml`, then normalize and pass it through
   standalone `src/index.js`.
4. Normalize and pass the value through durable `src/operations.js`; update
   `selectProtocolRoute` so the same route controls its base decision and risk
   floor.
5. Set `high-risk-route: deep` in both PR-Agent workflows while leaving generic
   and Copilot profiles on the default.
6. Add focused router, standalone action, protocol, durable operation,
   workflow-metadata, and installer regressions.
7. Update README, architecture, and PR-Agent setup documentation; consolidate
   unconditional Copilot statements into the new generic/profile distinction.
8. Run focused tests, then the full repository quality and metadata gates.

## Focused Validation Matrix

- `high-risk-route`: default Copilot, explicit deep, explicit Copilot, invalid
  auto/cheap/none/empty values.
- Risk rules: zero sensitive files, one/many sensitive files, 799/800 changed
  lines at the default threshold.
- Precedence: explicit cheap/deep/copilot/none overrides high-risk policy;
  disabled drafts remain none; low confidence applies only below high-risk
  conditions.
- Standalone effects: deep model emitted, external flag true, Copilot API calls
  zero; Copilot route remains idempotent.
- Durable floors: local evidence and allowed bookkeeping reduction are restored
  to deep for a high-risk deep profile; an independent Copilot floor still
  strengthens deep to Copilot.
- Durable adapter: configured deep backend selected, one canonical adapter
  request emitted, sensitive paths absent from outputs and summaries.
- Workflows: only PR-Agent profiles opt into deep by default.
- Installer: install and update copy the profile; update without model flags
  preserves the existing provider and model values.

## Expected Commands

- `node --test test/router.test.js test/action.test.js`
- `node --test test/protocol.test.js test/operations.test.js`
- `node --test test/metadata.test.js test/consumer-installer.test.js`
- `npm test`
- `npm run check`
- `npm run validate:metadata`

## Review Gates

- Confirm there is one automatic high-risk target used by both risk rules and
  both execution modes.
- Confirm explicit Copilot requests remain reachable and unaffected.
- Confirm `deep` never calls the Copilot reviewer API.
- Confirm durable evidence reductions cannot bypass the configured high-risk
  floor.
- Confirm no protocol or installer manifest version changed.
- Confirm managed update behavior is documented as intentional.

## Rollback Check

Before handoff, prove a workflow can restore hybrid behavior by setting
`high-risk-route: copilot` without changing provider/model configuration or
backend descriptors.
