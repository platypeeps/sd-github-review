---
title: Compile parallel reviewer plans
status: done
created: 2026-07-25
branch: feat/compile-parallel-reviewer-plans
---
# Compile parallel reviewer plans

## Goal

Extend v2 configuration and planning contracts for explicit bounded variable reviewer sets.

## Requirements

- Extend the v2 source/compiler with bounded variable-length cheap/deep reviewer
  slots, fixed candidate or named-chain selectors, required/overridable flags,
  timeouts, limits, and minimum successes.
- Validate unique slot IDs, same-lane references, bounds, and pairwise-disjoint
  possible candidate sets before runtime.
- Resolve all slots against one exact head and compiled digest; apply explicit
  overrides only to the named overridable slot and reject ambiguous shorthand.
- Extend candidate-options discovery to list deterministic safe candidates by
  lane and overridable slot without producing parent/child identities.
- Reject candidate/slot control labels as unsupported; broad route labels may
  select a lane but never a candidate or slot.
- Produce stable parent/child plan identities without dispatch or reservation.

## Acceptance Criteria

- [x] One-, two-, and three-plus-slot fixtures compile and plan deterministically.
- [x] Overlap, invalid threshold, wrong lane, unknown selector, duplicate slot,
      and ambiguous override fixtures fail before reservation.
- [x] Options fixtures cover zero, one, and many overridable slots, invalid
      aliases, deterministic safe suggestions, and zero plan side effects.
- [x] Reserved candidate/slot labels fail while broad lane labels retain their
      existing semantics.
- [x] Cheap and deep plans remain independent and never synthesize contextual
      defaults.
- [x] Parent/child identities change only with their documented inputs.

## Dependencies

- Budget v2 contracts and deterministic compiler children.

## Out of Scope

- Budget reservation, child dispatch, aggregation, or reporting.
