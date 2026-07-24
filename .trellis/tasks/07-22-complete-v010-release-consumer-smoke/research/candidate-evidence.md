# v0.1.0 Candidate Evidence

## Frozen Candidate

- Candidate SHA: `8636a3983d18de17c49907a4c48170a61b1bb713`
- Source branch at selection: `main`
- Source GitHub Actions run:
  `https://github.com/platypeeps/sd-github-review/actions/runs/30036609751`
- Required job: `test` (`89306030180`), completed successfully for the exact
  candidate SHA on 2026-07-23.
- Candidate frozen and locally revalidated at `2026-07-23T19:49:23Z`.

The prior candidate `32fc23d4a59aee4e84d25d44861e7e5e7b8d6483`
completed its provider-free pilot, but PR `#15` merged afterward. Because that
merge added runtime PR-Agent support, the prior candidate and observation
window are retained only as superseded historical evidence in
`pilot-evidence.md`.

## Exact-Checkout Validation

The commands below ran from a detached worktree at the candidate SHA:

| Validation | Result |
| --- | --- |
| `npm ci` | passed; 0 vulnerabilities |
| `npm test` | passed; 115 tests, 0 failures |
| `npm run check` | passed |
| `npm run validate:metadata` | passed; action, 1 source workflow, 5 examples, and 513 tracked public paths validated |
| `python3 scripts/sd-ai-command-pack-install-audit.py` | passed; 151 targets and installed command-pack `0.32.2` provenance verified |
| `git diff --check` | passed |

Repository metadata tests also verified the versioned setup descriptor,
no-checkout durable workflow, minimal permission distinction, immutable Action
placeholder policy, and absence of floating third-party Action references.

## Release Identity Preflight

- No local or remote `v0.1.0` tag existed at candidate freeze.
- No GitHub release existed at candidate freeze.
- The private pilot and 24-hour observation gate passed.
- At `2026-07-24T22:53:41Z`, immediately before publication, source `main`
  still resolved to the candidate SHA, source Actions run `30036609751` was
  successful for that exact SHA, and no local tag, remote tag, or GitHub
  release named `v0.1.0` existed.

## Publication Approval

On 2026-07-24, after the final pilot observation evidence was complete and the
candidate identity and limitations were presented, the maintainer explicitly
approved publishing `v0.1.0`. The approved immutable commit is
`8636a3983d18de17c49907a4c48170a61b1bb713`.

## Authority Boundary

On 2026-07-23 the maintainer authorized bounded mutations in
`platypeeps/sd-github-review-pilot` and selected the recommendation to restart
the pilot against this replacement candidate. On 2026-07-24 the maintainer
separately authorized publishing `v0.1.0` at the approved candidate. Neither
authorization includes invoking a live external provider or changing the
command-pack repository.
