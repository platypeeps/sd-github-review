# Design — Resume installer updates interrupted before workflow replacement (A-013)

## Current guard (`scripts/consumer-installer.mjs` `assertWorkflowCanBeManaged`)

```
if (local.manifest.state === "uninstalling") throw ...            // ok
if (local.workflow === null && state !== "pending") throw missing // ok (pending tolerant)
if (local.workflow !== null &&
    sha256(local.workflow) !== local.manifest.workflow.sha256)    // <-- fires for pending too
  throw "...was modified after installation..."
```

The first missing-workflow guard already special-cases `pending` (a pending
manifest with no workflow is allowed to resume). The modification guard does
not, so a pending manifest whose on-disk workflow simply hasn't been replaced
yet is rejected.

## Fix

Scope the modification guard to non-pending (i.e. `active`) manifests, mirroring
the missing-workflow guard directly above it:

```
if (
  local.workflow !== null &&
  local.manifest.state !== "pending" &&
  sha256(local.workflow) !== local.manifest.workflow.sha256
) {
  throw new Error(
    `${WORKFLOW_PATH} was modified after installation; preserve or reconcile it manually before update`,
  );
}
```

Rationale: `state === "pending"` means a prior `install`/`update`/`adopt` was
authorized and interrupted. `installOrUpdate` step 2 rewrites the workflow to
the current template unconditionally, so whatever bytes are on disk during a
pending state are about to be replaced — the equality check protects nothing
there. For `active`, the check is untouched: operator edits to a completed
install still block a silent clobber.

## Why not a schema/staging change

The audit suggested "preserve prior hashes or stage artifacts." Recording a
prior hash would require a manifest schema addition (`decodeManifest`
validation, schema-version handling, migration) for no behavioral gain over the
state-scoped guard: the resume already rewrites the workflow deterministically
from the current template. Keeping the fix to one boolean conjunct avoids schema
churn and compatibility risk.

## Behavior matrix

| manifest.state | on-disk workflow vs recorded hash | today            | after            |
|----------------|-----------------------------------|------------------|------------------|
| active         | equal                             | proceed          | proceed          |
| active         | differ (operator edit)            | **throw**        | **throw** (same) |
| pending        | equal                             | proceed          | proceed          |
| pending        | differ (interrupted pre-replace)  | **throw (bug)**  | resume           |
| pending        | workflow missing                  | resume (already) | resume           |
| uninstalling   | any                               | throw            | throw            |

## Blast radius

- Single file changed: `scripts/consumer-installer.mjs` (one conjunct added to
  an existing `if`).
- No manifest schema change; `decodeManifest` untouched.
- No signature or exported-surface change.

## Compatibility / rollback

- Pure guard relaxation for the pending state; strictly widens what resumes,
  never what is rejected for active installs.
- Rollback = revert the single-file diff and the two added tests.
