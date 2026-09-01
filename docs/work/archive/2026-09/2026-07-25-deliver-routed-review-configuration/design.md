# Routed Review Configuration Lifecycle Design

> **Verified against the codebase 2026-08-20.** See
> `research/2026-08-20-research.md` for the evidence behind every DELIVERED,
> UNRESOLVED, and stale-citation note below. Intent is unchanged; two artifact
> decisions are now marked UNRESOLVED because the paths this document named
> collide with shipped ones.

## Boundary

The consumer edits a repository-owned v2 review source.

> **UNRESOLVED — source path.** This document originally named
> `.github/sd-review.yml`. That collides with the *installer-owned*
> `DURABLE_WORKFLOW_PATH = ".github/workflows/sd-review.yml"`
> (`scripts/consumer-installer/codecs.mjs:16`), whose bytes are overwritten
> from `examples/sd-review.yml` (`:17`) on every `update`. Two files named
> `sd-review.yml` differing only by the `workflows/` segment — one
> consumer-owned, one silently overwritten — is a foot-gun. Pick a
> non-colliding name before implementation.
>
> **UNRESOLVED — source format.** The compiler and decoder both consume a
> decoded JavaScript object (`src/routed-review-compiler.js:442`,
> `src/protocol-v2.js:595`); neither parses text. YAML parsing exists only via
> `import { parseDocument } from "yaml"` in
> `scripts/validate-action-metadata.mjs:6`, and `yaml` is a **devDependency**
> in a repository that advertises itself as dependency-free (`package.json`).
> A YAML source needs a parser on the shipped path that does not exist today.
> Either the source is JSON, or a parser is vendored, or the dependency-free
> claim narrows.

In managed mode, a credential-scoped installer step resolves the exact private
catalog and passes a bounded safe projection to the repository-owned compiler.
In standalone mode, the installer supplies setup-discovered fixed profiles and
explicit local-attestation trust-policy inputs. It writes either compiler
result through a managed pending/active lifecycle without interpreting review
policy itself.

> **UNRESOLVED — compiled-manifest home.** This document originally routed the
> compiler result "through the managed `.github/sd-github-review.json`
> lifecycle". That path is the *installer ownership manifest*
> (`scripts/consumer-installer/codecs.mjs:8`), carrying schemaVersion, managed
> file hashes, source provenance, and the managed variable block — a different
> owner, cadence, and blast radius from compiled review policy. A separate
> compiled artifact with its own pending/active pair is the likelier answer,
> but it is not decided.

## Delivery Decomposition

> **STALE — none of these three tasks exist.** They are named here and in
> `prd.md`, but `task.json` records `"children": []` and `"subtasks": []`, and
> none appear in `.trellis/tasks/` or either archive month. Create them, or
> fold their boundaries into this parent and record which was chosen — the
> work-loop inventory reads `children`, so an unmaterialized decomposition is
> invisible to it.

| Child task | Delivery boundary |
| --- | --- |
| `07-25-scaffold-routed-review-source` | Fresh explicit source without candidate/slot label controls |
| `07-25-migrate-routed-review-configuration-v2` | One-time supported legacy conversion and post-cutover rejection |
| `07-25-manage-compiled-review-configuration-promotion` | Catalog resolution, semantic diff, pending/active promotion, drift, rollback, and uninstall |

```text
human explicit-mode source + mode-specific compiler input
              |
              v
       deterministic compiler
              |
              v
       pending compiled manifest -- validate/check --> active manifest
```

## Artifact Ownership

- Human source: consumer-owned and reviewable.
- Catalog and credential bindings: private-control-plane-owned.
- Schema, normalization, and digests: sibling compiler/runtime task.
- Pending/active file promotion, migration, drift, and uninstall: this task.

The generated safe projection may contain candidate/provider/model aliases and
policy references required for dispatch. It contains no secret value and does
not turn those fields into human-maintained repository configuration.

## Lifecycle

Per-step delivery status as of 2026-08-20. "DELIVERED (v1)" means the mechanism
exists and is tested for the installer's v1 file/variable resources; the v2
configuration path extends it rather than building it.

1. Parse and preflight the source without writes. **NOT STARTED** — blocked on
   the two UNRESOLVED source decisions above.
2. Resolve the exact catalog name/version/digest through the trusted management
   boundary only for managed mode; verify fixed profiles and complete explicit
   local-attestation policies locally for standalone.
   **Standalone half: READY TO WIRE.** `decodeSourceContract`'s standalone
   branch (`src/protocol-v2.js:604-638`) and the compiler's standalone path
   (`src/routed-review-compiler.js:310-330`) are complete and tested.
   **Managed half: BLOCKED.** `compileRoutedReviewConfiguration` accepts a
   `catalog` argument (`src/routed-review-compiler.js:442`) but nothing
   resolves one, and the stated owning dependency
   `07-25-define-consumer-review-control-plane` does not exist in the task tree.
3. Compile and validate a candidate manifest in memory. **READY TO WIRE** —
   `compileRoutedReviewConfiguration` (`src/routed-review-compiler.js:442`) is
   pure and side-effect-free by construction. It is currently unreachable from
   `src/index.js` and quarantined from coverage
   (`scripts/check-coverage.mjs:38-47`).
4. Present a deterministic semantic diff. **NOT STARTED.** Today `--dry-run`
   plans file writes and remote actions (`scripts/consumer-installer/plan.mjs`),
   not chain/slot/policy changes. `stableCompiledJson`
   (`src/routed-review-compiler.js:198`) plus digests give change *detection*,
   not a readable diff.
5. Write pending state, run managed validation, then atomically mark it active.
   **DELIVERED (v1).** Lifecycle states at
   `scripts/consumer-installer/codecs.mjs:142`; pending-then-active ordering at
   `.trellis/spec/backend/consumer-installer.md:83-84`.
6. Publish the stable assurance/gate Checks on the current head and report
   branch-protection readiness. Require explicit authorization for repository-
   rule changes and retire the legacy Check only after the gate alone is
   required. **NOT STARTED.** The names exist —
   `ASSURANCE_CHECK_NAME = "sd-review / assurance"` and
   `GATE_CHECK_NAME = "sd-review / gate"` (`src/protocol-v2.js:153-154`) — with
   a projection decoder (`:1324`) and a write authorizer (`:1351`), but nothing
   creates either Check. The only Check this Action publishes is
   `sd-github-review/receipt` (`contract/routed-review-setup-v1.json:15`,
   `src/receipt.js:543`), so legacy retirement has no successor on the head yet.
7. Preserve the prior active version until promotion succeeds.
   **DELIVERED (v1).** A `pending` manifest suppresses the A-013 modification
   guard so an interrupted run converges on retry instead of refusing
   (`scripts/consumer-installer/plan.mjs:53-58`, `:101-108`).

Update uses the same lifecycle. Candidate/slot labels are outside managed state:
install, migration, update, drift handling, and uninstall never create, adopt,
change, or delete them. A pre-existing reserved label is preserved but reported
as unsupported. Uninstall removes only owned source/generated artifacts.
Rollback promotes a previously valid explicit v2 source/input pair; it does
not infer another mode or re-enable legacy parsing.

> **Label rule holds today, but by absence rather than by construction.**
> `review-candidate:*` and `review-slot:*` occur zero times outside `.trellis/`,
> and the installer's `ROUTING_LABELS` are a disjoint namespace —
> `review:cheap`, `review:deep`, `review:copilot`, `review:none`, `review:auto`
> (`scripts/consumer-installer/codecs.mjs:72-98`). No test pins the rule, so a
> future label addition could violate it silently. Add the guard test early;
> it is cheap now and retroactive later.
>
> **`overrides.labels` rejection: DELIVERED, at the compiler layer only.**
> `"overrides"` sits in the compiler's forbidden composition-lever list
> (`src/routed-review-compiler.js:61`), and the rationale names
> `overrides.labels` explicitly (`:42-43`). Nothing rejects it at the source or
> preflight layer, so today the error would surface at step 3 rather than at
> step 1 as this lifecycle implies.

Managed source always carries explicit per-lane
`budgetExhaustion.merge=block|allow`. The lifecycle diffs this policy and never
fills it at runtime; only fresh scaffolding supplies a visible `block` value.

> **The compiler half is DELIVERED.** `MERGE_POLICIES = ["block", "allow"]`
> (`src/protocol-v2.js:74`); the per-lane policy is decoded
> (`src/protocol-v2.js:577-584`) and compiled through
> (`src/routed-review-compiler.js:409`); omitting it fails compilation rather
> than defaulting (`test/routed-review-compiler.test.js:113`). What this task
> still owns is the *scaffolding* that writes a visible `block` and the
> *diffing* that shows a change to it.

## Failure Rules

All still correct as intent. None are implemented on the v2 configuration path;
the interrupted-promotion rule is implemented for v1 resources
(`scripts/consumer-installer/plan.mjs:53-58`), and mode is already never
inferred or rewritten by the compiler
(`src/routed-review-compiler.js:310`, `:371`).

- Unknown catalog or digest mismatch: no write.
- Compiler failure: no promotion.
- Drift in a managed file: report conflict; do not overwrite silently.
- Interrupted promotion: runtime continues using prior active state.
- Unavailable management credential: report setup failure without falling back
  to an unpinned catalog.
- Managed service unavailable: preserve prior active state and never compile or
  promote a standalone replacement implicitly.
- Branch-protection mismatch: retain both new Check projections, report exact
  remediation, and keep the legacy requirement until an authorized change is
  verified.
