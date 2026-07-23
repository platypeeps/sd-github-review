# Routed-Review Runtime Scope Split

The archived contract has 23 requirements and combines four distinct owners:
pure protocol policy, GitHub durable transport, Action dispatch orchestration,
and private/external integration evidence. The current Action runtime is only
three small JavaScript modules, so landing all four boundaries together would
make failures and rollback inseparable.

The selected split follows the archived design's existing module boundaries:
protocol, GitHub transport, Action orchestration, and consumer-owned adapters.
It adds a separate pilot task because that work depends on private repository
state and an immutable command-pack handoff, neither of which should block the
repo-local implementation sequence.
