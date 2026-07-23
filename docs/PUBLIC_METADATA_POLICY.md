# Public Repository Metadata Policy

This is a public repository. Every tracked file—including AI-agent,
Trellis, and workspace metadata—must be safe for unrestricted publication.
Ignore rules reduce mistakes; `npm run validate:metadata` enforces the tracked
path boundary even when a file was force-added or predates an ignore rule.

## Public Project Knowledge

The following metadata is intentionally versioned and reviewable:

- `.trellis/workflow.md`, `.trellis/config.yaml`, `.trellis/scripts/`,
  `.trellis/spec/`, `.trellis/tasks/`, `.trellis/agents/`, and Trellis version
  metadata, because they define reproducible project workflow and decisions;
- `.trellis/workspace/index.md` plus each developer's `index.md` and
  `journal-N.md`, because this project treats bounded delivery records as
  public project history;
- `.agents/` shared skills and the shared adapters under `.claude/`, `.codex/`,
  `.gemini/`, `.github/`, `.opencode/`, `.gito/`, and `.prism/`; and
- `.sd-ai-command-pack/` installation, version, and provenance receipts.

Tracked workspace journals may contain task names, branch names, commit IDs,
validation outcomes, and next steps. They must not contain credentials, secret
values, raw prompts or transcripts, private source content, full environment
dumps, or machine-local absolute paths.

## Generated Distribution Metadata

Command-pack receipts and shared platform adapters are generated distribution
files, but they are still public and reviewed. Update them through the normal
installer or synchronization workflow. Do not hand-edit generated blocks such
as `sd-ai-command-pack trellis-gitignore`; project-specific ignore additions
belong outside those blocks.

## Local And Session-Only State

Never track:

- environment files other than the reviewed `.env.example`, `.env.ci`, and
  `.env.test` templates;
- Trellis developer identity, current-task pointers, runtime/cache/agent/loop
  state, worktrees, backups, plan logs, template hashes, temporary files, or
  interpreter caches;
- AI-tool caches, logs, sessions, temporary directories, local overrides,
  OpenCode state/dependencies, or Copilot session state; or
- workspace attachments, transcripts, or machine-readable session dumps.

The root `.gitignore` and `.trellis/.gitignore` are the first-line controls.
The metadata validator classifies paths from `git ls-files`, so ignore rules
cannot legitimize an already tracked local artifact.

## Existing Workspace History Decision

The current Trellis workspace indexes and journal were already public before
this policy. A bounded review found delivery evidence and no machine-local
absolute paths or credential values. They remain tracked and stay in history.

This is a forward-looking decision, not consent to rewrite Git history. Any
future proposal to remove existing records from history is a separate,
destructive operation requiring explicit maintainer approval and a coordinated
credential-rotation assessment when applicable.

## Contributor Check

Before committing metadata:

1. Assume every staged file and value will be public permanently.
2. Keep shared workflow, task, spec, adapter, and bounded journal evidence;
   keep runtime and machine state local.
3. Run `npm run validate:metadata` and inspect any rejected tracked path.
4. Change this policy and its tests deliberately when a new metadata family is
   genuinely public; do not bypass the validation gate with `git add -f`.
