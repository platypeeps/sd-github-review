# Design — publish the setup descriptor at `contract/`

Carried over from `08-08-installer-durable-lane` design D1, which survived three rounds of
adversarial review. Restated here because this task now owns it.

Baseline: `npm test` = 608 passing / 0 failing on `main` at `053f156`.

## D1 — the new path is `contract/routed-review-setup-v1.json`

The defect is purely locational. `contract/` names what the file is — the published contract
other repositories read — and it is one new top-level directory rather than a nested path that
could later collide with an installed `config/` tree.

Rejected alternatives:

- `docs/` — implies prose, and already exists with a different purpose.
- `config/published/` — leaves the artifact under `config/`, where a future glob or a careless
  probe default would rediscover it. The whole point is to leave that subtree.

## Which references move, and which deliberately do not

Every reader moves in the same commit; a split state leaves `validate-action-metadata.mjs`
reading a file that no longer exists.

There are **three** categories, not two. Treating this as a two-way split — "readers move,
vendored probe stays" — is the trap: it silently rewrites consumer-facing install instructions
to a path the probe never reads.

### Category 1 — move entirely (this repository's published artifact)

| Site | Note |
| --- | --- |
| `scripts/validate-action-metadata.mjs:26` | `setupDescriptorPath` |
| `test/metadata.test.js:66` | `mkdir(path.join(root, "config"))` — creates the parent directory for `:68`. Moving `:68` without `:66` fails with a missing parent. |
| `test/metadata.test.js:68`, `:398`, `:866` | see below |
| `test/operation-contract.test.js:113` | |
| `DESIGN.md:161`, `:195`, `:469` | describes this repository's own artifact |
| `.trellis/spec/backend/consumer-installer.md:118` | the release-gate clause naming the descriptor whose `actionReference` `validateReleaseConsistency` reads |
| `.trellis/spec/backend/directory-structure.md:31` | repurpose the `config/` entry; add a `contract/` entry |

All three `test/metadata.test.js` descriptor sites move, including the two that build synthetic
temp roots (`:68`, `:866`). Those roots are fed to `validateMetadata(root)` — this repository's
own validator — so they model the published artifact, not an installed consumer copy. `:398`
reads the real repository root.

`consumer-installer.md:118` is easy to miss twice over: it is prose inside a spec rather than
code, and the natural acceptance grep (`-- ':!.trellis'`) excludes the whole directory. Exclude
only `.trellis/tasks` when verifying.

### Category 2 — dual: the link target moves, the displayed path does not

| Site | Text |
| --- | --- |
| `README.md:132` | "…publish [`config/routed-review-setup-v1.json`](config/routed-review-setup-v1.json) so clients can perform read-only setup discovery" |
| `SETUP-COPILOT.md:116` | "Publish [`config/…`](config/…) with the workflow" |
| `SETUP-PR-AGENT.md:346` | "Publish [`config/…`](config/…) with the workflow" |

These are **consumer install instructions**. The displayed path is where a consumer must place
the descriptor so `DEFAULT_DESCRIPTOR_PATH` finds it (`sd-ai-command-pack-review.py:31`); the
link target is this repository's copy — the file being copied — which is what moves.

So each becomes ``[`config/routed-review-setup-v1.json`](contract/routed-review-setup-v1.json)``:
display the destination, link the source. A mechanical find-and-replace across these three lines
would instruct every consumer to install at `contract/`, where nothing ever probes — the R1
defect inverted, and strictly worse than the defect being fixed, because R1 breaks only this
repository while this would break every consumer that follows the guide.

### Category 3 — stays entirely

| Site | Why |
| --- | --- |
| `scripts/sd-ai-command-pack-review.py:31` | vendored probe default; names the *installed consumer* path |
| `scripts/sd-ai-command-pack-review-local.py:274`, `:323` | same, for the local review lane |
| `scripts/consumer-installer/codecs.mjs:74` | a comment distinguishing two schemas; still accurate |

Renaming any category-3 site would point the probe at a path no consumer has.

## Blast radius

One file moves. Seven files update references entirely (category 1) and three update only a
link target (category 2). No runtime module changes behavior — the validator reads a different
path and everything downstream of it is unchanged.

`.trellis/spec/backend/directory-structure.md` is the only spec whose *structure* claim changes:
it currently declares `config/  # published versioned setup capability descriptor` and has no
`contract/` entry.

`git ls-files 'config/**'` returns only the descriptor, so nothing else depends on the top-level
`config/` directory existing after the move.

## Rollout and rollback

Rollback before merge is `git restore --staged --worktree` over an exact file list; see
implement.md "Rollback" for the command. Two things rule out the obvious `git checkout -- .`:
the work loop carries concurrent tracked edits in
`.trellis/tasks/08-08-installer-durable-lane/` that a whole-tree checkout would discard, and
`git checkout --` restores from the index, so the staged `git mv` would survive it. Verified in
a scratch repository: the staged rename is undone, the descriptor returns to `config/`, and an
unrelated concurrent edit is preserved.

After merge the only lossy edit is the move itself: a consumer that had fetched this
repository's published descriptor from the old raw URL would 404. No such consumer exists — the
survey found the file installed in zero repositories — and the whole point of R1 is that nothing
should be reading it from that path.

Nothing about the installed-consumer contract changes, so no consumer repository is affected in
either direction.
