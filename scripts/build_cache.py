#!/usr/bin/env python3
"""Parse the training CSV once and cache it as parquet.

Six notebooks and two export scripts need the same cleaned frame. Parsing 251 MB of
CSV in each costs ~15 s a time and, more importantly, gives the cleaning step six
chances to drift. This writes it once.

Usage:
    python scripts/build_cache.py
    python scripts/build_cache.py --force     # rebuild even if the parquet exists

Outputs (both gitignored, both regenerable from the CSV):
    data/processed/train_clean.parquet
    data/processed/fingerprint.json      what it was built from, by sha256
"""

from __future__ import annotations

import argparse

from lmc.io import TRAIN_PARQUET, build_cache, fingerprint


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="rebuild even if the cache exists")
    args = ap.parse_args()

    if TRAIN_PARQUET.exists() and not args.force:
        fp = fingerprint()
        print(f"cache already present: {TRAIN_PARQUET}")
        print(f"  {fp.get('rows_clean', '?'):,} rows from {fp.get('source', '?')}")
        print("  pass --force to rebuild")
        return

    df = build_cache()
    fp = fingerprint()
    print(f"\n  source sha256 {fp['source_sha256'][:16]}...")
    print(f"  {fp['rows_raw']:,} raw -> {fp['rows_clean']:,} clean "
          f"({fp['rows_dropped']} dropped)")
    print(f"  columns: {', '.join(df.columns)}")


if __name__ == "__main__":
    main()
