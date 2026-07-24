# Adoption-Driven Setup Automation Evaluation Design

## Overview

Close this evaluation with a documented no-build decision. The evidence does
not meet the task's three-consumer threshold, so adding a setup command would
create an unearned maintenance and permission surface.

## Proposal

- Keep `README.md`, `SETUP-COPILOT.md`, and `SETUP-PR-AGENT.md` as the supported
  manual installation paths.
- Record the bounded adoption evidence and distinguish the source repository
  from an independent consumer.
- Introduce no executable, workflow, permission, secret, or configuration
  surface.
- Reopen the decision only after three independent consumers report the same
  repeatable setup friction class.

## Boundaries And Non-Goals

- No setup CLI, GitHub App, workflow generator, secret management, or
  repository mutation helper.
- No inference from source examples to consumer adoption.
- No collection of private workflow payloads, provider credentials, or raw
  consumer code.
- No claim that manual setup is friction-free; only that repeated evidence is
  currently insufficient to justify automation.

## Affected Files

- this task's `prd.md`, `design.md`, and `implement.md`
- `research/adoption-evidence.md`
- task metadata managed by Trellis start/finish

## Data And Command Contracts

The evaluation records only repository names, the immutable Action reference
searched, bounded result counts, evidence limitations, and the decision. It
defines no runtime command or data contract.

## Risks And Edge Cases

- Source examples can inflate apparent adoption; count repositories, not
  reference occurrences.
- GitHub code search is bounded evidence, not proof that no external consumer
  exists. The decision is therefore "not enough evidence to automate," not
  "no users exist."
- A single pilot may expose one-off friction that should be fixed in docs but
  does not establish a reusable automation requirement.

## Validation

- Verify the evidence record matches the bounded GitHub search result.
- Validate Trellis task metadata and public-metadata policy.
- Run repository syntax, test, metadata, install-audit, and whitespace gates.

