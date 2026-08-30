# Design — Parallelize installer inspect GitHub reads (A-022)

## Current state

`scripts/consumer-installer.mjs`:

- `runCommand(command, args, options)` (≈137) calls a synchronous `spawnImpl`
  (default `spawnSync`) and then interprets the result: ETIMEDOUT → bounded
  timeout error (read-only vs mutation wording via `options.readOnly`),
  `error` → "could not start", nonzero `status` → `commandFailure`, else stdout.
- `GitHubCli` (≈161) wraps `runCommand` in `run`/`runJson`. `inspect(repository)`
  (≈188) calls `runJson` four times **in sequence** for `repo view`,
  `variable list`, `secret list`, `label list`.
- Mutations (`setVariable`, `deleteVariable`, `createLabel`, `deleteLabel`,
  `setSecret`, `deleteSecret`) each call `run` synchronously.

Because `spawnSync` blocks the event loop, the four reads cannot overlap.

## Fix

Introduce an asynchronous read seam and share the result interpretation with the
existing sync path so behavior (redaction, timeout wording, failure mapping)
cannot diverge.

### 1. Extract shared result interpretation (behavior-preserving)

Pull the post-spawn logic out of `runCommand` into a pure function over a
`spawnSync`-shaped result:

```js
function interpretCommandResult(command, args, result, options, timeoutMs) {
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw commandTimeout(command, args, timeoutMs, options.secret, options.readOnly);
    }
    throw new Error(`${command} could not start: ${redact(result.error.message, options.secret)}`);
  }
  if (result.status !== 0) {
    throw commandFailure(command, args, result, options.secret);
  }
  return result.stdout ?? "";
}
```

`runCommand` keeps its exact behavior:

```js
function runCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawnSync;
  const timeoutMs = options.timeoutMs ?? GH_COMMAND_TIMEOUT_MS;
  const result = spawnImpl(command, args, { /* unchanged */ });
  return interpretCommandResult(command, args, result, options, timeoutMs);
}
```

### 2. Add an async command runner on `execFile`

```js
async function runCommandAsync(command, args, options, execImpl, timeoutMs) {
  let result;
  try {
    const { stdout } = await execImpl(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      env: process.env,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    });
    result = { error: null, status: 0, stdout, stderr: "" };
  } catch (error) {
    // Map execFile's rejection into the spawnSync-shaped result the shared
    // interpreter understands.
    if (isTimeoutKill(error, "SIGTERM")) {
      result = { error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), status: null, stdout: "", stderr: error.stderr ?? "" };
    } else if (typeof error.code === "number") {
      // The process ran and exited nonzero.
      result = { error: null, status: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    } else {
      // Any other rejection (spawn failure like ENOENT, or a maxBuffer kill
      // carrying a string code) → "could not start" via the interpreter.
      result = { error, status: null, stdout: "", stderr: "" };
    }
  }
  return interpretCommandResult(command, args, result, options, timeoutMs);
}

// execFile represents a timeout in two ways across Node versions: either a
// string code "ETIMEDOUT", or a signal-kill (killed + signal === killSignal)
// with NO error code. Crucially, execFile ALSO kills the child with killSignal
// on a maxBuffer overflow — but that rejection carries a string code
// ("ERR_CHILD_PROCESS_STDIO_MAXBUFFER"), so requiring the code to be absent in
// the signal-kill branch keeps a maxBuffer error from being misreported as a
// timeout.
function isTimeoutKill(error, killSignal) {
  if (error.code === "ETIMEDOUT") return true;
  return Boolean(error.killed) && error.signal === killSignal && error.code == null;
}
```

Mapping rationale (execFile semantics): a timeout is either a string code
`"ETIMEDOUT"` or a signal-kill (`killed` + `signal === killSignal`) with no code;
a normal nonzero exit sets `err.code` to the numeric exit status; a spawn failure
(e.g. `"ENOENT"`) or a maxBuffer kill sets `err.code` to a string. The branches
route each to the same interpreter outcome as the sync path (timeout / failure /
could-not-start), and — per adversarial review C-1 — a maxBuffer-triggered
`killSignal` kill is NOT misclassified as a timeout because its code is a
non-null string.

### 3. Wire `GitHubCli` and parallelize `inspect`

- Constructor gains an injectable async `execImpl` (default
  `promisify(execFile)` from `node:util` / `node:child_process`), alongside the
  existing `spawnImpl`.
- Private async helpers `#runAsync`/`#runJsonAsync` mirror `run`/`runJson` but go
  through `runCommandAsync` with `readOnly: true`.
- `inspect` fans the four reads out with `Promise.all` (a fixed, bounded set of
  four independent reads — no unbounded pool):

```js
async inspect(repository) {
  const [repo, variables, secrets, labels] = await Promise.all([
    this.#runJsonAsync("gh", ["repo", "view", repository, "--json", "nameWithOwner"]),
    this.#runJsonAsync("gh", ["variable", "list", "--repo", repository, "--json", "name,value"]),
    this.#runJsonAsync("gh", ["secret", "list", "--repo", repository, "--json", "name"]),
    this.#runJsonAsync("gh", ["label", "list", "--repo", repository, "--limit", "1000", "--json", "name,color,description"]),
  ]);
  return {
    repository: repo.nameWithOwner,
    variables: new Map(variables.map(({ name, value }) => [name, value])),
    secrets: new Set(secrets.map(({ name }) => name)),
    labels: new Map(labels.map((label) => [label.name, label])),
  };
}
```

Mutations are left exactly as-is (sync `run`), so install-time state transitions
stay ordered.

## Regression / concurrency lock

Add tests in `test/consumer-installer.test.js`:

1. **Concurrency**: inject an async `execImpl` that increments an in-flight
   counter, yields a microtask, then resolves with per-query JSON. Assert the
   observed max-in-flight is 4 (serial code would peak at 1). Assert the
   returned snapshot shape/values.
2. **Read-only timeout on the async seam**: inject an `execImpl` that rejects
   with `{ killed: true, signal: "SIGTERM" }`; assert `inspect` rejects with the
   "read was interrupted" guidance and not the reconciliation wording (moves the
   existing A-012 inspect-timeout assertion onto the async seam).
3. **Redaction/failure mapping** (unit on the async runner via a crafted
   `execImpl`): a nonzero exit maps to `commandFailure`; an ENOENT-style
   rejection maps to "could not start", not a timeout.

The existing sync mutation timeout/redaction/failure tests are untouched and
must still pass — proof the shared extraction did not change the sync path.

## Blast radius

- `scripts/consumer-installer.mjs`: extract `interpretCommandResult`, add
  `runCommandAsync`, add `execImpl` + async helpers, parallelize `inspect`.
  New imports: `execFile` (`node:child_process`), `promisify` (`node:util`).
- `test/consumer-installer.test.js`: async-seam tests added; the existing
  `inspect` timeout test migrates from `spawnImpl` to `execImpl`.
- No `src/`, workflow, protocol, or install-lifecycle-ordering change.

## Verification limits

- All paths driven by injected fakes; no real `gh`/network. The test proves the
  overlap mechanism (max-in-flight = 4); the wall-clock win against live GitHub
  is an operator observation.

## Compatibility / rollback

- `inspect` was already `async` and awaited by callers, so making its internals
  concurrent is source-compatible. `execImpl` defaults preserve production
  behavior. Mutations are byte-for-byte unchanged.
- `maxBuffer` is left at the Node default to match the current `spawnSync`
  behavior (no truncation-threshold change).
- Rollback = restore the serial `inspect` and drop the async seam/tests.
