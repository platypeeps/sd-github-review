# Implement — Parallelize installer inspect GitHub reads (A-022)

## Ordered checklist

1. **Add the concurrency lock test first** in `test/consumer-installer.test.js`:
   - `inspect issues its four reads concurrently through the async seam (A-022)`:
     inject an async `execImpl` tracking `inFlight`/`maxInFlight`, yielding a
     microtask, returning per-query JSON (`repo view` → `{nameWithOwner}`,
     lists → `[]`/sample rows). Assert `maxInFlight === 4` and the returned
     snapshot shape (`repository`, `variables` Map, `secrets` Set, `labels` Map).
   Run `node --test test/consumer-installer.test.js` — RED pre-fix (`inspect`
   ignores `execImpl`, runs serially / hits real spawnSync).

2. **Refactor (behavior-preserving)**: extract `interpretCommandResult(command,
   args, result, options, timeoutMs)` from `runCommand`; have `runCommand` call
   it. Run the full installer suite — existing sync timeout/redaction/failure
   tests must stay green (proves the extraction changed nothing on the sync path).

3. **Add the async seam**: `runCommandAsync(command, args, options, execImpl,
   timeoutMs)` on `execFile` with the timeout/nonzero/spawn-failure → result
   mapping from design.md. Import `execFile` (`node:child_process`) and
   `promisify` (`node:util`).

4. **Wire GitHubCli**: add injectable `execImpl` (default `promisify(execFile)`),
   private `#runAsync`/`#runJsonAsync` (readOnly), and rewrite `inspect` to
   `Promise.all` the four reads.

5. **Migrate the inspect timeout test**: change the existing
   `gh read-only query timeout advises a plain retry` test to inject an async
   `execImpl` that rejects with `{ killed: true, signal: "SIGTERM" }`; keep the
   same read-only-wording assertions.

6. **Add async-seam failure/redaction unit tests**: nonzero-exit rejection →
   `commandFailure`; ENOENT-style rejection → "could not start" (not timeout);
   and (adversarial-review C-1) a maxBuffer-style rejection
   (`{ killed: true, signal: "SIGTERM", code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }`)
   is NOT reported as a timeout — it must surface as "could not start", proving
   the `isTimeoutKill` code==null guard.

7. **Re-run targeted**: `node --test test/consumer-installer.test.js` — GREEN.

8. **Full suite**: `npm test` — 0 failures (235 baseline + net new tests).

9. **Full gate**: `npm run check:full` — whitespace clean, preflight 0 failures.

## Validation commands

```bash
node --test test/consumer-installer.test.js
npm test
npm run check:full
```

## Verification limits

- Injected fakes only; no real `gh`/network. The test proves overlap
  (max-in-flight = 4) and preserved timeout/redaction wording; live wall-clock is
  an operator observation.

## Rollback point

- One script + one test file. Rollback = `git revert`.

## Finish steps

- Set `.trellis/audit/ledger.md` A-022 → `fixed` with verification note; owner
  reassigned to `08-04-parallelize-installer-github-reads`; add the child
  reference to the parent PRD child map.
