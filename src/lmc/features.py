"""Feature construction, and the candidate feature sets the notebooks compare.

The central lesson of this project lives in this file. Notebook 02's model scored
PR-AUC 0.9992 on simulated data and 23% recall on real Gaia stars, because three of
its eleven features -- `pmra_error`, `pmdec_error`, `parallax_error` -- carry an
absolute scale that the simulation and the real sky do not share. Simulated LMC
stars are faint, so their errors are large; real Cepheids are bright, so theirs are
tiny, and a tree that has never seen a value that small cannot do anything sensible
with one.

The fix is not to delete the errors. It is to divide by them.
"""

from __future__ import annotations

import numpy as np
import polars as pl


def add_derived(df: pl.DataFrame) -> pl.DataFrame:
    """Arithmetic on existing columns, defined once for both domains.

    `pm_total`  magnitude of the proper-motion vector, in mas/yr.
    `bp_rp`     Gaia's colour index, blue minus red. A temperature proxy.
    `plx_snr`   parallax divided by its own error -- dimensionless, and therefore
                the one distance-related quantity that means the same thing in the
                simulation and in EDR3. (Gaia publishes this as
                `parallax_over_error`; recomputing it keeps the definition
                identical on both sides.)
    """
    return df.with_columns([
        (pl.col("pmra") ** 2 + pl.col("pmdec") ** 2).sqrt().alias("pm_total"),
        (pl.col("phot_bp_mean_mag") - pl.col("phot_rp_mean_mag")).alias("bp_rp"),
        (pl.col("parallax") / pl.col("parallax_error")).alias("plx_snr"),
    ])


def pm_chi2(
    pmra: np.ndarray,
    pmdec: np.ndarray,
    pmra_error: np.ndarray,
    pmdec_error: np.ndarray,
    mu_ra: float,
    mu_dec: float,
    s: float,
) -> np.ndarray:
    r"""Squared distance from the LMC's bulk motion, in units of each star's own error.

    For a star whose true motion is the LMC's mean :math:`(\mu_\alpha, \mu_\delta)`,
    the measured value scatters for two independent reasons: the galaxy's own
    internal velocity spread :math:`s`, and Gaia's measurement error
    :math:`\sigma`. Two independent Gaussians convolve into one with

    .. math:: \sigma_{\rm tot}^2 = s^2 + \sigma^2

    so the natural distance measure is

    .. math::
        \chi^2 = \frac{(\mu_\alpha^* - \mu_\alpha)^2}{\sigma_{\alpha}^2 + s^2}
               + \frac{(\mu_\delta^* - \mu_\delta)^2}{\sigma_{\delta}^2 + s^2}

    which is distributed as :math:`\chi^2` with 2 degrees of freedom if the star
    really is a member and :math:`s` is right.

    Why this transfers when raw errors do not: it is **dimensionless**. A Cepheid
    with :math:`\sigma = 0.039` and a simulated star with :math:`\sigma = 0.191`
    land at the same value if each is equally consistent with the clump. There is
    no absolute scale left for a tree to extrapolate past.

    `s` is a physical property of the LMC, not a hyperparameter -- notebook 05 fits
    it by requiring the resulting distribution to actually be :math:`\chi^2(2)`.
    """
    va = pmra_error ** 2 + s ** 2
    vd = pmdec_error ** 2 + s ** 2
    return (pmra - mu_ra) ** 2 / va + (pmdec - mu_dec) ** 2 / vd


# ---------------------------------------------------------------------------
# Candidate feature sets.
#
# `v1` is what notebook 02 trained. Everything else is a hypothesis that notebooks
# 04 and 05 test on the `dev` half of the real data. Which one becomes v2 is
# decided there, by measurement -- not here, by assertion.
# ---------------------------------------------------------------------------

FEATURE_SETS: dict[str, list[str]] = {
    # The baseline. Three raw error columns; those are the ones that break it.
    "v1": [
        "pmra", "pmdec", "pm_total",
        "parallax",
        "pmra_error", "pmdec_error", "parallax_error",
        "phot_g_mean_mag", "phot_bp_mean_mag", "phot_rp_mean_mag", "bp_rp",
    ],
    # Diagnostic ablations from notebook 04: strip one group at a time and watch
    # which removal is the one that recovers real-sky recall.
    "kinematics_errors": [
        "pmra", "pmdec", "pm_total", "parallax",
        "pmra_error", "pmdec_error", "parallax_error",
    ],
    "motion_parallax": ["pmra", "pmdec", "pm_total", "parallax"],
    "motion_only": ["pmra", "pmdec", "pm_total"],
    # The proposal: every input is either a physical value on a scale both domains
    # share, or a ratio. `pm_chi2` needs mu and s, so it is added by the notebook.
    "v2": ["pmra", "pmdec", "pm_chi2", "plx_snr", "bp_rp", "phot_g_mean_mag"],
    # ...and the same thing without apparent magnitude. G is itself shifted -- the
    # simulated LMC's median is 18.98 against the Cepheids' 15.90 -- so it is a
    # candidate for the same failure as the error columns, and notebook 05 has to
    # check rather than assume.
    "v2_no_gmag": ["pmra", "pmdec", "pm_chi2", "plx_snr", "bp_rp"],
}
