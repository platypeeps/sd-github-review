# Make REVIEW_ROUTE_MODE an installer-managed variable — Technical Design

## Shape of the change

The installer already has exactly one seam for managed repository variables:
`CONFIG_VARIABLES` in `scripts/consumer-installer/codecs.mjs:116-120`. Every
downstream behaviour the PRD asks for is already derived from it —
`variableValues()` (`:347`) feeds both `planResources()`
(`plan.mjs:120-136`, install/update) and the `check` drift loop
(`consumer-installer.mjs:460-463`), and `uninstall` deletes from the manifest's
recorded variable block (`consumer-installer.mjs:529-531`).

So the write, the check, and the removal are one table entry:

```js
const CONFIG_VARIABLES = Object.freeze({
  PR_AGENT_MODEL_PROVIDER: "provider",
  CHEAP_REVIEW_MODEL: "cheapModel",
  DEEP_REVIEW_MODEL: "deepModel",
  REVIEW_ROUTE_MODE: "routeMode",
});
```

Everything else in this design exists because that one line is not safe on its
own. Three things break with it, and one product question has to be answered.

## Problem 1 — the decoder rejects every existing manifest

`decodeManifest` enforces **exact set equality** on the managed variable names
(`codecs.mjs:299-310`):

```js
const variableNames = Object.keys(value.resources.variables).sort();
const expectedVariableNames = Object.keys(CONFIG_VARIABLES).sort();
if (JSON.stringify(variableNames) !== JSON.stringify(expectedVariableNames)) {
  throw new Error(`${filePath}: variable ownership must contain only managed variables`);
}
```

Adding a fourth key makes every schema-3 manifest in the fleet fail to decode —
not drift, not "run update", but a hard throw on read. `check` cannot report the
migration it is supposed to report, because it cannot read the manifest that
would tell it one is needed.

**Resolution: version-gate the expected set**, exactly the way provenance and the
durable pair are already gated. Add

```js
export const MANIFEST_SCHEMA_VERSION = 4;
const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = new Set([1, 2, 3, 4]);
// Route-mode ownership became mandatory at schema 4.
const ROUTE_MODE_MIN_SCHEMA_VERSION = 4;
```

and derive the expected set per manifest:

```js
function configVariablesForSchema(schemaVersion) {
  return schemaVersion >= ROUTE_MODE_MIN_SCHEMA_VERSION
    ? CONFIG_VARIABLES
    : LEGACY_CONFIG_VARIABLES; // the three pre-schema-4 names
}
```

Both the name-set comparison and the value cross-check loop (`:305-310`) use it.
This is the pattern the spec already makes mandatory
(`.trellis/spec/backend/consumer-installer.md:340-353`): gate on the version the
requirement was introduced at, never on equality with the current constant.

The requirement matrix in `codecs.mjs:126-138` and its copy at spec `:96-107`
both gain a column.

## Problem 2 — `check`'s migration ladder gives the wrong message

`consumer-installer.mjs:434-439`:

```js
if (local.manifest.schemaVersion < 2) {
  issues.push("manifest predates provenance tracking; run update to record provenance");
} else if (local.manifest.schemaVersion < MANIFEST_SCHEMA_VERSION) {
  issues.push("manifest predates the durable review lane; run update to install the descriptor and sd-review.yml");
}
```

The second branch is written as "anything older than current", with a message
naming one specific migration. Bumping the constant silently tells a schema-3
consumer that it predates the durable review lane, which it does not — it has
both durable resources installed. The ladder must become one branch per tier:

```js
if (schemaVersion < PROVENANCE_MIN_SCHEMA_VERSION) { ...provenance... }
else if (schemaVersion < DURABLE_MIN_SCHEMA_VERSION) { ...durable lane... }
else if (schemaVersion < ROUTE_MODE_MIN_SCHEMA_VERSION) {
  issues.push("manifest predates route-mode management; run update to record REVIEW_ROUTE_MODE");
}
```

This is the same class of defect as the forbidden `=== MANIFEST_SCHEMA_VERSION`
gate — a bound written against "current" rather than against the tier it means —
and it is the reason this task is not a one-line change.

## Problem 3 — a schema-3 manifest has no `routeMode` to compare against

`check` iterates `variableValues(configuration)` and reports any name whose
observed value is `undefined` as missing. A schema-3 manifest's configuration
carries no `routeMode`, so the entry would be `REVIEW_ROUTE_MODE: undefined` and
`check` would report the variable **missing on a repository where it is set** —
a false drift report that the migration message above already covers correctly.

**Resolution:** `variableValues()` omits entries whose configuration field is
`undefined`. A pre-schema-4 manifest therefore manages three variables and
reports one migration issue, which is the truthful reading. After `update`
rewrites it to schema 4, the fourth entry appears and the ordinary
missing/drifted checks apply — which is what acceptance criterion 2 tests.

There is a second half to this, and it is easy to miss. `check` also compares
the whole configuration by string (`consumer-installer.mjs:455-458`):

```js
JSON.stringify(local.manifest.configuration) !== JSON.stringify(configuration)
```

If `check` resolved a route mode from the repository's existing variable and put
it into `configuration`, then *every* schema-3 consumer would report
`manifest configuration does not match the requested configuration` on top of
the migration issue — a second, misleading complaint about a manifest that is
simply older. So `check` resolves route mode into the compared configuration
only when the manifest is at schema 4 or above, or when the operator passed
`--route-mode` explicitly. The migration message stays the single signal for an
un-migrated consumer.

## The product question — what value does a fresh install write?

The other three managed variables have defaults (`DEFAULT_CONFIG`,
`codecs.mjs:66-70`). Route mode does not get one.

The installed lane deliberately refuses to default (`examples/pr-agent-router.yml:27-38`):

```
::error::Repository variable REVIEW_ROUTE_MODE is not set. This lane will not
guess a route, because auto can select cheap or deep and bill the configured
PR-Agent provider key...
```

That text was written after a real billing event on PR #85. An installer that
picks a route on the operator's behalf reintroduces precisely the guess the gate
exists to prevent, one layer earlier and more quietly — the lane at least fails
in the open, where the installer would succeed silently.

**Decision: `--route-mode` is required for a fresh install**, resolved through
one chain shared by `install`, `update`, and `adopt`:

1. `--route-mode VALUE` — explicit operator choice, always wins;
2. the active manifest's `configuration.routeMode` — an update retains what is
   recorded, matching the provider/model rule at spec `:123-127`;
3. the repository's existing `REVIEW_ROUTE_MODE` value, when one is set and
   valid — this is the manual-install and adopt case, and the value is adopted
   as **unowned** by the existing `planResources` rule
   (`owned = prior?.owned ?? currentValue === undefined`), so `uninstall` leaves
   it alone;
4. otherwise a hard error naming the flag and the accepted set.

An existing-but-invalid repository value is an error in step 3, not a silent
overwrite: the installer does not repair a variable it does not own.

The conflict case — `--route-mode X` against an existing unowned `Y` — needs no
new rule. `planResources` already throws
`GitHub variable REVIEW_ROUTE_MODE already exists with a different unowned
value; reconcile it manually` (`plan.mjs:128-133`), which is the same treatment
`CHEAP_REVIEW_MODEL` gets today. Route mode inherits it rather than introducing
a route-specific path.

Rejected alternatives, recorded because both are defensible and both were
considered:

- **Default to `copilot`** — the only route that reviews without billing the
  provider key. Rejected: it is a product decision about which reviewer a
  consumer gets, it is not inferable from this repository, and it makes the
  installer's silence look like a choice the operator made.
- **Default to `none`** — installs the lane in a permanently inert state. A
  consumer who ran `install` and got no reviews would have no signal at all;
  strictly worse than the loud failure being replaced.

### Purity seam

`resolveConfiguration()` is pure and has no GitHub snapshot, but step 3 needs
one. Split it: a pure `resolveRouteMode({ optionValue, manifestValue, observedValue })`
in `codecs.mjs` implements the chain and its errors, and the orchestrator — which
holds `target.snapshot.variables` — calls it and passes the result into
`resolveConfiguration` as `options.routeMode`. Codecs stays free of transport,
and the chain is unit-testable without a fake GitHub.

### Key-order trap

`check` compares configurations by string
(`consumer-installer.mjs:455-458`):

```js
JSON.stringify(local.manifest.configuration) !== JSON.stringify(configuration)
```

Both sides are produced by `validateConfiguration`'s return literal, so key
order agrees today by construction. `routeMode` must be appended as the **last**
key in that literal and nowhere else, or every schema-4 install reports a
configuration mismatch against itself.

## Drift binding between installer and workflow gate

Acceptance criterion 4 requires the two accepted sets be provably the same set.
Export the installer's set as a named constant:

```js
export const ROUTE_MODES = Object.freeze(["auto", "cheap", "deep", "copilot", "none"]);
```

and bind it in `test/consumer-installer.test.js` by reading
`examples/pr-agent-router.yml` and extracting the shell `case` pattern rather
than restating the list:

- locate `case "$REVIEW_ROUTE_MODE" in`, take the first pattern line,
  strip the trailing `)`, split on `|`;
- assert set equality with `ROUTE_MODES`;
- assert every mode also appears in the invalid-value error text at `:38`, which
  is a second literal in the same file and can drift independently of the first.

The test fails if either side changes alone. It does not fail if both change
together, which is the intended behaviour — the requirement is non-divergence,
not immutability.

The durable lane (`examples/sd-review.yml`) has no `mode` input and is out of
scope; only the event-driven template consumes this variable.

## Compatibility and rollout

| Manifest on disk | `check` before update | `update` result |
| --- | --- | --- |
| schema 1 | "predates provenance tracking" | rewritten to 4 |
| schema 2 | "predates the durable review lane" | rewritten to 4 |
| schema 3 | "predates route-mode management" | rewritten to 4; route mode resolved from the existing repository variable |
| schema 4 | ordinary drift reporting | no-op when converged |

No consumer's repository variable changes value as a result of this task unless
an operator passes `--route-mode` explicitly — with one pre-existing exception
worth stating rather than glossing: once a variable is recorded `owned: true`,
`update` corrects drift on it back to the recorded value, exactly as it already
does for `CHEAP_REVIEW_MODEL`. That is ordinary owned-resource behaviour, and it
can only apply to a variable the installer created in the first place.

A schema-3 consumer with a hand-set variable converges to schema 4 recording
that same value as unowned, so it never enters that path.

**This repository is itself such a consumer.** Its `REVIEW_ROUTE_MODE` is
hand-set; after this lands, `update` here records it unowned and `uninstall`
still refuses to delete it. Verifying that specific transition is part of the
implementation plan, not an assumption.

## Rollback

Every layer is independently revertible and nothing is destructive:

- The manifest constant bump is the only irreversible-in-practice step, and only
  for consumers that ran `update` — a schema-4 manifest does not decode against
  a reverted schema-3 decoder. Reverting the code therefore requires either
  reverting the consumer's manifest with it or accepting a re-run of `install`.
  Inside this repository that is a `git revert` plus one `update`.
- No secret, label, or workflow file is touched.
- `uninstall` behaviour for unowned variables is unchanged by construction: the
  deletion loop already filters on `resource.owned`.
