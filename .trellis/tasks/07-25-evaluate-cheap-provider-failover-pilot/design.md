# Cheap Provider Failover Pilot Design

## Boundary

This child is a bounded operational evaluation over already qualified and
enforced behavior. It does not implement routing controls or assess finding
correctness.

Each report records configuration/runtime digests, cohorts, exclusions, and
any current window or objective. It keeps changed configurations and unknown
provenance separate and exposes limitations. Version 1 does not freeze a
mandatory sample, threshold, or observation window across reports.

## Decision Rule

Evidence may recommend keeping, narrowing, or disabling same-model routing.
The recommendation is advisory, and the report has no policy-mutation
authority. Maintainers may change the explicit policy through the normal
reviewed repository workflow even when evidence is incomplete, provided the
hard price, data, region, provenance, and security constraints still pass.

## MVP Governance Decision

No separate pilot approval, named pilot decision owner, signed decision record,
or decision expiry is required for version 1. Formal evaluation governance is
deferred until the review contracts and operational experience are stable.
