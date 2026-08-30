# Local Review Assurance Projection Implementation Plan

0. Resolve the awaiting-evidence assurance state before writing code — this is
   an unresolved owner decision, not a settled one. `prd.md` requirement 3 says
   `deferred`, which `decodeReviewOutcomes` would reject outright: it admits a
   `deferred` assurance only with reason `budget_exhausted_deferred`
   (`src/protocol-v2.js:829-833`). The only shipped fixture for this case uses
   `assuranceOutcome: {state: "fail", reasonCode: "awaiting_local_attestation"}`
   (`fixtures/protocol/v2/outcomes.valid.json:105-107`). The parent's
   `research/contract-mapping.md` says "action-required assurance plus a blocking
   gate", which names the Check *conclusion* and does not by itself settle the
   assurance *state*. The parent's `design.md` outcome table still says
   `deferred` and flags the conflict as open. Either narrow the PRD to
   `fail` + `action_required`, or widen the decoder to admit
   `awaiting_local_attestation` as a second sanctioned deferred reason — which
   weakens a deliberate invariant (`src/protocol-v2.js:826-828`) and needs the
   parent's sign-off. Every mapping below depends on the answer.
1. Add a pure mapper from a decoded `localReviewReceipt` / `localAttestationStatus`
   to the `{reviewOutcome, assuranceOutcome, gateOutcome}` triple and a per-Check
   `conclusion`. `decodeReviewOutcomes` (`src/protocol-v2.js:806-875`) validates
   the triple but nothing derives it, and `decodeCheckProjection`
   (`src/protocol-v2.js:1324-1345`) takes a conclusion the caller already chose.
2. Add the bounded Check content model (actor, exact head, tool/profile, time,
   result, evidence digest, trust limitation) that acceptance criterion 3 needs.
   No such fields exist today. Run `rejectForbiddenFields` at the new decode
   boundary so the "no raw findings" criterion is enforced, not merely asserted.
3. Extend the chosen CAS contract for same-head retries, new-head supersession,
   and late old-head results retained as audit-only. See `design.md` for the
   two candidate shapes; pick one rather than adding a third.
4. Add awaiting-evidence, late-result, conflicting-write, and privacy/trust
   fixtures under `fixtures/protocol/v2/`, mirroring the existing
   `check-projections.*` and `local-*.json` pairs, plus tests alongside
   `test/protocol-v2.test.js:302-370`.
5. Scope the readiness work deliberately. `decodeSetupDiscoveryV2`
   (`src/protocol-v2.js:1397-1421`) has no non-test consumer, nothing in the tree
   reads GitHub branch protection, `config/routed-review-setup-v1.json` is still
   `schemaVersion: 1` advertising only `sd-github-review/receipt`, and
   `ROUTE_MODES` (`scripts/consumer-installer/codecs.mjs:122`) has no
   `local-attested` member. Confirm how much of PRD requirement 6 lands here
   before touching the shipped v1 descriptor.
6. Append any new module to the explicit `node --check` file list in
   `package.json` `scripts.check` — `src/protocol-v2.js` is absent from it today,
   so a new v2 module is otherwise never syntax-checked.
7. Run `npm test`, `npm run check`, and `npm run validate:metadata`.
