#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-start ready gate for Trellis tasks.

`.trellis/workflow.md` requires both `implement.jsonl` and `check.jsonl` to hold
a real entry before `task.py start`; the seed `_example` row alone is not ready.
The enforcing check already ships in the SD AI command pack as the
`seeded-task` command of `sd-ai-command-pack-review-preflight.mjs`. This script
is the wiring between the two, and lives here rather than under
`.trellis/scripts/` so the Trellis runtime keeps a generic "honor a repo gate"
hook instead of a hard-coded pack path.

Usage:
    python3 scripts/trellis-task-start-gate.py <task-dir>

Exit codes:
    0  start may proceed -- the manifests are ready, or the toolchain is absent
    1  start refused -- the preflight's own findings are printed, or the
       preflight is present but failed to report
    2  bad invocation
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PREFLIGHT = Path("scripts/sd-ai-command-pack-review-preflight.mjs")
PREFLIGHT_TIMEOUT_SECONDS = 60


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: trellis-task-start-gate.py <task-dir>", file=sys.stderr)
        return 2

    node = shutil.which("node")
    preflight = REPO_ROOT / PREFLIGHT
    if node is None:
        print("[skip] ready gate not run: node is not on PATH", file=sys.stderr)
        return 0
    if not preflight.is_file():
        print(f"[skip] ready gate not run: {PREFLIGHT} is missing", file=sys.stderr)
        return 0

    task_dir = Path(argv[1]).resolve()
    try:
        rel_dir = task_dir.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        rel_dir = str(task_dir)

    try:
        proc = subprocess.run(
            [node, str(preflight), "seeded-task", "--task-dir", rel_dir, "--json"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        # This gate sits on an interactive command; a hung preflight must fail
        # the start rather than hang it.
        print(
            f"Ready gate could not evaluate {rel_dir}: seeded-task did not finish "
            f"within {PREFLIGHT_TIMEOUT_SECONDS}s",
            file=sys.stderr,
        )
        return 1

    try:
        report = json.loads(proc.stdout)
    except json.JSONDecodeError:
        # Absent tooling has no opinion and is handled above. Tooling that is
        # present and still failed to report is a broken gate, and a gate that
        # cannot evaluate must not certify -- a rejected --task-dir would
        # otherwise wave the start through.
        print(f"Ready gate could not evaluate {rel_dir}: seeded-task produced no JSON report", file=sys.stderr)
        if proc.stderr.strip():
            print(proc.stderr.strip(), file=sys.stderr)
        return 1

    if report.get("status") == "valid":
        return 0

    print(f"Ready gate failed for {rel_dir} (.trellis/workflow.md):", file=sys.stderr)
    for finding in report.get("findings", []):
        print(
            f"  {finding.get('reasonCode')} | {finding.get('path')} | {finding.get('message')}",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
