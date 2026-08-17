#!/usr/bin/env python3
"""
Regenerate everything the web app reads, in dependency order.

Run this after any notebook that writes to outputs/. The individual scripts are
still usable on their own; this exists so that "the site is stale" stops being a
thing that can quietly happen -- as it had, with web/public/data/ predating the
committed model by a week.

Usage:
    python scripts/export_all.py
    python scripts/export_all.py --skip-onnx        # onnx deps not installed
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable

# (label, argv, required). The ONNX step is optional because it needs three
# packages that are not in the base dependency set.
STEPS = [
    ("cache      ", ["scripts/build_cache.py"], True),
    ("stars.bin  ", ["scripts/export_web_data.py", "--model", "v2_robust"], True),
    ("analysis   ", ["scripts/export_analysis.py", "--model", "v2_robust",
                     "--out", "analysis.json"], True),
    ("analysis v1", ["scripts/export_analysis.py", "--model", "v1_baseline",
                     "--out", "analysis.v1.json"], True),
    ("realsky    ", ["scripts/export_realsky.py"], True),
    ("onnx       ", ["scripts/export_onnx.py", "--model", "v2_robust"], False),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-onnx", action="store_true")
    args = ap.parse_args()

    failures = []
    for label, argv, required in STEPS:
        if args.skip_onnx and "export_onnx.py" in argv[0]:
            print(f"[{label}] skipped")
            continue
        print(f"\n{'=' * 70}\n[{label}] {' '.join(argv)}\n{'=' * 70}")
        r = subprocess.run([PY, *argv], cwd=ROOT)
        if r.returncode != 0:
            if required:
                failures.append(label.strip())
            else:
                print(f"[{label}] optional step failed — continuing")

    print(f"\n{'=' * 70}")
    if failures:
        raise SystemExit(f"FAILED: {', '.join(failures)}")
    print("all exports regenerated.")


if __name__ == "__main__":
    main()
