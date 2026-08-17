"""Shared plumbing for the LMC / Milky Way classification notebooks.

The rule this package follows: **if a reader would learn something from reading it,
it stays in the notebook; if a reader would only be annoyed by it, it lives here.**

So loading, cleaning, splitting and the metric formulas that have already been
derived once live in this package -- imported identically by the notebooks and by
the export scripts, so the numbers on the website cannot drift from the numbers in
the analysis. Every model, every `.fit()`, every ablation and every derivation stays
written out in the notebook where it can be read.
"""

from lmc.features import FEATURE_SETS, add_derived, pm_chi2
from lmc.io import (
    build_cache,
    fingerprint,
    load_real,
    load_real_catalogue,
    load_sim,
    strip_headers,
)
from lmc.metrics import (
    average_precision,
    brier_decomposition,
    fmt_recall,
    purity_at,
    recall_at,
    sweep_thresholds,
    wilson_ci,
)
from lmc.split import SEED, load_split, make_dev_lock, make_split, save_split

__all__ = [
    "FEATURE_SETS", "add_derived", "pm_chi2",
    "build_cache", "fingerprint", "load_real", "load_real_catalogue", "load_sim",
    "strip_headers",
    "average_precision", "brier_decomposition", "fmt_recall", "purity_at",
    "recall_at", "sweep_thresholds", "wilson_ci",
    "SEED", "load_split", "make_dev_lock", "make_split", "save_split",
]
