# Design: retire the direct-request hook in descriptor-carrying repositories

## Boundary

The change lives entirely in one string: the `command` of the `PostToolUse` /
`Bash` hook in `~/.claude/settings.json`. Nothing in this repository's source
changes. This repository contributes the marker being tested
(`config/routed-review-setup-v1.json`, already present), the spec record, and
the verification evidence.

## Marker: why descriptor presence, and what it actually means

The marker is the existence of `config/routed-review-setup-v1.json` at the git
top level of the pushed repository.

That path is not incidental. It is the pack's `DEFAULT_DESCRIPTOR_PATH`
(`~/.agents/bin/sd-ai-command-pack-review.py:31`) and the installer's
`DESCRIPTOR_PATH` (`scripts/consumer-installer/codecs.mjs:23`), so every
consumer the installer sets up carries it at the same path.

More usefully, it discriminates on exactly the right axis. Enumerated across the
73 git repositories two levels deep under `~/repos` — the layout every checkout
here uses — exactly one carries it, this one. That enumeration does not prove
the marker is unique on the whole machine, only across the tree the hook will
realistically fire in. The nearest miss is
instructive: `platypeeps/sd-github-review-pilot` is an active installed consumer
(`.github/sd-github-review.json`, `state: active`) but `schemaVersion: 1` with
no `descriptor` or `durableWorkflow` key at all — both absent from the object,
not present and null — where this repository is `schemaVersion: 3` with both.
So:

> descriptor present == a durable, receipt-producing lane is installed here

which is precisely the condition under which the hook's direct request is
redundant. An event-lane-only install has no receipt competing with the hook and
keeps it, correctly. The scoping also self-maintains: a repository that later
takes a durable install drops the hook with no further settings edit.

Rejected alternatives:

- **Manifest presence (`.github/sd-github-review.json`)** — true for the pilot,
  which still needs the hook. Wrong axis.
- **A hard-coded repository list** — the PRD forbids it, and it does not
  self-maintain.
- **Reading `remoteIntegration.descriptorPath` from
  `.sd-ai-command-pack/review.json`** — that override exists, but no repository
  here sets the file at all, so honouring it costs a `jq` parse per push to
  handle a case with zero instances. If an override ever appears, the hook
  fails open (keeps firing), which is the safe direction.

## Placement inside the command

The existing command is a sequence of cheap guards, each `exit 0` on no-match,
ending in the `printf` that emits `hookSpecificOutput`:

1. command text looks like `git push`
2. not `--delete` / `--dry-run` / `-d`
3. tool response shows a push actually reached a remote

The descriptor check goes in as guard 4, after the existing three and before the
`printf`. Ordering matters for cost, not correctness: guards 1–3 are string
matches on data already in hand, while guard 4 shells out to `git`. Putting it
last means the `git` call happens only on real pushes.

## Resolving the repository

The hook receives its payload on stdin, already captured as `$payload`. Three
candidate sources for the directory, in order:

1. `$CLAUDE_PROJECT_DIR` — set by Claude Code for hook commands
2. `.cwd` from the payload
3. `$PWD`

Neither source has precedent in this settings file: it currently contains zero
uses of `CLAUDE_PROJECT_DIR` and zero of `.cwd`. Both are therefore **assumed,
not established**, and the implementation verifies which are populated against a
real payload before the edit is trusted (see `implement.md` step 1). The fallback
chain means the hook works if any one of them resolves.

The directory is then normalized through `git -C "$dir" rev-parse --show-toplevel`
so the check works from a subdirectory, and correctly resolves a git worktree to
its own root (where the checked-out descriptor lives).

Failure to resolve a git root is treated as "not a descriptor repository" — the
hook fires. Fail-open is the right direction here: the cost of a spurious fire is
a redundant reviewer request, and the cost of a spurious skip is a PR with no
remote review at all in a repository that has no lane to fall back on. Sixteen
repositories have commits by this author in the last sixty days and carry no
descriptor — including `sd-ai-command-pack`, `se-ai-command-pack`, `loadsmith`,
`hoa-manager`, and `rwbp-coordinator`. Not every one of them necessarily relies
on the hook in practice; what matters is that none of them has a durable lane,
so a spurious skip removes a channel with nothing behind it.

## Shell form

Written as an explicit `if`/`fi` rather than `[ -f … ] && exit 0`. The `&&` form
leaves a non-zero status when the test fails, which is harmless under the
current invocation but becomes a silent early exit if the hook is ever run under
`errexit`. The `if` form has no such coupling.

```bash
# 4. ...and the repository must not carry a durable routed-review lane. Where a
#    receipt-producing lane is installed, the routed Action and the repository
#    ruleset already request the reviewer, and a third direct request
#    contradicts sd-review/SKILL.md.
dir=${CLAUDE_PROJECT_DIR:-$(printf '%s' "$payload" | jq -r '.cwd // ""')}
[ -n "$dir" ] || dir=$PWD
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$root" ] && [ -f "$root/config/routed-review-setup-v1.json" ]; then
  exit 0
fi
```

`jq` is already a hard dependency of this hook (guards 1–3 use it), so guard 4
adds no new tooling.

## Behaviour in a descriptor repository

Silent `exit 0`, emitting nothing. Chosen over emitting a replacement notice
pointing at the routed lane, because the routed Action and the retained ruleset
both already act without prompting, so a notice would be a push-time reminder to
do something already in motion. The PRD's "the losing contract no longer fires"
reads most cleanly as silence. Note that empty-stdout `exit 0` is the same
no-op path the existing guards already take, so this introduces no new hook
semantics.

## What this design does not fix

The receipt still cannot prove *whose* review it is reporting. The retained
ruleset requests Copilot seconds after PR open, and the coordinator attributes
review findings by author and head commit with no branch on
`dispatch.status: "already-present"`
(`~/.agents/bin/sd-ai-command-pack-review.py:1604-1616`). That is the sibling
task `08-16-bind-copilot-review-evidence`. Removing the hook narrows the field
from three requesters to two; it does not make the remaining attribution honest,
and this task must not claim that it does.

## Rollback

`~/.claude/settings.json` is backed up byte-for-byte before the edit. Rollback
is restoring the backup — a single file copy, no state to unwind. The hook is
stateless: it reads a payload and prints or does not print.
