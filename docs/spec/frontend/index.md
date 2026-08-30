# Frontend Scope

> Explicit non-applicability contract for this backend-only GitHub Action.

## Overview

This repository has no frontend runtime. The files in this directory document
that boundary so future agents do not invent UI frameworks, components, state,
or build tooling when implementing Action features.

## Guidelines Index

| Guide | Description | Status |
| --- | --- | --- |
| [Directory Structure](./directory-structure.md) | No browser/client tree | N/A documented |
| [Component Guidelines](./component-guidelines.md) | No UI component runtime | N/A documented |
| [Hook Guidelines](./hook-guidelines.md) | No frontend hooks | N/A documented |
| [State Management](./state-management.md) | Stateless Action invocation | N/A documented |
| [Type Safety](./type-safety.md) | No frontend TypeScript layer | N/A documented |
| [Quality Guidelines](./quality-guidelines.md) | Docs/workflow presentation checks only | N/A documented |

If a future approved task adds a hosted UI, replace these files with conventions
derived from that implementation and update Trellis package/layer routing.
