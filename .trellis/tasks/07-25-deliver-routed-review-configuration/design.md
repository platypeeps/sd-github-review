# Routed Review Configuration Lifecycle Design

## Boundary

The consumer edits `.github/sd-review.yml`. In managed mode, a credential-
scoped installer step resolves the exact private catalog and passes a bounded
safe projection to the repository-owned compiler. In standalone mode, the
installer supplies setup-discovered fixed profiles and explicit local-
attestation trust-policy inputs. It writes either
compiler result through the managed `.github/sd-github-review.json` lifecycle
without interpreting review policy itself.

## Delivery Decomposition

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

1. Parse and preflight the source without writes.
2. Resolve the exact catalog name/version/digest through the trusted management
   boundary only for managed mode; verify fixed profiles and complete explicit
   local-attestation policies locally for standalone.
3. Compile and validate a candidate manifest in memory.
4. Present a deterministic semantic diff.
5. Write pending state, run managed validation, then atomically mark it active.
6. Publish the stable assurance/gate Checks on the current head and report
   branch-protection readiness. Require explicit authorization for repository-
   rule changes and retire the legacy Check only after the gate alone is
   required.
7. Preserve the prior active version until promotion succeeds.

Update uses the same lifecycle. Candidate/slot labels are outside managed state:
install, migration, update, drift handling, and uninstall never create, adopt,
change, or delete them. A pre-existing reserved label is preserved but reported
as unsupported. Uninstall removes only owned source/generated artifacts.
Rollback promotes a previously valid explicit v2 source/input pair; it does
not infer another mode or re-enable legacy parsing.

Managed source always carries explicit per-lane
`budgetExhaustion.merge=block|allow`. The lifecycle diffs this policy and never
fills it at runtime; only fresh scaffolding supplies a visible `block` value.

## Failure Rules

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
