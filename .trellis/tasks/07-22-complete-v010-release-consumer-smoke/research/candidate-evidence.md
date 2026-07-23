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
- Publication remains unauthorized until the private pilot and 24-hour
  observation gate pass and the maintainer gives a separate explicit approval.

## Authority Boundary

On 2026-07-23 the maintainer authorized bounded mutations in
`platypeeps/sd-github-review-pilot` and selected the recommendation to restart
the pilot against this replacement candidate. The authority does not include
publishing `v0.1.0`, invoking a live external provider, or changing the
command-pack repository.
