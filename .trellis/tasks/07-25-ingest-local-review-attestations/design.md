# Local Review Attestation Ingestion Design

The ingestion operation decodes untrusted bounded evidence, derives GitHub
authority, loads the exact compiled route/policy, verifies the live PR head,
and then creates or reads the immutable attempt receipt.

Validation order is deliberate: shape/privacy bounds, canonical identity,
route execution kind, actor/association/PR-author policy, evidence age, live
head, and idempotency fingerprint. No branch reaches reviewer dispatch.

An ambiguous receipt mutation returns reconciliation required. Absence after an
ambiguous write never authorizes retry under a new identity. Check projection
is a separate child operation consuming the verified receipt.
