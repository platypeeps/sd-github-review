# Local-Attested Review Contract Mapping

## Accepted Decisions

- `local-attested` is an explicit standalone route execution kind, not a third
  control-plane mode, an outage fallback, or an alias for `review:none`.
- The MVP supports direct-handler and local-attested standalone routes. Managed
  parallel local-attested slots remain out of scope.
- The local `sd-review` lifecycle performs the review. GitHub only ingests a
  bounded exact-head attestation and projects receipts/Checks; it dispatches no
  reviewer, provider, review, or comment.
- Trust comes from the authenticated GitHub publisher plus explicit repository
  actor/association, PR-author, and age policy. It proves authorized
  publication, not independent or cryptographically verified model execution.
- Only authorized, timely, exact-head `clean` evidence satisfies assurance and
  passes the gate. Findings and terminal errors block; missing/new-head evidence
  is action-required assurance plus a blocking gate.
- Attempt evidence is immutable and idempotent. Changed heads require new local
  review evidence; conflicting replay and ambiguous mutations fail closed.
- GitHub retains bounded identities, counts, timestamps, and digests, never raw
  paths, source, prompts, findings, transcripts, credentials, configuration
  values, or local artifact references.

## Ownership

| Boundary | Owner |
| --- | --- |
| Source/attestation/receipt/outcome schemas | `07-25-define-local-review-attestation-contracts` |
| Authenticated ingestion, trust policy, exact-head validation, idempotency | `07-25-ingest-local-review-attestations` |
| Stable assurance/gate projection and head supersession | `07-25-project-local-review-assurance` |
| Local review evidence production/publication | `platypeeps/sd-ai-command-pack:07-25-publish-local-review-attestations` |

## Authoritative Workspace Anchors

- `.trellis/tasks/07-25-support-local-attested-reviews/prd.md`
- `.trellis/tasks/07-25-support-local-attested-reviews/design.md`
- `.trellis/tasks/07-25-budget-aware-review-degradation/design.md`
- `.trellis/tasks/07-25-support-standalone-review-mode/design.md`
- `.trellis/tasks/07-25-finalize-budget-review-evidence/design.md`
