#!/usr/bin/env python3
"""
Export the training set as a quantised binary point cloud for the web visualiser.

Pipeline:
    CSV (1.27M rows) -> clean -> features -> model predictions
        -> drop outliers -> stratified downsample -> int16 quantise -> planar binary

Output (into web/public/data/):
    stars.bin           full tier   (250k stars)
    stars.preview.bin   preview tier (25k stars, loads first)
    stars.meta.json     column ranges + counts, needed to dequantise for tooltips

Usage:
    python scripts/export_web_data.py
    python scripts/export_web_data.py --n 400000
    python scripts/export_web_data.py --model v2_robust
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import polars as pl

import lmc
from lmc import models
from lmc.split import load_split

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "public" / "data"

# Rows outside this percentile band on ANY plotted column are DROPPED, not clamped.
# Clamping piles every outlier onto the range boundary, which renders as hard bright
# lines around the edge of every plot — clearly visible in the first build.
CLIP_LO, CLIP_HI = 0.2, 99.8

# Tangent-plane projection centre: the LMC's centroid in this field.
# Plotting raw ra/dec at dec ~ -70 shears the field into a fan, because lines of
# constant RA converge toward the pole. A gnomonic projection removes that.
RA0, DEC0 = 80.9, -69.3

INT16_BLOCKS = ["skyX", "skyY", "pmra", "pmdec", "bp_rp", "gmag", "plx", "depth"]
UINT8_BLOCKS = ["type", "prob", "isTest"]
BYTES_PER_STAR = len(INT16_BLOCKS) * 2 + len(UINT8_BLOCKS)  # 19


def gnomonic(ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Project sky coordinates onto a plane tangent at (RA0, DEC0), in degrees."""
    ra_r, dec_r = np.radians(ra), np.radians(dec)
    ra0, dec0 = np.radians(RA0), np.radians(DEC0)
    d_ra = ra_r - ra0

    cos_c = np.sin(dec0) * np.sin(dec_r) + np.cos(dec0) * np.cos(dec_r) * np.cos(d_ra)
    cos_c = np.maximum(cos_c, 1e-6)  # guard the far hemisphere

    x = np.cos(dec_r) * np.sin(d_ra) / cos_c
    y = (np.cos(dec0) * np.sin(dec_r) - np.sin(dec0) * np.cos(dec_r) * np.cos(d_ra)) / cos_c
    return np.degrees(x), np.degrees(y)


def measured_depth(parallax: np.ndarray) -> np.ndarray:
    """Depth from parallax, as actually measured — noise and all.

    distance[kpc] = 1/parallax[mas]. At LMC distance Gaia's parallax errors swamp the
    signal, so many LMC stars have *negative* measured parallax, i.e. nonsensical
    distance. We do NOT hide that: those are floored to the far plane, and the UI
    labels this view "what Gaia actually measures". The mess is the point — it's why
    parallax scores 0.003 feature importance.
    """
    return np.log10(1.0 / np.maximum(parallax, 0.005))


def predict(df: pl.DataFrame, clf, features: list[str], calibrator=None) -> np.ndarray:
    prob = models.predict(clf, features, df, calibrator)
    print(f"  predicted {len(prob):,} stars  (mean P(LMC) = {prob.mean():.3f})")
    return prob


def stratified_sample(y: np.ndarray, n_want: int, seed: int) -> np.ndarray:
    """Sample preserving the ~78/22 class balance, so the visual density is honest."""
    n_total = len(y)
    if n_want >= n_total:
        return np.arange(n_total)

    rng = np.random.default_rng(seed)
    parts = []
    for cls in (0, 1):
        pool = np.flatnonzero(y == cls)
        take = int(round(n_want * len(pool) / n_total))
        parts.append(rng.choice(pool, size=min(take, len(pool)), replace=False))

    idx = np.concatenate(parts)
    rng.shuffle(idx)  # interleave so neither class draws entirely on top of the other
    return idx


def quantise(values: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Map to int16 over the data's full (already outlier-free) range."""
    lo, hi = float(values.min()), float(values.max())
    if hi <= lo:
        hi = lo + 1.0
    t = 2.0 * (values - lo) / (hi - lo) - 1.0  # -> [-1, 1]
    return np.round(t * 32767).astype(np.int16), lo, hi


def write_tier(path: Path, cols: dict[str, np.ndarray], idx: np.ndarray) -> None:
    """Planar blocks in a fixed order the JS loader mirrors exactly."""
    with open(path, "wb") as f:
        for name in INT16_BLOCKS:
            f.write(cols[name][idx].tobytes())
        for name in UINT8_BLOCKS:
            f.write(cols[name][idx].tobytes())
    print(f"  wrote {path.relative_to(ROOT)}  ({len(idx):,} stars, {path.stat().st_size/1e6:.2f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=250_000)
    ap.add_argument("--preview", type=int, default=25_000)
    ap.add_argument("--model", default=None, help="registry name or directory")
    ap.add_argument("--allow-reference", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    WEB_DATA.mkdir(parents=True, exist_ok=True)

    print("loading training set...")
    df = lmc.load_sim(verbose=True)

    print("running model...")
    model_dir, clf, features = models.load(args.model, allow_reference=args.allow_reference)
    calibrator = models.load_calibrator(model_dir)
    print(f"  model: {model_dir.relative_to(ROOT)}  ({len(features)} features)"
          f"{'  + isotonic calibration' if calibrator is not None else '  (uncalibrated)'}")
    prob_all = predict(df, clf, features, calibrator)
    y_all = df["Type"].to_numpy()

    # Mark the held-out rows. Act 7 ("where the model is wrong") must show only
    # these — training-row errors would understate the error rate in the one place
    # we explicitly claim to be honest. Loaded from the notebook's own split, with
    # a label hash checked on the way in.
    _, test_idx = load_split(model_dir / "split.npz", y_all)
    is_test_all = np.zeros(len(y_all), dtype=bool)
    is_test_all[test_idx] = True

    print("projecting + deriving...")
    sky_x, sky_y = gnomonic(df["ra"].to_numpy(), df["dec"].to_numpy())
    raw = {
        "skyX":  sky_x,
        "skyY":  sky_y,
        "pmra":  df["pmra"].to_numpy(),
        "pmdec": df["pmdec"].to_numpy(),
        "bp_rp": df["bp_rp"].to_numpy(),
        "gmag":  df["phot_g_mean_mag"].to_numpy(),
        "plx":   df["parallax"].to_numpy(),
        "depth": measured_depth(df["parallax"].to_numpy()),
    }

    # Drop outliers ONCE, across all columns together. Clamping instead would stack
    # every outlier on the boundary and draw a bright frame around each plot.
    keep = np.ones(len(y_all), dtype=bool)
    for name, values in raw.items():
        lo, hi = np.percentile(values, [CLIP_LO, CLIP_HI])
        keep &= (values >= lo) & (values <= hi)
    print(f"  kept {keep.sum():,} of {len(keep):,} rows ({100*keep.mean():.1f}%) after outlier removal")

    raw = {k: v[keep] for k, v in raw.items()}
    y = y_all[keep]
    prob = prob_all[keep]
    is_test = is_test_all[keep]

    print("quantising...")
    cols: dict[str, np.ndarray] = {}
    ranges: dict[str, dict[str, float]] = {}
    for name, values in raw.items():
        q, lo, hi = quantise(values)
        cols[name] = q
        ranges[name] = {"lo": lo, "hi": hi}

    # 0 or 255 so the shader's `normalized` read yields a clean 0.0 / 1.0
    cols["type"] = (y * 255).astype(np.uint8)
    cols["prob"] = np.round(prob * 255).astype(np.uint8)
    cols["isTest"] = (is_test * 255).astype(np.uint8)

    print("sampling + writing...")
    full = stratified_sample(y, args.n, args.seed)
    prev = stratified_sample(y, args.preview, args.seed + 1)

    write_tier(WEB_DATA / "stars.bin", cols, full)
    write_tier(WEB_DATA / "stars.preview.bin", cols, prev)

    meta = {
        "counts": {"full": int(len(full)), "preview": int(len(prev))},
        "int16Blocks": INT16_BLOCKS,
        "uint8Blocks": UINT8_BLOCKS,
        "bytesPerStar": BYTES_PER_STAR,
        "ranges": ranges,
        "lmcFraction": round(float(y[full].mean()), 4),
        "testFraction": round(float(is_test[full].mean()), 4),
        "sourceRows": int(len(y_all)),
        "projection": {"kind": "gnomonic", "ra0": RA0, "dec0": DEC0},
        "model": model_dir.name,
    }
    (WEB_DATA / "stars.meta.json").write_text(json.dumps(meta, indent=2))
    print(f"  wrote {(WEB_DATA / 'stars.meta.json').relative_to(ROOT)}")
    print("\ndone.")


if __name__ == "__main__":
    main()
