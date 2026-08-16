#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-start ready gate for Trellis tasks.

`.trellis/workflow.md` requires both `implement.jsonl` and `check.jsonl` to hold
a real entry before `task.py start`; the seed `_example` row alone is not ready.
The enforcing check already ships in the SD AI command pack as the
`seeded-task` command of the pack's review preflight, wherever this install
keeps it. This script is the wiring between the two, and lives here rather
than under `.trellis/scripts/` so the Trellis runtime keeps a generic "honor a
repo gate" hook instead of a hard-coded pack path.

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
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PREFLIGHT_NAME = "sd-ai-command-pack-review-preflight.mjs"
# The pack's consumer-owned entry point. It survives a thin conversion, which is
# why the gate asks it where the preflight lives instead of naming a path under
# `scripts/` that the conversion deletes or a machine path that a fat install
# does not use.
LAYOUT_RESOLVER = REPO_ROOT / ".sd-ai-command-pack/bin/sd-ai-command-pack-review-layout.py"
PREFLIGHT_TIMEOUT_SECONDS = 60


def resolve_preflight() -> Path | None:
    """The preflight for this install, or None when it cannot be located.

    None keeps the existing "absent tooling has no opinion" behavior: a thin
    consumer checked out on a machine with no pack install -- a CI runner, most
    of the time -- has nothing to run and must not fail a start over it.
    """
    override = os.environ.get("TRELLIS_TASK_START_GATE_PREFLIGHT", "").strip()
    if override:
        # Lets a test point the gate at a copy of the preflight without
        # requiring a resolvable pack install, and lets an operator run the
        # gate against a checkout of the pack.
        candidate = Path(override).expanduser()
        return candidate if candidate.is_file() else None
    if not LAYOUT_RESOLVER.is_file():
        return None
    try:
        proc = subprocess.run(
            [sys.executable, str(LAYOUT_RESOLVER), "--resolve", PREFLIGHT_NAME],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        resolved = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    path = resolved.get("path") if isinstance(resolved, dict) else None
    if not isinstance(path, str) or not path:
        return None
    candidate = Path(path)
    return candidate if candidate.is_file() else None


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: trellis-task-start-gate.py <task-dir>", file=sys.stderr)
        return 2

    node = shutil.which("node")
    if node is None:
        print("[skip] ready gate not run: node is not on PATH", file=sys.stderr)
        return 0
    preflight = resolve_preflight()
    if preflight is None:
        print(f"[skip] ready gate not run: {PREFLIGHT_NAME} is missing", file=sys.stderr)
        return 0

    task_dir = Path(argv[1]).resolve()
    try:
        rel_dir = task_dir.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        rel_dir = str(task_dir)

    try:
        proc = subprocess.run(
            # `--repo` rather than the working directory: under a thin install
            # the preflight runs from the machine, where its own location says
            # nothing about which repository is being gated.
            [node, str(preflight), "seeded-task", "--task-dir", rel_dir, "--repo", str(REPO_ROOT), "--json"],
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
    except OSError as exc:
        # `node` resolved on PATH but the spawn still failed -- a permission
        # change or a file removed between the check and the call. A controlled
        # refusal beats a traceback out of `task.py start`.
        print(f"Ready gate could not evaluate {rel_dir}: {exc}", file=sys.stderr)
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
