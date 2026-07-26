# Cheap Review Reasoning Effort Design

## Boundary

This child defines a provider-neutral cheap-lane reasoning policy only for
candidate/runtime tuples with proven support. The private candidate catalog
records capability state, the bounded reasoning policy, and its digest. The
repository router carries only the stable candidate alias and safe policy
identity; it never forwards provider-specific reasoning parameters.

Capability is three-state: proven, unsupported, or unknown. Unsupported and
unknown candidates omit reasoning controls. Malformed policy or a claimed
control without a proven adapter mapping fails before reviewer dispatch.

## Runtime Evidence

The PR-Agent adapter resolves the candidate-bound mapping through the pinned
runtime and applies the lowest reviewed effective level by default. A higher
level requires explicit catalog policy. If the provider reports an actual
reasoning mode, the acknowledgment compares it with the configured mode; an
ignored or contradictory setting is not treated as enforced.

The current non-thinking Qwen candidate remains unchanged unless qualification
proves a supported effective control. GitHub Copilot review effort remains a
separate repository-level concern.
