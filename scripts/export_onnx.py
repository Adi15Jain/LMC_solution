#!/usr/bin/env python3
"""
Convert the trained XGBoost classifier to ONNX for in-browser inference.

This powers ONE thing: the interactive probe in Act 6, where the user drags a
synthetic star through feature space and sees P(LMC) update live. Every *displayed*
star's probability is precomputed by export_web_data.py — we do not run 250k
inferences in the browser.

    pip install onnxmltools onnx onnxruntime

Usage:
    python scripts/export_onnx.py
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WEB_MODEL = ROOT / "web" / "public" / "model"


def resolve_model_dir() -> Path:
    for candidate in (ROOT / "outputs", ROOT / "reference" / "outputs"):
        if (candidate / "xgb_baseline.joblib").exists():
            return candidate
    raise SystemExit("No xgb_baseline.joblib found in outputs/ or reference/outputs/")


def main() -> None:
    try:
        from onnxmltools import convert_xgboost
        from onnxmltools.convert.common.data_types import FloatTensorType
    except ImportError:
        raise SystemExit("pip install onnxmltools onnx onnxruntime")

    model_dir = resolve_model_dir()
    clf = joblib.load(model_dir / "xgb_baseline.joblib")
    features = json.loads((model_dir / "feature_cols.json").read_text())
    print(f"loaded model from {model_dir.relative_to(ROOT)} ({len(features)} features)")

    # ---------------------------------------------------------------------
    # THE critical option. Without zipmap=False the classifier emits a ZipMap
    # node producing a sequence-of-maps output, and onnxruntime-web dies with:
    #     "Non tensor type is temporarily not supported"
    # It works fine in Python either way, so this failure only shows up in the
    # browser — which is exactly how it eats a day of debugging.
    # ---------------------------------------------------------------------
    onnx_model = convert_xgboost(
        clf,
        initial_types=[("input", FloatTensorType([None, len(features)]))],
        options={id(clf): {"zipmap": False}},
        target_opset=15,
    )

    WEB_MODEL.mkdir(parents=True, exist_ok=True)
    out = WEB_MODEL / "xgb_lmc.onnx"
    out.write_bytes(onnx_model.SerializeToString())
    (WEB_MODEL / "feature_cols.json").write_text(json.dumps(features, indent=2))
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.2f} MB)")

    # Verify parity against the original model before trusting it in the browser.
    try:
        import onnxruntime as ort
    except ImportError:
        print("! onnxruntime not installed - skipping parity check")
        return

    rng = np.random.default_rng(0)
    X = rng.normal(size=(256, len(features))).astype(np.float32)

    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    outputs = sess.run(None, {"input": X})
    onnx_prob = np.asarray(outputs[1])[:, 1]
    xgb_prob = clf.predict_proba(X)[:, 1]

    max_diff = float(np.abs(onnx_prob - xgb_prob).max())
    print(f"parity check: max |onnx - xgb| = {max_diff:.2e}", "OK" if max_diff < 1e-4 else "MISMATCH")
    print("output names:", [o.name for o in sess.get_outputs()])


if __name__ == "__main__":
    main()
