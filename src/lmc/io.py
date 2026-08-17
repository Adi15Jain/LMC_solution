"""Loading the two datasets this project lives on, and the cache that sits between.

There are two, and they are not the same kind of thing:

    simulated   data/LMC+MW_GOG_trainingset_frac=0.2.csv     1.27M rows, labelled
                Gaia Object Generator output. Has both classes, so it can train.

    real        data/xm_{cepheids,rrlyrae}_LMC-result.csv    26.5k rows, positives only
                Actual Gaia EDR3 astrometry for confirmed LMC variable stars.
                Every row is an LMC member, so it can measure recall and nothing else.

The whole project is about the gap between them, so the loaders live side by side
here and every downstream notebook uses these and only these.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import polars as pl

from lmc.features import add_derived

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
PROCESSED = DATA / "processed"

TRAIN_CSV = DATA / "LMC+MW_GOG_trainingset_frac=0.2.csv"
TRAIN_PARQUET = PROCESSED / "train_clean.parquet"
FINGERPRINT = PROCESSED / "fingerprint.json"

REAL_CSV = {
    "cepheid": DATA / "xm_cepheids_LMC-result.csv",
    "rrlyrae": DATA / "xm_rrlyrae_LMC-result.csv",
}
REAL_PARQUET = PROCESSED / "real_lmc.parquet"

# The 11 physical columns the simulation provides. The real Gaia files carry 99
# columns; these are the ones both sides share, and the only ones a model may see.
SIM_COLUMNS = [
    "ra", "dec",
    "pmra", "pmra_error", "pmdec", "pmdec_error",
    "parallax", "parallax_error",
    "phot_g_mean_mag", "phot_bp_mean_mag", "phot_rp_mean_mag",
]

# Real-only columns. Never model inputs — the simulation has no counterpart, so a
# model trained on them could not be applied to the training distribution at all.
# They exist to *explain* failures in notebook 06.
QUALITY_COLUMNS = [
    "ruwe",
    "astrometric_excess_noise",
    "astrometric_excess_noise_sig",
    "astrometric_gof_al",
    "visibility_periods_used",
    "astrometric_sigma5d_max",
    "parallax_over_error",
]


def strip_headers(df: pl.DataFrame) -> pl.DataFrame:
    """Remove padding from column names.

    `xm_rrlyrae_LMC-result.csv` was saved with its header aligned into columns, so
    roughly a dozen names arrive with leading spaces -- including `parallax_error`,
    which is a model feature. The Cepheid file is clean, so a naive load gives the
    two catalogues *different* schemas and the bug surfaces as a KeyError halfway
    through an analysis rather than at load time.
    """
    return df.rename({c: c.strip() for c in df.columns})


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def clean_sim(df: pl.DataFrame, verbose: bool = True) -> pl.DataFrame:
    """Coerce every column to a number and drop what will not coerce.

    Row 11 holds `pmra = "1.8598455n11059828"` -- a stray `n` where an exponent
    marker belongs. Polars types a column by scanning it, so that one character
    makes the *entire* pmra column a string, and every arithmetic operation
    downstream either throws or silently does something else. Casting with
    strict=False turns unparseable values into nulls so a single drop_nulls
    removes exactly the damaged row.
    """
    numeric = [c for c in df.columns if c != "Type"]
    df = df.with_columns([pl.col(c).cast(pl.Float64, strict=False) for c in numeric])
    before = df.height
    df = df.drop_nulls(subset=numeric)
    if verbose:
        print(f"  dropped {before - df.height} corrupted row(s) -> {df.height:,} clean rows")
    return df


def build_cache(verbose: bool = True) -> pl.DataFrame:
    """Parse the 251 MB CSV once, clean it, and write it as parquet.

    Notebooks 02, 04 and 05 and both export scripts all need the same cleaned
    frame. Re-parsing the CSV in each takes ~15 s and, worse, invites the cleaning
    step to drift between them. Parquet reloads in well under a second and there is
    exactly one definition of "clean".

    The fingerprint records what the cache was built from, so a downstream artifact
    can prove which bytes it came from.
    """
    PROCESSED.mkdir(parents=True, exist_ok=True)

    if verbose:
        print(f"reading {TRAIN_CSV.name} ...")
    raw = pl.read_csv(TRAIN_CSV)
    n_raw = raw.height
    df = add_derived(clean_sim(raw, verbose=verbose))
    df.write_parquet(TRAIN_PARQUET, compression="zstd")

    FINGERPRINT.write_text(json.dumps({
        "source": TRAIN_CSV.name,
        "source_sha256": _sha256(TRAIN_CSV),
        "rows_raw": n_raw,
        "rows_clean": df.height,
        "rows_dropped": n_raw - df.height,
        "columns": df.columns,
    }, indent=2))

    if verbose:
        size = TRAIN_PARQUET.stat().st_size / 1e6
        print(f"  wrote {TRAIN_PARQUET.relative_to(ROOT)}  ({df.height:,} rows, {size:.1f} MB)")
        print(f"  wrote {FINGERPRINT.relative_to(ROOT)}")
    return df


def load_sim(verbose: bool = False) -> pl.DataFrame:
    """The cleaned simulated training set, with pm_total and bp_rp already present.

    Builds the cache on first use so a fresh clone works without a separate step.
    """
    if not TRAIN_PARQUET.exists():
        return build_cache(verbose=True)
    df = pl.read_parquet(TRAIN_PARQUET)
    if verbose:
        print(f"  loaded {df.height:,} rows from {TRAIN_PARQUET.relative_to(ROOT)}")
    return df


def fingerprint() -> dict:
    """What the parquet cache was built from. Stamped into every model artifact."""
    return json.loads(FINGERPRINT.read_text()) if FINGERPRINT.exists() else {}


def load_real_catalogue(name: str, verbose: bool = False) -> pl.DataFrame:
    """One real Gaia catalogue, reduced to the simulation's schema plus quality flags.

    Returns every row -- including those with missing astrometry or photometry --
    flagged rather than dropped, because the count of unusable rows is a number
    notebook 03 has to report, not hide. Filter on `astrometry_ok` before scoring.
    """
    path = REAL_CSV[name]
    df = strip_headers(pl.read_csv(path, infer_schema_length=20_000, ignore_errors=True))

    keep = ["source_id"] + SIM_COLUMNS + QUALITY_COLUMNS
    df = df.select([c for c in keep if c in df.columns])
    numeric = [c for c in df.columns if c != "source_id"]
    df = df.with_columns([pl.col(c).cast(pl.Float64, strict=False) for c in numeric])
    df = add_derived(df)

    astro = ["pmra", "pmdec", "pmra_error", "pmdec_error", "parallax", "parallax_error"]
    photo = ["phot_g_mean_mag", "phot_bp_mean_mag", "phot_rp_mean_mag"]
    df = df.with_columns([
        pl.lit(name).alias("catalogue"),
        pl.all_horizontal([pl.col(c).is_not_null() for c in astro]).alias("astrometry_ok"),
        pl.all_horizontal([pl.col(c).is_not_null() for c in photo]).alias("photometry_ok"),
    ])

    if verbose:
        bad_a = df.height - int(df["astrometry_ok"].sum())
        bad_p = df.height - int(df["photometry_ok"].sum())
        print(f"  {name:<8} {df.height:,} rows   "
              f"{bad_a} without astrometry, {bad_p} without photometry")
    return df


def load_real(verbose: bool = False) -> pl.DataFrame:
    """Both real catalogues, concatenated, with a `catalogue` column to tell them apart."""
    if REAL_PARQUET.exists():
        df = pl.read_parquet(REAL_PARQUET)
        if verbose:
            print(f"  loaded {df.height:,} rows from {REAL_PARQUET.relative_to(ROOT)}")
        return df
    return pl.concat([load_real_catalogue(n, verbose=verbose) for n in REAL_CSV])
