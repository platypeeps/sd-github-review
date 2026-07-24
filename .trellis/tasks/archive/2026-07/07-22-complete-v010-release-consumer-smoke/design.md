# v0.1.0 Release And Consumer Smoke Design

## Overview

Treat release delivery as three explicit gates over one immutable source
candidate:

1. freeze and verify the candidate;
2. prove it in the isolated provider-free pilot and observe it for 24 hours;
3. obtain separate publication approval, publish, then pin consumer guidance.

No later bookkeeping or documentation commit changes the identity of the
released Action.

## Candidate Boundary

The candidate is a full 40-character commit SHA with a successful source CI run
for that exact SHA. Record both before pilot execution. If source behavior must
change, discard the candidate, select a new SHA, repeat source validation, and
restart the pilot observation window.

The current candidate proposal is
`8636a3983d18de17c49907a4c48170a61b1bb713`, backed by successful CI run
`30036609751`. Planning records and post-release documentation are bookkeeping;
they do not silently replace the frozen runtime candidate.

## Pilot Boundary And Data Flow

```text
green source SHA
  -> private pilot workflow pinned to that SHA
  -> standalone and durable provider-free scenarios
  -> sanitized evidence record and 24-hour observation
  -> explicit publication decision
  -> annotated tag and GitHub release at the same SHA
  -> consumer smoke and post-release immutable documentation pins
```

The existing private pilot repository is the only consumer target. It contains
no provider credentials and must not check out or execute pull-request-authored
code. Standalone cheap/deep routes remain output-only. Durable external routing
may be finalized with a deterministic synthetic acknowledgment owned by the
base workflow; it must not invoke a live provider or claim observable findings.

Public evidence is allowlisted to candidate/head SHAs, scenario IDs, route and
receipt identities, workflow URLs, pass/fail, bounded diagnostics, limitations,
and rollback state. Raw findings, source paths, prompts, private event payloads,
and provider material stay out of this repository.

## Release Boundary

Private-pilot authority and planning approval do not authorize publication.
After the observation gate passes, present the exact candidate, source CI,
sanitized pilot evidence, limitations, and rollback state for a new explicit
maintainer decision.

If approved, create one annotated `v0.1.0` tag and GitHub release at the frozen
candidate. Fail if either name already exists or points elsewhere. Never move a
published tag.

## Consumer And Documentation Boundary

The private pilot repository doubles as the bounded provider-free consumer
smoke. After release, pin its workflow to the released full SHA and prove the
same route still executes. Exercise rollback by disabling the workflow or
restoring the prior immutable pin; do not delete evidence runs.

A source commit cannot embed its own hash. Therefore the released candidate may
retain clearly marked template placeholders, while a post-release documentation
commit can publish runnable examples pinned to the released SHA. Template-only
adapter placeholders remain parameterized and must not be mistaken for runnable
provider integrations.

## Failure And Rollback

- Source change or source-CI failure: choose a new candidate and restart all
  candidate-bound pilot evidence.
- Pilot failure: disable the pilot workflow, record the bounded failure, fix in
  a reviewed source commit, and restart the observation window.
- Existing/mismatched tag or release: stop without mutation and reconcile
  manually; never force-move.
- Post-release defect: disable consumer workflows and publish a reviewed patch
  release. Do not repair `v0.1.0` in place.

## Trade-offs

- Reusing the private pilot as the first consumer minimizes external scope but
  provides only one consumer environment. Broader adoption evidence remains a
  separate task.
- A synthetic durable acknowledgment proves protocol and receipt behavior, not
  live adapter quality. Live external-provider validation remains explicitly
  out of scope.
- Post-release documentation pinning adds a bookkeeping commit but avoids an
  impossible self-referential SHA inside the release candidate.
