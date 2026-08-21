# Cheap Provider Cost Policy Design

> Revised 2026-08-20 against the tree at `40df292`. The original 2026-07-25
> draft assumed the pinned PR-Agent runtime could carry provider routing
> policy. It cannot — see
> `research/2026-08-20-research.md` §3. The boundary and evidence contracts
> below are unchanged; the enforcement mechanism and the constraint list are
> corrected to what the pinned runtime and OpenRouter actually support.

## Boundary

This child owns the enforceable OpenRouter endpoint policy for one cheap-lane
candidate. The private candidate catalog stores the constraints and binds them
to the candidate policy digest. The repository router carries only the stable
candidate alias and safe digest evidence.

Today the catalog holds only two opaque handles for this scope —
`rules.price` and `rules.data` (`src/review-candidate-catalog.js:551-560`) —
and neither the safe projection (`:862-958`) nor the compiled manifest
(`src/routed-review-compiler.js:410-420`) carries `rules` at all. Provider
policy is dropped at two independent boundaries before it could reach a
workflow. Both must be widened together, or neither.

The adapter does not select a different model or candidate. OpenRouter may fail
over only among endpoints that satisfy every compiled constraint for the same
model, consistent with `decodeFailover`'s `sameModelOnly` invariant
(`src/review-candidate-catalog.js:538-549`).

## Constraints and their runtime primitives

Each mandatory constraint must name the OpenRouter primitive that enforces it.
A constraint with no primitive is not a policy; it is a wish.

- **Price ceiling** — OpenRouter `provider.max_price`, applied independently to
  prompt and completion units. Hard filter. **Request-only: there is no
  account-level default.**
- **Zero data retention** — `provider.zdr`. Hard filter. Has an account-level
  default per model-group.
- **Data collection** — `provider.data_collection`. **A soft preference, not a
  hard filter.** It may not be described or tested as fail-closed. Only `zdr`
  gives a retention hard filter.
- **Parameter support** — `provider.require_parameters`. Hard filter; requires
  every request parameter the cheap profile uses to be supported.
- **Region** — **no OpenRouter primitive exists.** The provider object has no
  geography field. The only approximation is pinning provider slugs via
  `only`/`ignore`. `prd.md:56-57` places out of scope only "hard-coding one
  commercial provider endpoint without an approved data or reliability
  requirement", which does not by its own terms exclude a multi-slug allowlist
  carrying such a requirement. Region is therefore deferred, not designed, until
  the PRD says which of the two it meant.

## Forwarding: unresolved

PR-Agent v0.39.0 routes every completion through `_process_litellm_extra_body`,
whose allowlist is exactly `{"processing_mode", "service_tier"}`. OpenRouter
carries all routing under a single `provider` object, so `LITELLM__EXTRA_BODY`
rejects it with a `ValueError` before any model call. The allowlist is
unchanged on upstream `main`, so advancing the container pin does not help.

No configuration-only path exists from this repository to OpenRouter provider
routing. The design cannot proceed past this point until the owner chooses
among: an `api_base` shim that injects the `provider` object; a rebuilt
PR-Agent image; OpenRouter account-level configuration (which covers `zdr`,
`data_collection`, `only`, and `ignore` but **not** `max_price`); or an
upstream contribution widening the allowlist. This is a scoping decision, not
an implementation detail — see `research/2026-08-20-research.md` Open
Questions #1 and #2.

## Enforcement and Failure

Preflight must prove that every mandatory constraint has an enforceable runtime
mapping before reviewer dispatch. Missing mappings, ignored constraints, or an
empty compliant endpoint set fail visibly and never weaken the policy.

The fail-visible primitive already exists on the OpenRouter side: a hard-filter
miss returns **404**, so an unsatisfiable policy cannot silently downgrade to a
more expensive or less restrictive endpoint.

On the repository side there is no policy-exhaustion vocabulary. Preflight
ineligibility is `capability_unavailable | head_mismatch | oversized |
uncountable | unpriced | unit_mismatch | unenforceable`
(`src/review-plan-authorization.js:80-88`), and the shared outcome codes
(`src/protocol-v2.js:131-149`) carry no provider-policy state. The existing
`unenforceable` reason — reached when `candidate.enforceable !== true`
(`src/review-plan-authorization.js:499`) — already means "a mandatory
constraint has no enforceable runtime mapping" and is the preferred hook.
Minting a new code touches an enum three sibling tasks also read, so it is a
parent-level decision.

## Evidence

The adapter acknowledgment exposes the candidate and policy digests, bounded
compliance status, usage reference, and terminal policy outcome. It excludes
credentials and raw provider-routing metadata.

`buildAdapterAcknowledgment` (`src/operations.js:242-259`) carries none of
these today — it emits `status`, `acknowledgedAt`, `findingChannels`, and an
optional `errorCode`. Extending it is a prerequisite shared with the sibling
token-usage child and should not be duplicated here.
