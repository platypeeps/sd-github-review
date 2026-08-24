#!/usr/bin/env python3
"""Chunked prism review, exposed to sd-ai-command-pack as an ``argv`` provider.

The pack's builtin prism adapter runs ``prism review range base..head`` once for
the whole branch delta. Two things go wrong with that against stock prism, and
both are silent -- the review exits zero and prints a finding count either way:

* prism's own chunker is unreachable. ``reviewPipeline`` passes
  ``cfg.MaxDiffBytes`` to ``SplitIntoChunks``, but ``MaxDiffBytes`` has already
  truncated the diff by then, so ``maxBytes >= len(diff)`` by construction and
  every diff becomes exactly one chunk. Large single prompts then degenerate:
  measured on a 110 KB, 23-file delta, one whole-diff request returned ``[]``
  in 3.2s with 4 output tokens, while the same prompt over one 14 KB file
  returned 8 findings.
* ``.prism/rules.json`` is never loaded. ``LoadRules("")`` returns nil and
  nothing defaults the path, so a repository's focus areas, severity overrides
  and required checks only apply when a caller passes ``--rules``. The pack
  never does.

This script does the chunking on the caller's side and passes ``--rules``, so
both are addressed without a patched prism binary and without a pack change. It
groups the changed files by their diff size, runs one ``prism review range``
per group with ``--paths``, and merges the results into the argv adapter's
payload contract:

    {"status": "findings"|"clean", "findings": [{summary, path, line, severity, family}]}

Usage (from ``.sd-ai-command-pack/review.json``)::

    "argv": ["{repo}/scripts/prism-chunked-review.py",
             "{repo}", "{base}", "{head}", "{artifact}"]

Exit codes are the ones the provider's ``outcomeByExitCode`` maps: 0 for a
complete review, 4 when at least one group failed. A partial review still
prints the findings it did get -- but it exits 4 so the receipt records a
limitation rather than reporting a degraded run as a clean one. That
distinction is the entire point of the exercise; suppressing it here would
reproduce the defect this script exists to work around.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Matches the default this repository's patched prism uses for `chunkMaxBytes`,
# so the two paths produce comparable chunk counts on the same delta.
DEFAULT_CHUNK_BYTES = 20_000
DEFAULT_CONCURRENCY = 4
DEFAULT_CONTEXT_LINES = 3
DEFAULT_CHUNK_TIMEOUT = 300
DEFAULT_ATTEMPTS = 2
RULES_PATH = ".prism/rules.json"
MAX_FILES = 2_000


class ChunkError(RuntimeError):
    """A group of files could not be reviewed."""


def _int_env(name: str, fallback: int, *, low: int, high: int) -> int:
    raw = os.environ.get(name, "")
    if not raw:
        return fallback
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return value if low <= value <= high else fallback


def _git(repo: Path, *args: str, timeout: int = 60) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise ChunkError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def changed_files(repo: Path, base: str, head: str) -> list[str]:
    # Three-dot, matching what prism's own `review range` builds: the diff
    # against the merge base, not against the tip of the base branch.
    raw = _git(repo, "diff", "--name-only", "-z", f"{base}...{head}")
    return [name for name in raw.decode("utf-8", "replace").split("\0") if name]


def diff_bytes(repo: Path, base: str, head: str, path: str, context: int) -> int:
    raw = _git(
        repo, "diff", f"-U{context}", f"{base}...{head}", "--", path, timeout=120
    )
    return len(raw)


def group_files(sized: list[tuple[str, int]], limit: int) -> list[list[str]]:
    """Greedily pack files into groups whose combined diff stays under ``limit``.

    A single file larger than the limit gets its own group rather than being
    dropped: prism will truncate it, which is worse than chunking but better
    than not reviewing it at all.
    """

    groups: list[list[str]] = []
    current: list[str] = []
    running = 0
    for path, size in sized:
        if current and running + size > limit:
            groups.append(current)
            current, running = [], 0
        current.append(path)
        running += size
    if current:
        groups.append(current)
    return groups


def review_group(
    repo: Path,
    base: str,
    head: str,
    paths: list[str],
    *,
    context: int,
    timeout: int,
) -> bytes:
    argv = [
        "prism",
        "review",
        "range",
        f"{base}...{head}",
        "--format",
        "json",
        "--paths",
        ",".join(paths),
        "--context-lines",
        str(context),
    ]
    rules = os.environ.get("PRISM_CHUNK_RULES") or RULES_PATH
    # Relative paths resolve against the repository, which is this process's cwd
    # for the child as well; an absolute override lets a caller test an
    # alternate policy without editing the repository's own rules file.
    if (repo / rules).is_file():
        argv += ["--rules", rules]
    result = subprocess.run(
        argv,
        cwd=repo,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    # prism maps "findings present" onto a non-zero exit under `--fail-on`, so
    # a non-zero code is only fatal when there is also no parsable payload.
    if not result.stdout.strip():
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise ChunkError(f"exit {result.returncode}: {detail or 'no output'}")
    return result.stdout


def parse_findings(stdout: bytes) -> list[dict[str, object]]:
    """Map prism's report onto the pack's finding shape.

    Deliberately mirrors ``_prism_payload`` in the pack's review-local script,
    field for field, so this provider stays behaviourally identical to the
    builtin adapter apart from the chunking.
    """

    try:
        value = json.loads(stdout.decode("utf-8", "replace"))
    except json.JSONDecodeError as error:
        raise ChunkError(f"unparsable prism report: {error}") from None
    if not isinstance(value, dict) or not isinstance(value.get("findings"), list):
        raise ChunkError("prism report has no findings array")
    rows: list[dict[str, object]] = []
    for raw in value["findings"]:
        if not isinstance(raw, dict):
            continue
        locations = raw.get("locations")
        location = locations[0] if isinstance(locations, list) and locations else {}
        if not isinstance(location, dict):
            location = {}
        lines = location.get("lines")
        line = lines.get("start") if isinstance(lines, dict) else None
        rows.append(
            {
                "path": location.get("path"),
                "line": line if isinstance(line, int) else None,
                "severity": raw.get("severity"),
                "summary": raw.get("title") or raw.get("message"),
                "family": raw.get("category"),
            }
        )
    return rows


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: prism-chunked-review.py <repo> <base> <head> [artifact]",
            file=sys.stderr,
        )
        return 2
    repo = Path(argv[0]).resolve()
    base, head = argv[1], argv[2]
    artifact = Path(argv[3]) if len(argv) > 3 else None

    chunk_bytes = _int_env(
        "PRISM_CHUNK_BYTES", DEFAULT_CHUNK_BYTES, low=1_000, high=2_000_000
    )
    concurrency = _int_env("PRISM_CHUNK_CONCURRENCY", DEFAULT_CONCURRENCY, low=1, high=16)
    context = _int_env(
        "PRISM_CHUNK_CONTEXT_LINES", DEFAULT_CONTEXT_LINES, low=0, high=25
    )
    timeout = _int_env(
        "PRISM_CHUNK_TIMEOUT_SECONDS", DEFAULT_CHUNK_TIMEOUT, low=30, high=3_600
    )
    attempts = _int_env("PRISM_CHUNK_ATTEMPTS", DEFAULT_ATTEMPTS, low=1, high=4)

    try:
        files = changed_files(repo, base, head)
    except (ChunkError, subprocess.TimeoutExpired) as error:
        print(f"prism-chunked: {error}", file=sys.stderr)
        return 4
    if len(files) > MAX_FILES:
        print(
            f"prism-chunked: {len(files)} changed files exceeds the {MAX_FILES} cap",
            file=sys.stderr,
        )
        return 4

    # `--paths` is a comma-separated list, so a path containing a comma cannot
    # be expressed in it at all. Excluding one silently would be the same class
    # of defect this script works around, so it is named on stderr and the run
    # is reported incomplete.
    reviewable = [path for path in files if "," not in path]
    excluded = [path for path in files if "," in path]
    for path in excluded:
        print(f"prism-chunked: cannot review {path!r} -- path contains a comma", file=sys.stderr)

    if not reviewable:
        print(json.dumps({"status": "clean", "findings": []}))
        return 4 if excluded else 0

    try:
        sized = [
            (path, diff_bytes(repo, base, head, path, context)) for path in reviewable
        ]
    except (ChunkError, subprocess.TimeoutExpired) as error:
        print(f"prism-chunked: {error}", file=sys.stderr)
        return 4

    groups = group_files(sized, chunk_bytes)
    total = sum(size for _, size in sized)
    print(
        f"prism-chunked: {len(reviewable)} files, {total} diff bytes, "
        f"{len(groups)} chunks of at most {chunk_bytes}",
        file=sys.stderr,
    )

    if artifact is not None:
        try:
            (artifact / "chunks").mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError:
            artifact = None

    def run(index_and_group: tuple[int, list[str]]) -> tuple[int, object]:
        index, paths = index_and_group
        # One retry, because the dominant failure is a provider-side deadline
        # rather than anything about the chunk. Retrying more would hide a
        # provider that is genuinely down behind a long wall of waiting.
        last: Exception | None = None
        stdout = b""
        for _ in range(attempts):
            try:
                stdout = review_group(
                    repo, base, head, paths, context=context, timeout=timeout
                )
                last = None
                break
            except (ChunkError, subprocess.TimeoutExpired, OSError) as error:
                last = error
        if last is not None:
            return index, ChunkError(str(last))
        if artifact is not None:
            try:
                (artifact / "chunks" / f"{index:03d}.json").write_bytes(stdout)
            except OSError:
                pass
        try:
            return index, parse_findings(stdout)
        except ChunkError as error:
            return index, error

    with ThreadPoolExecutor(max_workers=min(concurrency, len(groups))) as pool:
        results = list(pool.map(run, enumerate(groups)))

    findings: list[dict[str, object]] = []
    failed = 0
    for index, outcome in sorted(results, key=lambda row: row[0]):
        if isinstance(outcome, ChunkError):
            failed += 1
            print(
                f"prism-chunked: chunk {index} ({len(groups[index])} files) failed: "
                f"{outcome}",
                file=sys.stderr,
            )
            continue
        findings.extend(outcome)  # type: ignore[arg-type]

    # Deduplicate across chunks -- a file can only land in one group, so this is
    # belt and braces -- and sort, so the payload does not depend on which
    # worker finished first and the receipt digest stays reproducible.
    unique = {
        (
            str(row.get("path")),
            row.get("line"),
            str(row.get("severity")),
            str(row.get("summary")),
        ): row
        for row in findings
    }
    ordered = [unique[key] for key in sorted(unique, key=lambda k: (k[0], k[1] or 0, k[2], k[3]))]

    print(json.dumps({"status": "findings" if ordered else "clean", "findings": ordered}))
    if failed or excluded:
        print(
            f"prism-chunked: incomplete -- {failed} of {len(groups)} chunks failed, "
            f"{len(excluded)} files excluded",
            file=sys.stderr,
        )
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
