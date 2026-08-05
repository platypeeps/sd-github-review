# Review Candidate Catalog Contract Design

## Boundary

This child defines catalog identity, immutable candidate records, and the safe
projection consumed publicly. It does not observe balances or authorize work.

A catalog version is immutable and content-addressed. Candidate aliases remain
stable within that version and bind handler/model target plus opaque policy,
credential, budget, and prompt-profile references. The public projection
removes secret values, management endpoints, raw
provider metadata, and prompt/configuration bodies while retaining dispatch-
safe policy and profile identity facts.

## Prompt-Profile Registry

The catalog contains immutable profile metadata: alias, version, digest, and
compatible handler/capabilities. The private adapter registry uses the same
identity as its key and owns the actual template or PR-Agent configuration.
External candidates bind exactly one compatible profile; compatible candidates
may reuse an entry. Native candidates use the explicit `handler-managed` mode.

There is no lane default, inheritance graph, merge order, fallback profile, or
runtime/user override. This keeps the compiled candidate tuple reproducible and
ensures explicit-candidate commands cannot silently change review behavior.

Dispatch-safe policy includes explicit token/counting units, hard input/output
and per-request cost limits, pinned pricing references, safety-margin policy,
and required finish-reason/usage evidence. Candidate quarantine is a mutable
control-plane overlay tied to an immutable candidate alias; it never mutates a
pinned catalog version.

## Change And Rollback

Catalog or profile-metadata changes create a new version/digest. Consumers
explicitly update their pin; rollback restores a prior version rather than
mutating history. Changing a profile digest invalidates qualification for every
candidate/profile tuple that references it.

`standard-v1` retains a version while referenced by any retained record and for
13 months after its last retained reference. Hold and purge use the shared
retention contract. Rollback never restarts a retention timer or resurrects a
deleted projection.
