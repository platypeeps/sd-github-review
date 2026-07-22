# Component Guidelines

## Status

Not applicable. There are no UI components or component framework dependencies.

## Current Presentation Boundary

Operator presentation is plain Markdown assembled by `writeSummary()` in
`src/index.js`. Keep it compact, escape any value that becomes a workflow
command, and test appended output through injected file operations.
