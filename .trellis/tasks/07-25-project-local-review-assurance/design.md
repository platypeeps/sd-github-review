# Local Review Assurance Projection Design

The projector is a pure outcome mapper plus a revisioned Check projection
contract. It never interprets raw local artifacts. A verified immutable
`localReviewReceipt` (`src/protocol-v2.js:1258-1287`) is the only positive
evidence source; its `gateSatisfied` is already derived as
`outcomeClass === "completed_local"` (`src/protocol-v2.js:1281`).

There is no shipped Check writer to reuse. The only `createCheckRun` call site
is `src/receipt.js:543`, and it publishes the v1 durable receipt Check
`sd-github-review/receipt` (`src/receipt.js:11,133`). `sd-review / assurance`
and `sd-review / gate` (`src/protocol-v2.js:153-154`) are declared but have no
producer. This task therefore delivers the pure projection contract; the GitHub
write belongs to whichever task wires v2 into `src/index.js`, which
`protocol-v2.js` is currently unreachable from.

Awaiting local evidence is intentionally asymmetric with budget exhaustion.
Budget exhaustion is the one sanctioned case where assurance defers and the gate
stays free (`src/protocol-v2.js:826-833`). Awaiting local evidence is the
opposite: it is a non-budget failure, so assurance **fails** and the gate always
blocks — `decodeReviewOutcomes` rejects a `deferred` assurance carrying any
reason other than `budget_exhausted_deferred`, and forces a blocking gate for
every `LOCAL_BLOCKING_REVIEW_STATES` member (`src/protocol-v2.js:840-865`). The
awaiting case surfaces to the operator as an `action_required` Check conclusion,
matching the parent's contract mapping. There is no local-attested equivalent of
a budget-deferred merge allowance.

Check copy identifies the evidence as repository-attested. `independent` can
never be minted here; `decodeAttestedTrustLevel` rejects it by name
(`src/protocol-v2.js:1103-1112`).

New-head supersession and late-result rejection build on
`authorizeProjectionWrite` (`src/protocol-v2.js:1351-1381`), which already
enforces the monotonic revision and the latest-authorized-attempt token as a
compare-and-swap witness. Two divergent CAS shapes exist in the tree today —
that one, and the stateful ledger reducer `projectRecoveryCheck`
(`src/review-deferred-recovery.js:1148-1181`) whose `retainLate` path is the
only thing that currently models retaining a late old-head result as audit-only
evidence. Which shape this task extends is an open decision; adding a third is
not an option.
