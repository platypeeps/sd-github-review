# Consumer Installer Implementation Plan

## Implementation

1. Add a testable repository-tooling module with CLI parsing, target/repository
   validation, provider/model validation, manifest decoding, hashing, and
   atomic file helpers.
2. Add an injected GitHub CLI boundary that reads repository, variable,
   secret-name, and label metadata and performs bounded mutations without
   logging secret input.
3. Implement deterministic planning and execution for install, update, check,
   dry-run, partial-failure resume, and confirmed uninstall.
4. Add the thin executable entrypoint and include both scripts in syntax
   validation.
5. Add focused `node:test` coverage using temporary repositories and a fake
   GitHub boundary; cover collision, drift, ownership, retry, secret handling,
   and uninstall behavior.
6. Update `README.md`, `SETUP-PR-AGENT.md`, and the repository-tooling directory
   spec with the supported command contract and remaining manual steps.

## Validation

```sh
npm test
npm run check
npm run validate:metadata
git diff --check
```

Run CLI help directly. Exercise a complete install/check/update/uninstall flow
against a temporary local Git repository with a fake GitHub boundary through
tests. Do not mutate a real consumer repository during automated validation.

## Risk and Rollback Points

- Keep GitHub command construction in one module boundary and inject it in
  tests.
- Never interpolate or serialize secret input.
- Write lifecycle state before external mutations and retain it on failure.
- Delete local files only after remote uninstall steps succeed.
- Do not commit, push, or open a pull request in the target repository.

## Pre-Start Review

- The user explicitly requested implementation, satisfying task creation and
  implementation approval.
- The archived no-build evaluation remains unchanged and is referenced only as
  historical context.
- Durable workflow provisioning and Copilot/ruleset administration are
  explicitly excluded from this first tool.
