/**
 * In-browser inference for the interactive probe (Act 6).
 *
 * Scope note: this runs ONE star at a time — the synthetic star the user drags
 * through feature space. Every *displayed* star's probability was precomputed in
 * Python and baked into the binary, so we never run 250k inferences here.
 *
 * The runtime (~2 MB of WASM) is imported dynamically so it costs nothing until
 * the user actually reaches Act 6.
 */

import type { InferenceSession, Tensor } from "onnxruntime-web";

/** Must match reference/outputs/feature_cols.json exactly, in order. */
export const FEATURE_NAMES = [
  "pmra",
  "pmdec",
  "pm_total",
  "parallax",
  "pmra_error",
  "pmdec_error",
  "parallax_error",
  "phot_g_mean_mag",
  "phot_bp_mean_mag",
  "phot_rp_mean_mag",
  "bp_rp",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

/** Median-ish values, so a probe star starts somewhere physically plausible. */
export const DEFAULT_FEATURES: FeatureVector = {
  pmra: 1.7,
  pmdec: 0.4,
  pm_total: 1.75,
  parallax: -0.02,
  pmra_error: 0.15,
  pmdec_error: 0.14,
  parallax_error: 0.22,
  phot_g_mean_mag: 18.5,
  phot_bp_mean_mag: 19.0,
  phot_rp_mean_mag: 17.9,
  bp_rp: 1.1,
};

let sessionPromise: Promise<InferenceSession> | null = null;
let TensorCtor: typeof Tensor | null = null;

async function getSession(): Promise<InferenceSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const ort = await import("onnxruntime-web");
    TensorCtor = ort.Tensor;

    // WASM only. Tree ensembles use ai.onnx.ml operators (TreeEnsembleClassifier),
    // which the WebGL and WebGPU backends do not implement — asking for them here
    // fails at session creation.
    ort.env.wasm.numThreads = 1;

    return ort.InferenceSession.create("/model/xgb_lmc.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  })();

  return sessionPromise;
}

/** Keep the two derived features consistent with whatever the user changed. */
export function deriveFeatures(f: FeatureVector): FeatureVector {
  return {
    ...f,
    pm_total: Math.sqrt(f.pmra ** 2 + f.pmdec ** 2),
    bp_rp: f.phot_bp_mean_mag - f.phot_rp_mean_mag,
  };
}

/**
 * Returns P(LMC) for one star.
 *
 * The model was converted with `zipmap: False` — without that, output[1] is a
 * sequence-of-maps and onnxruntime-web throws "Non tensor type is temporarily not
 * supported". With it, output[1] is a plain [N, 2] float tensor. See
 * scripts/export_onnx.py.
 */
export async function predictOne(features: FeatureVector): Promise<number> {
  const session = await getSession();
  const derived = deriveFeatures(features);
  const input = Float32Array.from(FEATURE_NAMES.map((name) => derived[name]));

  const tensor = new TensorCtor!("float32", input, [1, FEATURE_NAMES.length]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });

  // outputs[0] = predicted label, outputs[1] = probabilities [N, 2]
  const probs = outputs[session.outputNames[1]].data as Float32Array;
  return probs[1];
}

/** Warm the runtime up before the user reaches the probe, so the first drag isn't janky. */
export function preloadModel(): void {
  void getSession().catch(() => {
    /* surfaced at call time instead */
  });
}
