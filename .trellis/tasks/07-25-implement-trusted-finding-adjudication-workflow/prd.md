# Implement Trusted Finding Adjudication Workflow

## Goal

Accept explicit human attestations through a trusted GitHub workflow, validate
actor and policy authority, and append exactly one idempotent adjudication event
for the intended finding.

## Requirements

- Support explicit single-finding and reviewed batch requests with one stable
  idempotency identity per actor/request/finding set.
- Resolve the actor from trusted GitHub event context, never request payload
  claims or checkout content.
- Verify non-bot status, repository permission, finding-publisher separation,
  exact finding identity, and configured high-risk approval floor.
- Re-read PR/finding state and configuration identity before authorization and
  immediately before persistence.
- Write through the private store contract; uncertain writes require
  reconciliation and never a second append.
- Publish a bounded result and receipt link without raw finding content.
- Keep missing adjudication non-blocking for merge; reject invalid requests
  visibly without changing operational dispositions.

## Acceptance Criteria

- [ ] Authorized maintainer, independent maintainer/CODEOWNER, insufficient
      permission, bot, finding publisher, stale head, missing finding, and
      high-risk fixtures behave deterministically.
- [ ] Replay returns the original event; conflicting replay fails before write.
- [ ] Batch validation is all-or-nothing and bounded.
- [ ] Uncertain store or GitHub mutation produces reconciliation-required state
      and no retry append.
- [ ] Untrusted PR content cannot select actors, policy, endpoints, finding
      identities, or evidence store credentials.
- [ ] The workflow performs no checkout and exposes no management credential in
      Action inputs, outputs, summaries, or receipts.

## Dependencies

- `07-25-define-finding-adjudication-contract`.
- `07-25-define-finding-adjudication-evidence-store`.

## Out of Scope

- Generating adjudication proposals, ranking reviewers, or applying code fixes.
