# Implementation plan — publish the descriptor at `contract/`

Baseline to beat, captured before any edit: `npm test` = 608 passing / 0 failing. Record the
actual number again at step 0; do not trust this figure if other work has merged since.

One commit. A split state leaves `npm run validate:metadata` reading a file that does not exist.

## Step 1 — move the file

```bash
mkdir -p contract
git mv config/routed-review-setup-v1.json contract/routed-review-setup-v1.json
```

`config/` should then be empty of tracked files; confirm with `git status` rather than assuming.

## Step 2 — update every reader

Per design there are three categories, and conflating any two of them is the way this step goes
wrong. Start with `scripts/validate-action-metadata.mjs:26` — it fails loudest and fastest.

**Category 1 — move entirely.** `validate-action-metadata.mjs:26`; `test/metadata.test.js`
`:66`, `:68`, `:398`, `:866`; `test/operation-contract.test.js:113`; `DESIGN.md:161`, `:195`,
`:469`; `.trellis/spec/backend/consumer-installer.md:118`;
`.trellis/spec/backend/directory-structure.md:31`.

`test/metadata.test.js:66` is `mkdir(path.join(root, "config"))` and must move with `:68` — it
creates the directory `:68` writes into, so moving one without the other fails on a missing
parent. Do not skip the two sites that build temp roots (`:68`, `:866`): those roots are consumed
by `validateMetadata(root)`, this repository's own validator.

`directory-structure.md:31` needs both edits: repurpose or remove the `config/` line, and add a
`contract/` entry describing the published descriptor.

**Category 2 — link target only.** `README.md:132`, `SETUP-COPILOT.md:116`,
`SETUP-PR-AGENT.md:346`. Each becomes
``[`config/routed-review-setup-v1.json`](contract/routed-review-setup-v1.json)`` — displayed path
unchanged, link target moved. These are consumer install instructions: the displayed path is
where a consumer must place the file for `DEFAULT_DESCRIPTOR_PATH` to find it. Rewriting the
displayed text to `contract/` would document an installation nothing ever probes.

**Category 3 — do not touch.** `scripts/sd-ai-command-pack-review.py:31`,
`scripts/sd-ai-command-pack-review-local.py:274,323`, and the `codecs.mjs:74` comment. All name
the installed consumer path.

## Validation

```bash
PAT='config/routed-review-setup-v1|"config", *"routed-review-setup-v1'
git grep -nE "$PAT" -- scripts test .trellis/spec        # 10 before -> 4 after
git grep -nE "$PAT" -- ':!.trellis/tasks'                # 16 before -> 7 after
git grep -n 'mkdir(path.join(root, "config")' test/metadata.test.js   # -> nothing
npm run validate:metadata
npm test
npm run check
npm run validate:ci-parity
node scripts/sd-ai-command-pack-review-preflight.mjs
```

Run the two greps **before** editing and record the counts. A check whose before-value you never
measured cannot tell you the rename completed — and the obvious alternative, grepping the bare
basename, returns 16 both before and after, so it proves nothing at all.

Three properties of `$PAT` are load-bearing:

- it matches the **old path**, not the bare basename;
- it includes the **split form** `path.join(root, "config", "routed-review-...")`, or the three
  `test/metadata.test.js` sites go unseen;
- it excludes only `.trellis/tasks`, not all of `.trellis`, or `consumer-installer.md:118` goes
  unseen.

The `mkdir` line at `test/metadata.test.js:66` matches neither pattern, which is why it gets its
own check. It creates the parent directory `:68` writes into.

Expected residue after the change: 4 in code (design category 3) and 3 more in the docs whose
displayed path legitimately stays `config/` (category 2). Any other hit is a missed reader.

`npm run validate:metadata` is the decisive functional check — it loads the descriptor through
`setupDescriptorPath` and throws `setup descriptor is missing or invalid JSON` if the move left
a reader behind.

For the probe half of AC 4, run the local review lane against this repository and confirm it no
longer reports a self-matched descriptor. Quote the actual output.

## Rollback

`git checkout -- .` is wrong twice over: it would discard the work loop's concurrent tracked
edits under `.trellis/tasks/08-08-installer-durable-lane/`, and it restores from the **index**,
so the staged `git mv` from step 1 would survive it. Broad pathspecs like `scripts` or `test`
have the same first problem in miniature.

Name the exact files, and restore index and worktree together:

```bash
git restore --staged --worktree -- \
  contract/routed-review-setup-v1.json \
  config/routed-review-setup-v1.json \
  scripts/validate-action-metadata.mjs \
  test/metadata.test.js \
  test/operation-contract.test.js \
  README.md DESIGN.md SETUP-COPILOT.md SETUP-PR-AGENT.md \
  .trellis/spec/backend/consumer-installer.md \
  .trellis/spec/backend/directory-structure.md
rmdir contract 2>/dev/null || true
```

Verify with `git status --porcelain` that only the parent task's files remain modified.

After commit, a single revert. Nothing external changes.
