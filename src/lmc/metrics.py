"""Metrics used in more than one notebook.

Each of these is *derived from scratch* the first time it appears -- notebook 03 for
the Wilson interval and average precision, notebook 05 for the Brier decomposition.
This module is where they live afterwards, so notebooks 04-06 can call them without
re-explaining. If you are reading the project to learn, read the derivation in the
notebook first; this file is the tidied-up version.
"""

from __future__ import annotations

import numpy as np


def wilson_ci(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    r"""95% confidence interval for a proportion, the Wilson way.

    Every real-sky recall in this project is "k of n stars recovered" -- 4,475
    Cepheids, 21,926 RR Lyrae -- and quoting 97.16% with no interval invites the
    obvious question. The textbook interval :math:`\hat p \pm z\sqrt{\hat p(1-\hat p)/n}`
    is the wrong tool here: at recalls near 1 it runs past 100%, and at the 23%
    figure with small subsamples it is badly off-centre.

    Wilson inverts the score test instead -- it asks which values of :math:`p` would
    *not* have been rejected by the data -- giving

    .. math::
        \frac{\hat p + z^2/2n \pm z\sqrt{\hat p(1-\hat p)/n + z^2/4n^2}}{1 + z^2/n}

    which stays inside [0, 1] by construction.
    """
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    half = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def fmt_recall(k: int, n: int) -> str:
    """`97.16% [96.62, 97.62]  (4348/4475)` -- the only format recall is quoted in."""
    lo, hi = wilson_ci(k, n)
    return f"{100*k/n:6.2f}% [{100*lo:5.2f}, {100*hi:5.2f}]  ({k:,}/{n:,})"


def average_precision(y_true: np.ndarray, score: np.ndarray) -> float:
    r"""Area under the precision-recall curve, as a step-wise sum.

    .. math:: \mathrm{AP} = \sum_n (R_n - R_{n-1}) P_n

    Under this project's 78/22 imbalance, ROC-AUC is the misleading summary: it
    normalises the false-positive count by the 198k negatives, so a thousand
    contaminants barely move it. Precision does not have that luxury -- it divides
    by the number of stars you actually claimed. Notebook 03 shows a model with
    ROC-AUC 0.99 and 60% purity to make the point concrete.
    """
    order = np.argsort(-np.asarray(score), kind="stable")
    y = np.asarray(y_true)[order]
    s = np.asarray(score)[order]

    # Stars with identical scores cannot be separated by any threshold, so they
    # must be counted as one step. Ignoring this inflates AP whenever scores tie --
    # and a saturated classifier ties a great many predictions at exactly 1.0.
    cut = np.r_[np.flatnonzero(np.diff(s)), len(y) - 1]

    tp = np.cumsum(y)[cut]
    fp = np.cumsum(1 - y)[cut]
    precision = tp / np.maximum(tp + fp, 1)
    recall = tp / max(y.sum(), 1)
    return float(np.sum(np.diff(np.r_[0.0, recall]) * precision))


def sweep_thresholds(y_true: np.ndarray, prob: np.ndarray, n: int = 101) -> dict:
    """Confusion counts across the full threshold range, for the web app's slider."""
    thresholds = np.linspace(0.0, 1.0, n)
    y = np.asarray(y_true).astype(bool)
    out = {"thresholds": thresholds, "tp": [], "fp": [], "tn": [], "fn": []}
    for t in thresholds:
        pred = prob >= t
        out["tp"].append(int((pred & y).sum()))
        out["fp"].append(int((pred & ~y).sum()))
        out["tn"].append(int((~pred & ~y).sum()))
        out["fn"].append(int((~pred & y).sum()))
    return out


def recall_at(y_true: np.ndarray, prob: np.ndarray, threshold: float = 0.5) -> float:
    y = np.asarray(y_true).astype(bool)
    return float(((prob >= threshold) & y).sum() / max(y.sum(), 1))


def purity_at(y_true: np.ndarray, prob: np.ndarray, threshold: float = 0.5) -> float:
    """Precision, named the way astronomers name it: what fraction of the sample is real.

    Undefined on the real catalogues, which contain no negatives. Notebook 03 says
    this once and the project never quotes a purity figure on real data again.
    """
    y = np.asarray(y_true).astype(bool)
    pred = prob >= threshold
    return float((pred & y).sum() / max(pred.sum(), 1))


def brier_decomposition(y_true: np.ndarray, prob: np.ndarray, n_bins: int = 20) -> dict:
    r"""Murphy's three-way split of the Brier score.

    .. math:: \mathrm{BS} = \underbrace{\mathbb{E}[(p - \bar y_p)^2]}_{\text{reliability}}
                          - \underbrace{\mathbb{E}[(\bar y_p - \bar y)^2]}_{\text{resolution}}
                          + \underbrace{\bar y (1 - \bar y)}_{\text{uncertainty}}

    Reliability is calibration error -- how far the predicted probability sits from
    the observed frequency -- and it is the only term a calibrator can move.
    Resolution rewards spreading predictions away from the base rate; uncertainty is
    a property of the data alone. This matters here because `scale_pos_weight=3.58`
    deliberately biases the model's output upward, so the number the web app prints
    under a slider labelled "P(LMC)" is systematically too high until it is fixed.

    One detail every textbook statement of this glosses over: the identity above is
    exact only for forecasts taking **finitely many distinct values**, so that each
    bin holds one forecast repeated. Bin a continuous score into 20 buckets and the
    three terms no longer sum to the Brier score, because reliability and resolution
    both see only the bin's *mean* forecast. The gap is the extra cost of the actual
    spread inside each bin,

    .. math:: \mathrm{BS} = \mathrm{REL} - \mathrm{RES} + \mathrm{UNC}
              + \underbrace{\sum_k w_k\big(\mathbb{E}_k[(p-y)^2]
                                         - \mathbb{E}_k[(\bar p_k-y)^2]\big)}_{\texttt{binning}}

    i.e. how much better the individual forecasts do than their own bin average
    would have. It is a property of the histogram, not of the model, and it shrinks
    as bins narrow. Returning it keeps the identity exact to machine precision
    instead of quietly off by a few parts in a thousand.
    """
    y = np.asarray(y_true).astype(float)
    prob = np.asarray(prob, dtype=float)
    base = y.mean()
    brier = float(np.mean((prob - y) ** 2))

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    which = np.clip(np.digitize(prob, edges[1:-1]), 0, n_bins - 1)

    reliability = resolution = binning = 0.0
    bins = []
    for b in range(n_bins):
        m = which == b
        if not m.any():
            continue
        w = m.sum() / len(y)
        p_mean, y_mean = float(prob[m].mean()), float(y[m].mean())
        reliability += w * (p_mean - y_mean) ** 2
        resolution += w * (y_mean - base) ** 2
        binning += w * float(np.mean((prob[m] - y[m]) ** 2) - np.mean((p_mean - y[m]) ** 2))
        bins.append({"n": int(m.sum()), "p_mean": p_mean, "y_mean": y_mean})

    return {
        "brier": brier,
        "reliability": reliability,
        "resolution": resolution,
        "uncertainty": float(base * (1 - base)),
        "binning": binning,
        "bins": bins,
    }
