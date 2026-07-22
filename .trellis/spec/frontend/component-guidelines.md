# Component Guidelines

## Status

Not applicable. There are no UI components or component framework dependencies.

## Current Presentation Boundary

Operator presentation is plain Markdown assembled by `writeSummary()` in
`src/index.js` and appended to `$GITHUB_STEP_SUMMARY`. Keep it compact and test
the appended file output through injected operations. Workflow-command escaping
belongs to stdout annotations such as `errorAnnotation()`, not step summaries.
