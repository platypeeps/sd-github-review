# Local Review Assurance Projection Design

The projector is a pure outcome mapper plus the existing revisioned Check
writer. It never interprets raw local artifacts. A verified immutable receipt
is the only positive evidence source.

Awaiting local evidence is intentionally asymmetric with budget exhaustion:
assurance is deferred but the gate always blocks. There is no local-attested
equivalent of a budget-deferred merge allowance.

Check copy identifies the evidence as repository-attested. New-head
supersession and late-result rejection reuse the same latest-authorized-attempt
token and compare-and-swap contract as managed recovery.
