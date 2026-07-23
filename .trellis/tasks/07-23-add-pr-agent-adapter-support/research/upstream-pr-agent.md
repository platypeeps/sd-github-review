# Upstream PR-Agent Evidence

Verified on 2026-07-23 before implementation:

- Repository: `The-PR-Agent/pr-agent`
- Release: `v0.39.0`, published 2026-07-05
- Source version: `0.39.0`
- License: MIT
- CLI contract: `python -m pr_agent.cli --pr_url=<url> review`
- Container: `pragent/pr-agent`
- Immutable multi-platform digest:
  `sha256:cae31b51b65b5c978a3b2a978d96e89e6a4c5bcd81cb2553fd8dad0251c3a23e`
- Platforms: Linux amd64 and arm64, with attestation manifests
- Provider-free smoke: running the digest with `--version` returned
  `pr-agent 0.39.0`

The upstream GitHub Action at source commit
`1885eb4056887b8c8a530f0a35b842bba05cb425` builds from
`pragent/pr-agent:github_action`, a floating image tag. The checked-in examples
therefore invoke the released CLI image by immutable digest instead of wrapping
the upstream Action.

Primary references:

- <https://github.com/The-PR-Agent/pr-agent/releases/tag/v0.39.0>
- <https://github.com/The-PR-Agent/pr-agent/blob/v0.39.0/pr_agent/cli.py>
- <https://github.com/The-PR-Agent/pr-agent/blob/v0.39.0/LICENSE>
- <https://hub.docker.com/r/pragent/pr-agent/tags>
