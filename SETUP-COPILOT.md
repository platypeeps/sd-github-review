# Set up GitHub Copilot code review

This guide configures `sd-github-review` to request GitHub Copilot when the
router selects the `copilot` route. Copilot is the only reviewer that the
action invokes directly.

The router automates route selection, duplicate suppression, and the reviewer
request. It does not enable Copilot for an account or organization, create a
workflow in another repository, or configure branch protection.

## Prerequisites

1. Confirm that GitHub Copilot code review is available and allowed for the
   repository. Organization or enterprise policy may control access. See
   GitHub's [Copilot code review documentation](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review).
2. Keep GitHub Actions enabled for the repository.
3. Decide whether this router or a GitHub branch ruleset owns automatic
   Copilot requests. This router requests Copilot through GitHub's review
   request API, so GitHub's **Automatically request Copilot code review** rule
   is not required. Using both mechanisms makes ownership and timing harder to
   reason about.

No model-provider secret or Copilot GitHub App installation is required. The
workflow uses the repository-provided `github.token`.

## Model and review effort

Copilot code review does not expose a selectable model. GitHub selects the
model and currently exposes review thoroughness as a separate repository-level
effort setting:

- **Low** is the default standard review.
- **Medium** uses longer analysis and a higher-reasoning model for complex or
  security-sensitive changes, with greater AI-credit and GitHub Actions usage.

The router requests `copilot-pull-request-reviewer[bot]` through GitHub's review
request API. That API does not accept an effort value, so this action cannot
choose Low or Medium per pull request or guarantee that a `copilot` route uses
Medium. GitHub documents the repository effort setting for automatic Copilot
reviews.

If a GitHub automatic-review rule owns Copilot requests, configure **Medium**
under **Settings → Copilot → Code review** when the repository uses Copilot
for sensitive, unusually large, or otherwise high-risk changes. Keep **Low**
when faster feedback and lower usage are more important. If this router owns
the requests, treat effort and model selection as GitHub-managed rather than
part of the router policy. See GitHub's
[review-effort description](https://docs.github.com/en/copilot/concepts/agents/code-review#review-effort-level)
and
[automatic-review configuration](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review#configuring-review-effort-level-for-a-repository).

## Install the event-driven workflow

1. Copy [`examples/pilot-router.yml`](examples/pilot-router.yml) into the
   consuming repository, for example as
   `.github/workflows/ai-review-router.yml`.
2. The checked-in workflow is pinned to the `v0.3.0` release commit,
   `744a9f138bba7c60272c7f9e3f8412e435e11b89`. Keep that exact pin or replace
   it with the reviewed full 40-character SHA of a later approved release. Do
   not use a floating branch or tag in production.
3. Keep these workflow permissions:

   ```yaml
   permissions:
     contents: read
     pull-requests: write
   ```

   `pull-requests: write` allows the action to request
   `copilot-pull-request-reviewer[bot]`. The action does not need contents
   write access and the example does not check out pull-request code.
4. Replace the example `sensitive-paths` with repository-specific risk
   boundaries and adjust `changed-line-threshold` if the default of 800 changed
   lines is not appropriate.
5. Add the shared manual-routing labels described in
   [`README.md`](README.md#2-configure-shared-routing-controls) if maintainers
   should be able to select a route from the pull request.
6. Keep deterministic tests and scanners ahead of the router with normal
   `needs` dependencies.

The pilot workflow deliberately records `cheap` and `deep` decisions without
running an external reviewer. Use it to validate routing and native Copilot
requests before adding another backend.

## Copilot-only routing

Automatic mode sends routine changes to `cheap`, and low-confidence changes to
`deep`. Sensitive or large changes also go to `deep` unless you set
`high-risk-route: copilot`; omitting the input no longer selects Copilot for
them. Therefore a Copilot-only installation reviews only the pull requests that
actually select `copilot`, and you must set `high-risk-route: copilot`
explicitly to route structural risk there.

To send every supported pull-request event to Copilot, set `mode: copilot` on
the action and remove the broad `issue_comment` trigger unless the workflow
also restricts comments to explicit review commands. A fixed mode has higher
precedence than command and label routing.

The shipped PR-Agent profile sets `high-risk-route: deep` explicitly, which now
matches the default rather than departing from it, so PR-Agent handles automatic
high-risk reviews while explicit Copilot selection remains available. For a
hybrid installation where high-risk changes still run Copilot, start from that
workflow and change the input to `high-risk-route: copilot`.

## Durable on-demand routing

Use [`examples/on-demand-review-router.yml`](examples/on-demand-review-router.yml)
when a trusted caller needs an exact-head receipt rather than event-local
outputs.

1. Copy the workflow to `.github/workflows/sd-review.yml`. It is pinned to the
   immutable `v0.3.0` commit; update every first-party Action reference
   together only when adopting the reviewed full SHA of a later release.
2. Keep `contents: read`, `pull-requests: write`, and `checks: write`.
   Check Run write access is used only for durable receipts.
3. Publish [`config/routed-review-setup-v1.json`](config/routed-review-setup-v1.json)
   with the workflow. Its `actionReference` is pinned to the same release SHA;
   keep the descriptor and workflow references identical when upgrading.
4. A request whose intent or automatic policy selects `copilot` uses the
   built-in native backend. If automatic policy can select `cheap` or `deep`,
   configure those external backend descriptors and adapter steps as well.

The durable router checks pending requests and non-dismissed Copilot reviews
on the exact pull-request head before creating another request.

## Optional GitHub configuration

- GitHub also supports repository or organization rulesets that automatically
  request Copilot. Use those instead of this router when every matching pull
  request should receive the same GitHub-managed review policy. See
  [Configuring automatic code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review).
- Repository custom instructions can tune Copilot's review context. They do not
  change this router's route-selection policy.
- Model and effort selection remain GitHub-managed as described in
  [Model and review effort](#model-and-review-effort); neither is an action
  input or route output.

## Verify the installation

1. Open a smoke pull request from a branch in the repository.
2. Apply `review:copilot` or post `/review copilot` as an authorized user.
3. Confirm the workflow summary reports `route=copilot`.
4. Confirm Copilot appears in the pull request's reviewer state or leaves a
   review on the current head.
5. Push another commit and confirm a new router run does not mistake a review
   of the previous head for a current-head review.

GitHub can restrict write permissions for workflows triggered from fork pull
requests. Include a fork-originated smoke pull request if outside contributors
are part of the repository's operating model; do not switch to a more
privileged trigger without a separate security review.

## Uninstall or roll back

Disable or remove the installed workflow. This stops future router requests;
it does not remove reviews that Copilot already published. Disable any
separately configured automatic-review ruleset as a distinct GitHub setting.
