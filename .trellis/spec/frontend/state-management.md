# State Management

## Status

Not applicable. There is no client-side or global UI state.

Each Action invocation derives its decision from inputs, one GitHub event, and
live PR metadata. Do not add cross-run state or a state library; persistence
would be a backend/product architecture change covered by the backend database
guideline and `DESIGN.md`.
