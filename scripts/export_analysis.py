#!/usr/bin/env python3
"""
Export everything the web app needs to *explain* the model, not just show stars.

Produces web/public/data/analysis.json:
    - confusion matrix swept across 101 decision thresholds (instant slider)
    - ROC and precision-recall curves
    - feature importances
    - per-feature histograms, split by class (the distributions)
    - class-separation stats

CRITICAL: every metric here is computed on the HELD-OUT TEST SPLIT only — scoring
training rows would inflate recall from 99.58% to 99.84% in the one place we claim to
be rigorous. The split is *loaded* from the model's own split.npz, not re-derived from
a seed, and loading verifies a hash of the labels it was built from.

Usage:
    python scripts/export_analysis.py
    python scripts/export_analysis.py --model v2_robust --out analysis.v2.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.metrics import (
    average_precision_score,
    precision_recall_curve,
    roc_auc_score,
    roc_curve,
)

import lmc
from lmc import models
from lmc.split import load_split

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "public" / "data"

N_THRESHOLDS = 101
N_CURVE_POINTS = 200
N_HIST_BINS = 60

# Human-readable labels + why each feature matters, shown in the UI.
FEATURE_META = {
    "pmra":            ("Proper motion (RA)",    "How fast the star drifts east–west"),
    "pmdec":           ("Proper motion (Dec)",   "How fast it drifts north–south"),
    "pm_total":        ("Total proper motion",   "Overall speed across the sky"),
    "parallax":        ("Parallax",              "Distance proxy — ~0 for the LMC"),
    "pmra_error":      ("pmra uncertainty",      "How well the motion was measured"),
    "pmdec_error":     ("pmdec uncertainty",     "How well the motion was measured"),
    "parallax_error":  ("Parallax uncertainty",  "Larger for faint, distant stars"),
    "phot_g_mean_mag": ("G magnitude",           "Brightness (smaller = brighter)"),
    "phot_bp_mean_mag":("BP magnitude",          "Blue-band brightness"),
    "phot_rp_mean_mag":("RP magnitude",          "Red-band brightness"),
    "bp_rp":           ("Colour (BP−RP)",        "Temperature proxy"),
    "pm_chi2":         ("PM χ² from LMC",        "Distance from the clump, in units of the star's own error"),
    "plx_snr":         ("Parallax / its error",  "Dimensionless — meaningful at any error scale"),
}


def sweep_thresholds(y: np.ndarray, prob: np.ndarray) -> dict:
    """Confusion matrix at every threshold, so the UI slider is a lookup not a compute."""
    thresholds = np.linspace(0.0, 1.0, N_THRESHOLDS)
    pos = y == 1
    n_pos, n_neg = int(pos.sum()), int((~pos).sum())

    # Sort once, then every threshold is a binary search — O(n log n) not O(n * 101).
    order = np.argsort(prob)
    sorted_prob = prob[order]
    sorted_pos = pos[order]
    cum_pos = np.concatenate([[0], np.cumsum(sorted_pos)])

    tp, fp, tn, fn = [], [], [], []
    for t in thresholds:
        idx = int(np.searchsorted(sorted_prob, t, side="left"))
        pos_below = int(cum_pos[idx])          # positives predicted negative
        n_below = idx
        _fn = pos_below
        _tn = n_below - pos_below
        _tp = n_pos - _fn
        _fp = n_neg - _tn
        tp.append(_tp); fp.append(_fp); tn.append(_tn); fn.append(_fn)

    return {
        "thresholds": [round(float(t), 3) for t in thresholds],
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "nPositive": n_pos, "nNegative": n_neg,
    }


def downsample_curve(x: np.ndarray, y: np.ndarray, n: int = N_CURVE_POINTS) -> list:
    if len(x) <= n:
        idx = np.arange(len(x))
    else:
        idx = np.linspace(0, len(x) - 1, n).astype(int)
    return [[round(float(x[i]), 5), round(float(y[i]), 5)] for i in idx]


def feature_histograms(df: pl.DataFrame, features: list[str], y: np.ndarray) -> list[dict]:
    """Per-feature distributions, split by class — this is 'how the data separates'."""
    out = []
    lmc, mw = y == 1, y == 0

    for name in features:
        v = df[name].to_numpy()
        lo, hi = np.percentile(v, [0.5, 99.5])
        if hi <= lo:
            hi = lo + 1.0
        edges = np.linspace(lo, hi, N_HIST_BINS + 1)
        h_lmc, _ = np.histogram(np.clip(v[lmc], lo, hi), bins=edges)
        h_mw, _ = np.histogram(np.clip(v[mw], lo, hi), bins=edges)

        # Normalise each class to its own peak so the rarer class stays visible.
        label, blurb = FEATURE_META.get(name, (name, ""))
        out.append({
            "name": name,
            "label": label,
            "blurb": blurb,
            "lo": round(float(lo), 4),
            "hi": round(float(hi), 4),
            "lmc": [round(float(c) / max(h_lmc.max(), 1), 4) for c in h_lmc],
            "mw": [round(float(c) / max(h_mw.max(), 1), 4) for c in h_mw],
            # How far apart the two class means sit, in pooled standard deviations.
            # A blunt but honest one-number summary of separating power.
            "cohensD": round(float(
                abs(v[lmc].mean() - v[mw].mean())
                / np.sqrt((v[lmc].var() + v[mw].var()) / 2 + 1e-12)
            ), 4),
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="registry name or directory")
    ap.add_argument("--out", default="analysis.json", help="filename under web/public/data/")
    ap.add_argument("--allow-reference", action="store_true",
                    help="permit the prior-art model in reference/outputs/")
    args = ap.parse_args()

    print("loading...")
    df = lmc.load_sim(verbose=True)

    model_dir, clf, features = models.load(args.model, allow_reference=args.allow_reference)
    calibrator = models.load_calibrator(model_dir)
    print(f"  model: {model_dir.relative_to(ROOT)}  ({len(features)} features)"
          f"{'  + isotonic calibration' if calibrator is not None else '  (uncalibrated)'}")

    X = df.select(features).to_numpy().astype(np.float32)
    y = df["Type"].to_numpy()

    # Load the notebook's split rather than re-deriving it. load_split verifies a
    # hash of the labels, so a cleaning change fails here instead of silently
    # turning the "held-out" set into an arbitrary subset.
    _, test_idx = load_split(model_dir / "split.npz", y)
    print(f"  held-out test set: {len(test_idx):,} stars ({y[test_idx].mean():.1%} LMC)")

    y_te = y[test_idx]
    prob_te = clf.predict_proba(X[test_idx])[:, 1]
    if calibrator is not None:
        prob_te = calibrator.predict(prob_te)

    print("sweeping thresholds...")
    sweep = sweep_thresholds(y_te, prob_te)

    print("curves + importances...")
    fpr, tpr, _ = roc_curve(y_te, prob_te)
    prec, rec, _ = precision_recall_curve(y_te, prob_te)

    imp = clf.feature_importances_
    importances = sorted(
        [
            {
                "name": f,
                "label": FEATURE_META.get(f, (f, ""))[0],
                "blurb": FEATURE_META.get(f, (f, ""))[1],
                "value": round(float(v), 5),
            }
            for f, v in zip(features, imp)
        ],
        key=lambda d: -d["value"],
    )

    # Two separate reasons a column can be missing, and the UI should say which.
    # Position was excluded from the start (notebook 02); the scale-carrying columns
    # were removed only after real Gaia data showed what they cost (notebooks 04-05).
    SCALE_CARRYING = ["pmra_error", "pmdec_error", "parallax_error", "parallax",
                      "phot_g_mean_mag", "phot_bp_mean_mag", "phot_rp_mean_mag", "bp_rp"]
    dropped_scale = [f for f in SCALE_CARRYING if f not in features]
    excluded = ["ra", "dec"] + dropped_scale

    reasons = [
        "The LMC occupies a hard rectangular box in this simulated field "
        "(RA 67.3-94.0, Dec -72.5 to -65.2), so a model given sky position would "
        "memorise that box and score near-perfectly while learning no astrophysics."
    ]
    if dropped_scale:
        reasons.append(
            "The measurement errors and magnitudes were dropped after real Gaia stars "
            "exposed what they cost: the simulated LMC is faint and kinematically frozen, "
            "so 'bright and precisely measured' means foreground in training and does not "
            "in the sky. Keeping them scored PR-AUC 0.9992 on simulation and recovered "
            "24% of real Cepheids; dropping them recovers 96%."
        )

    print("histograms...")
    # On the test split too. These used to be computed on the full dataframe, which
    # contradicted this module's own "held-out only" claim — a small inconsistency,
    # but the whole point of the file is that its numbers can be trusted.
    hists = feature_histograms(df[test_idx], features, y_te)

    analysis = {
        "model": {
            "name": model_dir.name,
            "kind": "XGBoost",
            "nEstimators": int(getattr(clf, "n_estimators", 0)),
            "maxDepth": int(getattr(clf, "max_depth", 0)),
            "scalePosWeight": round(float(getattr(clf, "scale_pos_weight", 0.0)), 3),
            "features": features,
            "calibrated": calibrator is not None,
            "excluded": excluded,
            "excludedReason": " ".join(reasons),
        },
        "dataset": {
            "totalRows": int(len(y)),
            "testRows": int(len(test_idx)),
            "lmcFraction": round(float(y.mean()), 4),
            "corruptedRowsDropped": int(lmc.fingerprint().get("rows_dropped", 0)),
        },
        "headline": {
            "rocAuc": round(float(roc_auc_score(y_te, prob_te)), 5),
            "prAuc": round(float(average_precision_score(y_te, prob_te)), 5),
        },
        "sweep": sweep,
        "roc": downsample_curve(fpr, tpr),
        "pr": downsample_curve(rec, prec),
        "importances": importances,
        "histograms": hists,
    }

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA / args.out
    out.write_text(json.dumps(analysis, separators=(",", ":")))
    print(f"\nwrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} KB)")

    # Echo the operating-point numbers so they can be checked against the notebook.
    i = sweep["thresholds"].index(0.5)
    tp, fp, tn, fn = sweep["tp"][i], sweep["fp"][i], sweep["tn"][i], sweep["fn"][i]
    print(f"\n  at threshold 0.50 (held-out):")
    print(f"    LMC recall    {tp/(tp+fn):.4f}")
    print(f"    LMC precision {tp/(tp+fp):.4f}")
    print(f"    MW contamination {fp/(fp+tn):.4f}")
    print(f"    ROC-AUC {analysis['headline']['rocAuc']:.4f}  PR-AUC {analysis['headline']['prAuc']:.4f}")


if __name__ == "__main__":
    main()
