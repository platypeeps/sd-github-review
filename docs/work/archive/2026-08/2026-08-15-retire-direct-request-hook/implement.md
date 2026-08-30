# Implement: retire the direct-request hook in descriptor-carrying repositories

All synthetic payloads and probe output go to the session scratchpad. Export it
once and use `$SCRATCH` throughout:

```bash
export SCRATCH=/private/tmp/claude-501/-Users-sven-repos-platypeeps-sd-github-review/141be603-1f4a-4c6e-9794-afff7ff155da/scratchpad
```

That path is session-specific. A later session running this plan substitutes its
own scratchpad directory.

## Step 0 — Back up the settings file

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-08-15-retire-direct-request-hook
python3 -c "import json;json.load(open('$HOME/.claude/settings.json'));print('parses')"
```

Gate: the backup exists and the original parses. Do not edit before this.

## Step 1 — Establish which directory source is actually populated

`design.md` assumes `$CLAUDE_PROJECT_DIR` or payload `.cwd` is available to a
hook command. Neither has precedent in this settings file. Verify before relying
on either.

Add a temporary probe as a *second* hook entry under the same `PostToolUse` /
`Bash` matcher — leaving the existing hook untouched — that writes what it sees
and exits 0:

```bash
payload=$(cat)
{
  printf 'CLAUDE_PROJECT_DIR=[%s]\n' "${CLAUDE_PROJECT_DIR:-}"
  printf 'payload.cwd=[%s]\n' "$(printf '%s' "$payload" | jq -r '.cwd // ""')"
  printf 'PWD=[%s]\n' "$PWD"
} >> "$SCRATCH/hook-probe.txt"
```

The probe must hard-code the scratchpad path rather than read `$SCRATCH`, since
the hook runs in its own shell and does not inherit this session's exports.

Trigger it with any `Bash` tool call, read the file, then **remove the probe
entry**. Removing it is not optional housekeeping: step 3 extracts the live
command by index (`hooks.PostToolUse[0].hooks[0].command`), and a probe left in
place would shift what that index selects.

Gate: at least one of the three resolves to a path inside a git repository.
Record which ones did in the journal — the fallback chain ships regardless, but
an unpopulated `CLAUDE_PROJECT_DIR` changes what the chain is actually relying
on, and a later reader deserves to know.

## Step 2 — Apply the guard

Edit the `PostToolUse` / `Bash` hook `command` in `~/.claude/settings.json`,
inserting guard 4 from `design.md` after the existing guard 3 and before the
`printf`. Change nothing else — not the matcher, not guards 1–3, not the
`additionalContext` text.

```bash
python3 -c "import json;json.load(open('$HOME/.claude/settings.json'));print('parses')"
diff <(python3 -m json.tool ~/.claude/settings.json.bak-08-15-retire-direct-request-hook) \
     <(python3 -m json.tool ~/.claude/settings.json)
```

Gate: the file parses, and the diff touches exactly one string value.

Show the diff to the operator before proceeding. This file is outside the
repository and governs every session on this machine.

## Step 3 — Verify against synthetic payloads

Extract the live command string and run it directly, so the test exercises the
shipped text rather than a copy:

```bash
python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.claude/settings.json')))
entries=d['hooks']['PostToolUse']
assert len(entries)==1 and len(entries[0]['hooks'])==1, 'probe not removed'
print(entries[0]['hooks'][0]['command'])
" > "$SCRATCH/hook-cmd.sh"
```

The assertion is the guard against step 1's probe still being installed.

Build one payload per case with `jq -n`, using a `tool_input.command` of
`git push origin HEAD` and a `tool_response.stdout` containing `To github.com:…`
so guards 1–3 all pass. Vary only `.cwd`.

| # | `.cwd` | Expect |
|---|--------|--------|
| 1 | `~/repos/platypeeps/sd-github-review` | **empty stdout**, exit 0 |
| 2 | `~/repos/platypeeps/sd-ai-command-pack` | the `hookSpecificOutput` JSON, exit 0 |
| 3 | `~/repos/platypeeps/sd-github-review-pilot` | the `hookSpecificOutput` JSON, exit 0 |
| 4 | `/tmp` (no git repo) | the `hookSpecificOutput` JSON, exit 0 |
| 5 | case 1, but `tool_input.command` = `echo git push` and no push-shaped response | **empty stdout**, exit 0 |

Run each as `bash $SCRATCH/hook-cmd.sh < payload-N.json; echo "exit=$?"`.

Cases 2 and 3 are the ones that matter most. They stand in for the sixteen
descriptor-free repositories with recent commits, where a false skip silently
removes a channel with nothing behind it. Case 3 specifically proves the marker
discriminates durable installs from event-lane installs rather than "installed
at all". Case 5 is a regression guard confirming guards 1–3 still short-circuit.

If step 1 found `CLAUDE_PROJECT_DIR` populated, repeat cases 1 and 2 with it set
in the environment and `.cwd` absent, since that is the branch the chain will
actually take in a real session.

Gate: all five rows match. Any mismatch stops the task — restore the backup.

## Step 4 — Verify against a real push

Open a pull request from this repository (the branch carrying this task's spec
and artifact commits is fine — the PRD requires verification on a PR opened
*after* the hook change, which this is).

Confirm, and capture as evidence:

- no `hookSpecificOutput` naming a direct Copilot request appears in the
  transcript after the push;
- no `requested_reviewers` call is made by the agent;
- `gh api repos/platypeeps/sd-github-review/pulls/<N>/timeline` shows reviewer
  requests attributable only to the routed Action or the ruleset;
- the routed review reaches a terminal state (now possible — the receipt-cache
  wedge is fixed and pinned at pack 0.71.22).

Then run the same push in a descriptor-free repository if one is conveniently at
hand, confirming the hook still fires there. If none is, say so rather than
implying it was checked — cases 2–4 already cover the logic, and this would only
be corroboration.

## Step 5 — Record

Update `.trellis/spec/backend/consumer-installer.md`:

- amend "Three channels can request Copilot, not two" to state that the hook is
  now scoped out of durable-lane repositories, leaving the Action and the
  ruleset;
- record what the marker means (durable receipt-producing install, not merely
  installed) and the pilot-repository evidence that distinguishes the two;
- state plainly that the receipt still cannot prove which of the two remaining
  channels produced a given review, and point at
  `08-16-bind-copilot-review-evidence`.

Commit the spec change and the task artifacts. The settings edit itself is not
committable — it lives outside the repository — so the spec record and this
task's artifacts are the only durable trace, which is a reason to make them
precise rather than brief.

## Rollback

```bash
cp ~/.claude/settings.json.bak-08-15-retire-direct-request-hook ~/.claude/settings.json
```

Stateless. No other unwind needed.

## Review gates

- After step 2: operator sees the settings diff before any verification runs.
- After step 3: all five synthetic cases pass, or the task stops.
- After step 4: real-push evidence is recorded honestly, including anything that
  could not be checked.
