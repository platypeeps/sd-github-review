# Backend Implementation Contracts

> Executable conventions and boundaries for the GitHub Action runtime.

---

## Overview

This directory contains the implementation contracts for the JavaScript
GitHub Action runtime and repository tooling.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Current |
| [Database Guidelines](./database-guidelines.md) | Stateless boundary; persistence is out of scope | N/A documented |
| [Error Handling](./error-handling.md) | Input, API, and workflow failure contracts | Current |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, tests, and Action safety | Current |
| [Logging Guidelines](./logging-guidelines.md) | Console, outputs, summaries, and secret safety | Current |
| [Consumer Installer](./consumer-installer.md) | Install, update, adopt, check, and uninstall contract for the event-driven PR-Agent workflow, the durable sd-review.yml lane, and the setup descriptor | Current |

---

## Sources of Truth

These contracts are derived from `src/`, `test/`, `action.yml`, `DESIGN.md`,
and the checked-in workflows/examples. Update a guideline in the same task when
one of those implementation boundaries changes.

---

**Language**: All documentation should be written in **English**.
