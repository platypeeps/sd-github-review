# Routed Review Source Scaffolding Design

## Boundary

The parent configuration-lifecycle design is authoritative. This child owns
only creation of a fresh, complete human source and explicitly opted-in labels.
It does not retrieve a catalog or create the compiled runtime manifest.

The scaffolder renders a versioned explicit-mode template from validated
installer inputs, parses the result with the v2 discriminated source schema,
previews owned file/label changes, then writes only when no unmanaged collision
exists. It never infers mode from catalog or credential availability.

## Rollback

Before compilation, rollback removes only the unchanged installer-owned source
and labels. Once another lifecycle step has adopted the source, normal managed
uninstall rules apply.
