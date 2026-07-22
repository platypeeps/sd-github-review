# Hook Guidelines

## Status

Not applicable. The repository has no React or framework hooks.

GitHub event triggers under `on:` in `examples/*.yml` are workflow events, not
frontend hooks. Their supported actions and security boundaries are documented
in `DESIGN.md` and validated by `scripts/validate-action-metadata.mjs`.
