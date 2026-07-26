# Cheap Provider Cost Policy Design

## Boundary

This child owns the enforceable OpenRouter endpoint policy for one cheap-lane
candidate. The private candidate catalog stores the price, retention, region,
and parameter-support constraints and binds them to the candidate policy
digest. The repository router carries only the stable candidate alias and safe
digest evidence.

The PR-Agent adapter translates the compiled policy through the pinned
PR-Agent/LiteLLM/OpenRouter path. It does not select a different model or
candidate. OpenRouter may fail over only among endpoints that satisfy every
compiled constraint for the same model.

## Enforcement and Failure

Preflight must prove that every mandatory constraint has an enforceable runtime
mapping before reviewer dispatch. Price ceilings apply independently to input
and output units; retention, region, and request-parameter support are hard
filters. Missing mappings, ignored constraints, or an empty compliant endpoint
set fail visibly as policy exhaustion and never weaken the policy.

The adapter acknowledgment exposes the candidate and policy digests, bounded
compliance status, usage reference, and terminal policy outcome. It excludes
credentials and raw provider-routing metadata.
