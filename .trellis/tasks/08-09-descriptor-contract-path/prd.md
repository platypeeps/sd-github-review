# Move the published setup descriptor off the consumer discovery path

## Goal

Stop this repository from matching its own published artifact as though it were an installed
consumer descriptor.

## Problem

`scripts/sd-ai-command-pack-review.py:31` sets
`DEFAULT_DESCRIPTOR_PATH = Path("config/routed-review-setup-v1.json")` and probes that path for
an **installed** descriptor, returning `{"state":"absent","reason":"setup-descriptor-absent"}`
when it is missing (`:746`).

This repository publishes its own descriptor at byte-for-byte that path. The router therefore
self-matches its own published artifact as an installation, and its own pull requests fail
review as a result. This is contract item R1 from the 2026-08-08 collaboration review.

Across the 19 local `platypeeps` checkouts the descriptor exists in exactly one repository —
this one — and there as the published artifact rather than an installation. So no consumer
reads it from that path, and nothing depends on it staying there.

## Scope

Split out of `08-08-installer-durable-lane`. That task's planning review established that R1 is
independent of the installer work: it touches no installer module, no manifest schema, and no
lifecycle command. Shipping it alone fixes the defect that makes this repository's own reviews
fail, without waiting on the schema-3 migration.

Explicitly **out of scope**: the installer writing a descriptor into consumers, the durable
`sd-review.yml` lane, and manifest schema 3. Those remain in `08-08-installer-durable-lane`.

## Requirements

- Move `config/routed-review-setup-v1.json` to `contract/routed-review-setup-v1.json`.
- Update every reader in the same commit. A split state leaves `npm run validate:metadata`
  reading a file that does not exist.
- Leave the vendored command-pack probe defaults and the installer's comment on `config/`:
  those name the *installed consumer* path, which is not changing.

## Acceptance criteria

- [ ] `contract/routed-review-setup-v1.json` exists with content identical to the file it
      replaced; `config/routed-review-setup-v1.json` is gone from this repository.
- [ ] No producer reads the old path. With

      ```
      PAT='config/routed-review-setup-v1|"config", *"routed-review-setup-v1'
      ```

      `git grep -nE "$PAT" -- scripts test .trellis/spec` goes from **10 hits to exactly 4** —
      `sd-ai-command-pack-review.py:31`, `sd-ai-command-pack-review-local.py:274`, `:323`, and
      the `codecs.mjs:74` comment, all naming the installed consumer path (design category 3).

- [ ] `git grep -nE "$PAT" -- ':!.trellis/tasks'` goes from **16 hits to exactly 7** — the four
      above plus the three category-2 lines whose *displayed* path stays `config/` while their
      link target moves.

      Three properties of this pattern are load-bearing. It must match the **old path**, not the
      bare basename: the basename appears 16 times before and 16 times after, so a basename grep
      cannot distinguish a completed rename from an untouched tree. It must include the
      **split form** `path.join(root, "config", "routed-review-setup-v1.json")`, or all three
      `test/metadata.test.js` sites go unseen. And it must exclude only `.trellis/tasks`, not all
      of `.trellis`, or `consumer-installer.md:118` goes unseen.

- [ ] `git grep -n 'mkdir(path.join(root, "config")' test/metadata.test.js` returns nothing.
      This line (`:66`) creates the parent directory for `:68` and matches neither pattern above,
      so it needs its own check; missing it makes fixture creation fail on a absent parent.
- [ ] `npm run validate:metadata` passes. It reads the descriptor and fails on a missed reader.
- [ ] Running the probe against this repository no longer matches this repository's own
      published descriptor.
- [ ] `npm test` stays at 0 failures (608 passing before this change, on `main` at `053f156`).

## Notes

The probe path is owned by the vendored sd-ai-command-pack scripts, not by this repository, and
is not ours to change. The publication path is ours.
