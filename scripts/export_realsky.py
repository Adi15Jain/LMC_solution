#!/usr/bin/env python3
"""
Export the real-sky validation for the web app's Act 8.

This is the act that separates the project from a Kaggle notebook: 4,485 Cepheids and
22,006 RR Lyrae from actual Gaia EDR3, confirmed as LMC members by variability -- a
method sharing no feature with the model. v1 recovers 24% of the Cepheids. v2
recovers 96%.

Reads:
    data/processed/real_lmc.parquet   written by notebook 03 (dev/lock split included)
    outputs/v1_baseline/, outputs/v2_robust/

Writes:
    web/public/data/realsky.json

Every headline number here comes from the LOCK half -- the stars no design decision in
notebooks 03-05 was allowed to see. Dev figures are included alongside, labelled, so
the page can show that the two agree.

Usage:
    python scripts/export_realsky.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import polars as pl
from scipy import stats

import lmc
from lmc import models
from lmc.metrics import wilson_ci
from lmc.split import SEED

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "public" / "data"
REAL = ROOT / "data" / "processed" / "real_lmc.parquet"

# Enough to draw a convincing proper-motion scatter without shipping megabytes.
MAX_STARS = 12_000

CATALOGUE_LABEL = {
    "cepheid": "Classical Cepheids",
    "rrlyrae": "RR Lyrae",
}


def catalogue_block(frame, name, p1, p2, t2):
    """Recall for both models, per split half, with intervals."""
    out = {"name": name, "label": CATALOGUE_LABEL[name]}
    for half in ("lock", "dev"):
        m = (frame["split"] == half).to_numpy()
        n = int(m.sum())
        k1 = int((p1[m] >= 0.5).sum())
        k2 = int((p2[m] >= t2).sum())
        out[half] = {
            "n": n,
            "v1": {"k": k1, "recall": round(k1 / n, 4),
                   "ci95": [round(v, 4) for v in wilson_ci(k1, n)]},
            "v2": {"k": k2, "recall": round(k2 / n, 4),
                   "ci95": [round(v, 4) for v in wilson_ci(k2, n)]},
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.27,
                    help="v2 operating point, chosen in notebook 06 on dev")
    args = ap.parse_args()

    if not REAL.exists():
        raise SystemExit(f"{REAL} not found — run notebook 03 first.")

    print("loading...")
    sim = lmc.load_sim(verbose=True)
    real = pl.read_parquet(REAL)

    n_total = real.height
    scoreable = real.filter(pl.col("astrometry_ok") & pl.col("photometry_ok"))
    n_dropped = n_total - scoreable.height
    print(f"  real: {n_total:,} rows, {n_dropped:,} unusable "
          f"(no astrometric or photometric solution), {scoreable.height:,} scored")

    _, clf1, F1 = models.load("v1_baseline")
    dir2, clf2, F2 = models.load("v2_robust")
    calib2 = models.load_calibrator(dir2)

    p1 = models.predict(clf1, F1, scoreable)
    p2 = models.predict(clf2, F2, scoreable, calib2)

    catalogues = []
    for name in ("cepheid", "rrlyrae"):
        m = (scoreable["catalogue"] == name).to_numpy()
        sub = scoreable.filter(pl.col("catalogue") == name)
        raw_n = int((real["catalogue"] == name).sum())
        block = catalogue_block(sub, name, p1[m], p2[m], args.threshold)
        block["nRaw"] = raw_n
        block["nDropped"] = raw_n - sub.height
        catalogues.append(block)
        print(f"  {name:<9} lock: v1 {100*block['lock']['v1']['recall']:5.2f}%   "
              f"v2 {100*block['lock']['v2']['recall']:5.2f}%")

    # ---- the covariate shift, per feature, as the diagnosis panel -----------
    simL = sim.filter(pl.col("Type") == 1)
    rng = np.random.default_rng(SEED)
    sub_idx = rng.choice(simL.height, 20_000, replace=False)

    shift = []
    for f in F1:
        a = simL[f].to_numpy()[sub_idx]
        row = {"name": f, "simMedian": round(float(np.median(simL[f].to_numpy())), 4),
               "inV2": f in F2}
        for name in ("cepheid", "rrlyrae"):
            b = scoreable.filter(pl.col("catalogue") == name)[f].to_numpy()
            row[name] = {"ks": round(float(stats.ks_2samp(a, b).statistic), 4),
                         "median": round(float(np.median(b)), 4)}
        shift.append(row)
    shift.sort(key=lambda r: -r["cepheid"]["ks"])

    # ---- the stars themselves, for the scatter plot -------------------------
    take = np.arange(scoreable.height)
    if len(take) > MAX_STARS:
        take = np.sort(rng.choice(take, MAX_STARS, replace=False))

    s = scoreable[take]
    stars = {
        "columns": ["pmra", "pmdec", "gmag", "bpRp", "pV1", "pV2", "isCepheid", "isLock"],
        "count": len(take),
        "sampledFrom": scoreable.height,
        "data": [
            [round(float(v), 3) for v in s["pmra"]],
            [round(float(v), 3) for v in s["pmdec"]],
            [round(float(v), 2) for v in s["phot_g_mean_mag"]],
            [round(float(v), 3) for v in s["bp_rp"]],
            [round(float(v), 3) for v in p1[take]],
            [round(float(v), 3) for v in p2[take]],
            [int(v == "cepheid") for v in s["catalogue"]],
            [int(v == "lock") for v in s["split"]],
        ],
    }

    # ---- the ceiling: stars whose own astrometry contradicts the label ------
    pm_ref = json.loads((dir2 / "pm_reference.json").read_text())
    mu_ra, mu_dec, s_int = pm_ref["mu_pmra"], pm_ref["mu_pmdec"], pm_ref["s_intrinsic_real_dev"]
    crit = float(stats.chi2(2).ppf(0.99))

    ceiling = {"chi2Critical": round(crit, 3), "sIntrinsicReal": round(s_int, 4),
               "sIntrinsicSimulated": pm_ref["s_intrinsic_simulated"]}
    for name in ("cepheid", "rrlyrae"):
        f = scoreable.filter(pl.col("catalogue") == name)
        c2 = lmc.pm_chi2(f["pmra"].to_numpy(), f["pmdec"].to_numpy(),
                         f["pmra_error"].to_numpy(), f["pmdec_error"].to_numpy(),
                         mu_ra, mu_dec, s_int)
        ceiling[name] = {"inconsistentFraction": round(float((c2 > crit).mean()), 4)}

    payload = {
        "threshold": args.threshold,
        "thresholdNote": ("v2 operating point, chosen in notebook 06 on the simulated test "
                          "split and the dev half. v1 is shown at its default 0.5; it has no "
                          "calibrator, so its scores are inflated by scale_pos_weight."),
        "protocol": ("The real catalogues were halved into dev and lock, stratified on G "
                     "magnitude, before any measurement. Every design decision used dev only. "
                     "Lock was opened once, in notebook 06."),
        "positivesOnly": ("These catalogues contain confirmed LMC members and nothing else, so "
                          "recall is measurable and purity is not. No purity figure on this page "
                          "comes from real data."),
        "dropped": {"n": n_dropped, "reason": "no astrometric or photometric solution in EDR3"},
        "catalogues": catalogues,
        "shift": shift,
        "stars": stars,
        "ceiling": ceiling,
    }

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA / "realsky.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"\nwrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e3:.0f} KB, "
          f"{stars['count']:,} stars)")


if __name__ == "__main__":
    main()
