"""Train/test splitting, saved rather than re-derived.

The subtle bug this module exists to prevent: `export_web_data.py` and
`export_analysis.py` used to call `train_test_split(...)` again with the same seed
and assume they had reproduced the notebook's held-out set. That is true only while
the row count *and* the label ordering are byte-identical to what the notebook saw.
Change the cleaning step -- decide differently about a null column, say -- and the
web app's "held-out" overlay quietly becomes an arbitrary subset while every number
on screen still looks plausible.

So the split is written to disk with a hash of the labels it was built from, and
loading it verifies that hash. A silent lie becomes a stack trace.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
from sklearn.model_selection import train_test_split

SEED = 42
TEST_SIZE = 0.2


def label_hash(y: np.ndarray) -> str:
    """Fingerprint of a label vector: its length, order and values together."""
    return hashlib.sha256(np.ascontiguousarray(y, dtype=np.int64).tobytes()).hexdigest()


def make_split(y: np.ndarray, test_size: float = TEST_SIZE, seed: int = SEED):
    """Stratified split on *indices*, so the result can be saved and reused.

    Splitting the arrays directly (as the reference notebook does) throws away
    which rows went where, and there is then no way to point the web exporter at
    the same held-out set.
    """
    idx = np.arange(len(y))
    return train_test_split(idx, test_size=test_size, stratify=y, random_state=seed)


def save_split(path: Path, train_idx, test_idx, y: np.ndarray, seed: int = SEED) -> None:
    """Write the split next to the model that was trained on it.

    Only the held-out indices are stored -- training rows are everything else, so
    saving both doubles a file that is committed to the repo rather than gitignored
    like the model weights. int32 because row indices top out near 1.3M.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        test_idx=np.asarray(test_idx, dtype=np.int32),
        seed=seed,
        n_rows=len(y),
        y_sha256=label_hash(y),
    )


def load_split(path: Path, y: np.ndarray | None = None):
    """Load a saved split, verifying it matches the labels you are about to use.

    Pass `y` whenever you have it. Skipping the check is how the divergence this
    module guards against gets reintroduced.

    Note the returned `train_idx` is *sorted*, since it is reconstructed as the
    complement of the held-out rows, whereas `make_split` returns it shuffled. That
    is irrelevant for scoring, but row order does feed XGBoost's `subsample`, so
    retrain from `make_split` rather than from here if you need bit-identical
    weights.
    """
    z = np.load(path, allow_pickle=False)
    if y is not None:
        assert_compatible(z, y, path)
    test_idx = z["test_idx"]
    train_idx = np.setdiff1d(np.arange(int(z["n_rows"]), dtype=np.int32), test_idx)
    return train_idx, test_idx


def assert_compatible(z, y: np.ndarray, path: Path | str = "split.npz") -> None:
    n_rows = int(z["n_rows"])
    if len(y) != n_rows:
        raise SystemExit(
            f"{path} was built on {n_rows:,} rows but you have {len(y):,}. "
            "The cleaning step changed -- retrain, do not reuse this split."
        )
    saved = str(z["y_sha256"])
    actual = label_hash(y)
    if saved != actual:
        raise SystemExit(
            f"{path} label hash mismatch ({saved[:12]} vs {actual[:12]}). "
            "Same row count, different rows or ordering -- retrain."
        )


def make_dev_lock(g_mag: np.ndarray, seed: int = SEED) -> np.ndarray:
    """Halve the real catalogues into `dev` and `lock`, stratified on brightness.

    Choosing a feature set by watching real-sky recall -- which is exactly what the
    ablation in notebook 04 does -- turns that recall into a training number. `lock`
    is not looked at until notebook 06, and it is the only source of a headline
    figure.

    Stratifying on G matters because faintness is the dominant driver of failure:
    an unstratified half could differ in median magnitude by enough to move recall
    by several points on its own.
    """
    n = len(g_mag)
    # Deciles of brightness, with non-finite magnitudes as their own stratum so the
    # rows without photometry are split evenly too rather than landing in one half.
    finite = np.isfinite(g_mag)
    strata = np.full(n, -1, dtype=np.int64)
    if finite.any():
        edges = np.quantile(g_mag[finite], np.linspace(0, 1, 11)[1:-1])
        strata[finite] = np.searchsorted(edges, g_mag[finite])

    idx = np.arange(n)
    dev_idx, _ = train_test_split(idx, test_size=0.5, stratify=strata, random_state=seed)
    split = np.full(n, "lock", dtype=object)
    split[dev_idx] = "dev"
    return split
