# Implementation Source Map

This task-scoped map identifies repository surfaces consulted during
implementation and verification. Task context JSONL entries point here rather
than directly at code or test paths, preserving the repository's allowed
spec/research provenance boundary.

| Surface | Purpose |
| --- | --- |
| `SETUP-PR-AGENT.md` | Document provider/model configuration and the bounded verification workflow. |
| `DESIGN.md` | Record the external adapter execution and credential boundaries. |
| `docs/RELEASE_CHECKLIST.md` | Reuse isolated pilot, exact-head, evidence, and rollback gates. |
| `examples/pr-agent-router.yml` | Install and pilot the event-driven PR-Agent adapter. |
| `examples/pr-agent-on-demand-review-router.yml` | Keep the durable on-demand adapter aligned with the event-driven execution contract. |
| `scripts/consumer-installer.mjs` | Preserve manifest ownership, conflict refusal, and secret redaction during pilot updates. |
| `test/metadata.test.js` | Verify immutable image pins, direct CLI execution, provider mappings, model preflight, and no-checkout behavior. |
| `test/consumer-installer.test.js` | Verify install, update, check, uninstall, ownership, and redaction behavior. |

The first credentialed pilot also used the upstream PR-Agent v0.39.0 CLI image
definition as an execution-contract reference: its workdir is `/app` and its
entrypoint is relative to that directory. The repository workflow therefore
invokes `docker run` directly, does not mount the repository, and leaves the
image workdir unchanged.

The event-driven and durable files intentionally remain self-contained
consumer examples. Introducing a third reusable workflow or composite action
would add another installed artifact and action-reference boundary. Instead,
the metadata test parses both examples, asserts their credential allowlists
against the complete `SUPPORTED_PROVIDERS` set, and applies the same execution
contract to each so duplicated shell cannot drift silently.
