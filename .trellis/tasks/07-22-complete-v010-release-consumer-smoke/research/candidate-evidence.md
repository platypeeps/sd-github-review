# v0.1.0 Candidate Evidence

## Frozen Candidate

- Candidate SHA: `32fc23d4a59aee4e84d25d44861e7e5e7b8d6483`
- Source branch at selection: `main`
- Source GitHub Actions run:
  `https://github.com/platypeeps/sd-github-review/actions/runs/30013641301`
- Required job: `test` (`89227860436`), completed successfully for the exact
  candidate SHA on 2026-07-23.
- Candidate frozen and locally revalidated at `2026-07-23T16:30:31Z`.

## Exact-Checkout Validation

The commands below ran from a detached worktree at the candidate SHA:

| Validation | Result |
| --- | --- |
| `npm ci` | passed; 0 vulnerabilities |
| `npm test` | passed; 109 tests, 0 failures |
| `npm run check` | passed |
| `npm run validate:metadata` | passed; action, 1 source workflow, 4 examples, and 503 tracked public paths validated |
| `python3 scripts/sd-ai-command-pack-install-audit.py` | passed; 151 targets and installed provenance verified |
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
`platypeeps/sd-github-review-pilot` to exercise this candidate. The authority
does not include publishing `v0.1.0`, invoking a live external provider, or
changing the command-pack repository.
