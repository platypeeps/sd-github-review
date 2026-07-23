# Public Metadata Inventory

## Current Tracked Families

- `.trellis/`: shared workflow, config, scripts, specs, active/archived tasks,
  agents, version metadata, and workspace Markdown records.
- `.agents/`, `.claude/`, `.codex/`, `.gemini/`, `.github/`, and `.opencode/`:
  shared skills, prompts, hooks, agents, workflows, and platform configuration.
- `.gito/` and `.prism/`: shared reviewer configuration.
- `.sd-ai-command-pack/`: generated installation target and version receipts.

The tracked Trellis workspace surface is limited to
`.trellis/workspace/index.md`, `.trellis/workspace/sdelmas/index.md`, and
`.trellis/workspace/sdelmas/journal-1.md`. A bounded scan found no absolute
local paths or credential values in the tracked workspace records.

## Existing Ignore Contracts

- `.trellis/.gitignore` excludes developer identity, current-task and runtime
  pointers, loop/agent state, plan logs, temporary files, backups, and Python
  caches.
- The command-pack-managed root `.gitignore` excludes Trellis runtime/cache
  state, review/build artifacts, local environment files, and local state for
  supported AI platforms while preserving shared adapters.
- The root policy does not currently name local/cache/log/tmp paths under the
  plural `.agents/` shared-skill directory.

## Decision

Retain all currently tracked workspace Markdown in the repository tip and
history as public delivery evidence. Add forward-only path validation and the
missing `.agents/` ignore rules. Do not rewrite history or remove current
records in this task.

## Validation Surface

`scripts/validate-action-metadata.mjs` already runs in CI through
`npm run validate:metadata`. Extending it to inspect `git ls-files` keeps one
metadata gate and catches prohibited paths even if an ignore rule is bypassed.
