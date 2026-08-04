# Design — Skip PR file enumeration when no sensitive paths are configured (A-014)

## Current fetch gates

Standalone (`src/index.js:233-238`):

```
const patterns = needsSensitivePathEvaluation
  ? parseList(input("sensitive-paths", "", env))
  : [];
const files = needsSensitivePathEvaluation                 // ignores patterns.length
  ? await getClient().listPullRequestFiles(pullRequestNumber)
  : [];
```

Durable (`src/operations.js:342-350`):

```
const files = request.route === "auto"                     // ignores patterns
  ? await client.listPullRequestFiles(request.pullRequestNumber)
  : [];
...
sensitivePaths: parseList(input("sensitive-paths", "", env)),   // parsed after fetch
```

Both fetch every PR file even when `sensitive-paths` is empty. `files` feeds
only `findSensitiveFiles(files, sensitivePaths)`, which returns `[]` for empty
patterns — so the fetch cannot affect routing.

## Fix

Gate each fetch on at least one configured pattern; parse patterns before the
fetch.

Standalone:

```
const patterns = needsSensitivePathEvaluation
  ? parseList(input("sensitive-paths", "", env))
  : [];
const files = patterns.length > 0
  ? await getClient().listPullRequestFiles(pullRequestNumber)
  : [];
```

`patterns` is already `[]` when `!needsSensitivePathEvaluation`, so
`patterns.length > 0` subsumes the eligibility gate and adds the empty-policy
skip.

Durable:

```
const sensitivePaths = parseList(input("sensitive-paths", "", env));
const files = request.route === "auto" && sensitivePaths.length > 0
  ? await client.listPullRequestFiles(request.pullRequestNumber)
  : [];
...
buildRiskContext({ ..., files, sensitivePaths, ... })      // reuse the parsed list
```

## Behavior matrix (route + sensitive-files unchanged; only the fetch is dropped)

| entrypoint | eligible route | sensitive-paths | fetch today | fetch after |
|------------|----------------|-----------------|-------------|-------------|
| standalone | auto           | empty           | **yes**     | no          |
| standalone | auto           | `**/auth/**`    | yes         | yes         |
| standalone | explicit/draft | any             | no          | no          |
| durable    | auto           | empty           | **yes**     | no          |
| durable    | auto           | `**/auth/**`    | yes         | yes         |
| durable    | explicit       | any             | no          | no          |

`findSensitiveFiles([], []) === []` and `findSensitiveFiles(files, []) === []`,
so dropping the empty-policy fetch yields the identical `sensitiveFiles` (`[]`)
and identical route.

## Blast radius

- Two files: `src/index.js` (one gate expression), `src/operations.js` (hoist
  `sensitivePaths`, add `&& sensitivePaths.length > 0`, reuse the parsed list).
- `src/risk-context.js`, `src/path-match.js` untouched.
- No signature or output-shape change; `sensitive-files` / `sensitive-file-count`
  outputs unchanged.

## Compatibility / rollback

- Pure fetch-avoidance; never fetches in a case that previously skipped, never
  skips a case that could produce a sensitive match (empty patterns can't).
- Rollback = revert the two-file diff and the added tests.
