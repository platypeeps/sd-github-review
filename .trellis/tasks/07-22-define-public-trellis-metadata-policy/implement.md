# Define Public Trellis Metadata Policy Implementation Plan

## Execution Order

1. Publish the allow/deny policy and current workspace-retention decision.
2. Add project-owned `.agents/` local-state ignore rules without editing the
   generated command-pack block.
3. Add the tracked-path classifier and Git file-list integration to the
   existing metadata validator.
4. Add negative and positive path tests, then link the policy from README.

## Validation Plan

1. Run focused metadata tests with `node --test test/metadata.test.js`.
2. Run `npm test`, `npm run check`, and `npm run validate:metadata`.
3. Run the command-pack install audit and `git diff --check`.
4. Verify representative prohibited paths are ignored with
   `git check-ignore -v`.

## Documentation And Spec Updates

- Add the public metadata policy and README link.
- Review backend quality/logging guidance after implementation; update specs
  only if the task establishes a reusable repository convention not already
  captured by the policy and tests.

## Review Notes

- Confirm current workspace journals remain intentionally public.
- Confirm path patterns exclude runtime state without blocking shared skills,
  hooks, prompts, task artifacts, or installation receipts.
- Confirm Git command failure is not silently treated as an empty file list.

## Rollback Points

- Revert the validator/tests independently if a path rule proves too broad.
- Remove only the project-owned `.agents/` ignore section; never hand-edit the
  generated command-pack block during rollback.

## Follow-Ups

- A history rewrite requires separate explicit maintainer approval and is not
  implied by this forward-looking policy.
