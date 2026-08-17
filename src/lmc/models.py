"""Finding and loading a trained model, without guessing filenames.

`outputs/MODELS.json` is written by whichever notebook trained the model. Every
consumer -- the export scripts, notebooks 03-06 -- resolves through here, so adding
a model is one registry entry rather than an edit in five places.

This replaces a fallback that used to silently substitute `reference/outputs/` when
`outputs/` was empty. That directory holds a *different feature set*, and since
`outputs/*.joblib` is gitignored, a fresh clone hit that path on the first run and
published metrics from a model nobody in this project trained, announced by one line
of console output. Now it is an error, and `--allow-reference` is an explicit choice.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = ROOT / "outputs"
REGISTRY = OUTPUTS / "MODELS.json"


def registry() -> dict:
    return json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {}


def resolve_dir(name: str | Path | None = None, allow_reference: bool = False) -> Path:
    """Locate a model directory by registry name, explicit path, or 'the latest one'."""
    if isinstance(name, Path) or (isinstance(name, str) and "/" in name):
        d = Path(name)
        d = d if d.is_absolute() else ROOT / d
        if not (d / "model.joblib").exists():
            raise SystemExit(f"No model.joblib in {d}")
        return d

    reg = registry()
    if name:
        if name not in reg:
            raise SystemExit(
                f"Unknown model {name!r}. Registered: {', '.join(reg) or '(none)'}"
            )
        return ROOT / reg[name]["dir"]

    # No name given: prefer the most recent model the project trained.
    for candidate in ("v2_robust", "v1_baseline"):
        if candidate in reg and (ROOT / reg[candidate]["dir"] / "model.joblib").exists():
            return ROOT / reg[candidate]["dir"]

    if allow_reference and (ROOT / "reference/outputs/xgb_baseline.joblib").exists():
        print("  ! using reference/outputs/ — prior art, NOT a model this project trained")
        return ROOT / "reference" / "outputs"

    raise SystemExit(
        "No trained model found. Run notebook 02 (and 05) first, "
        "or pass --allow-reference to fall back to the prior-art model."
    )


def load(name: str | Path | None = None, allow_reference: bool = False):
    """Return (directory, classifier, feature_names)."""
    d = resolve_dir(name, allow_reference=allow_reference)
    model_file = d / "model.joblib"
    if not model_file.exists():                    # reference/ uses the old filename
        model_file = d / "xgb_baseline.joblib"
    clf = joblib.load(model_file)
    features = json.loads((d / "feature_cols.json").read_text())
    return d, clf, features


def load_calibrator(d: Path):
    """The isotonic calibrator for a model, if it has one.

    v1 has none -- notebook 02 never fitted one, and its raw scores are inflated by
    `scale_pos_weight`. v2 does. Anything that displays a number to a user as a
    probability has to apply this, or the label on the slider is a lie.
    """
    path = Path(d) / "calibrator.joblib"
    return joblib.load(path) if path.exists() else None


def predict(clf, features, frame, calibrator=None):
    """P(LMC) for every row, calibrated when a calibrator exists."""
    import numpy as np
    X = frame.select(features).to_numpy().astype(np.float32)
    p = clf.predict_proba(X)[:, 1]
    return calibrator.predict(p) if calibrator is not None else p


def metrics(name: str | Path | None = None) -> dict:
    d = resolve_dir(name)
    path = d / "metrics.json"
    return json.loads(path.read_text()) if path.exists() else {}
