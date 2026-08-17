/**
 * Model-analysis payload — everything needed to *explain* the classifier.
 *
 * All metrics are computed on the held-out test split only (see
 * scripts/export_analysis.py). The threshold sweep is precomputed at 101 points
 * so the slider is an array lookup, not a recomputation over 254k rows.
 */

export interface ThresholdSweep {
  thresholds: number[];
  tp: number[];
  fp: number[];
  tn: number[];
  fn: number[];
  nPositive: number;
  nNegative: number;
}

export interface Importance {
  name: string;
  label: string;
  blurb: string;
  value: number;
}

export interface Histogram {
  name: string;
  label: string;
  blurb: string;
  lo: number;
  hi: number;
  lmc: number[];
  mw: number[];
  /** Class-mean separation in pooled SDs — a blunt but honest separating-power score. */
  cohensD: number;
}

export interface Analysis {
  model: {
    /** Registry name of the model these numbers came from, e.g. "v2_robust". */
    name?: string;
    kind: string;
    nEstimators: number;
    maxDepth: number;
    scalePosWeight: number;
    features: string[];
    excluded: string[];
    excludedReason: string;
    /**
     * Whether the probabilities are isotonic-calibrated. When false, they are the
     * raw XGBoost scores, which `scale_pos_weight` inflates — so a threshold of
     * 0.5 does not mean "50% likely" and the UI should not claim it does.
     */
    calibrated?: boolean;
  };
  dataset: {
    totalRows: number;
    testRows: number;
    lmcFraction: number;
    corruptedRowsDropped: number;
  };
  headline: { rocAuc: number; prAuc: number };
  sweep: ThresholdSweep;
  roc: [number, number][];
  pr: [number, number][];
  importances: Importance[];
  histograms: Histogram[];
}

export async function loadAnalysis(baseUrl = "/data"): Promise<Analysis> {
  const res = await fetch(`${baseUrl}/analysis.json`);
  if (!res.ok) throw new Error("Missing analysis.json — run scripts/export_analysis.py");
  return res.json();
}

export interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  contamination: number;
  threshold: number;
}

/** Nearest precomputed threshold — the sweep is dense enough that this is exact to ±0.005. */
export function confusionAt(sweep: ThresholdSweep, threshold: number): Confusion {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < sweep.thresholds.length; i++) {
    const d = Math.abs(sweep.thresholds[i] - threshold);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }

  const tp = sweep.tp[best];
  const fp = sweep.fp[best];
  const tn = sweep.tn[best];
  const fn = sweep.fn[best];

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

  return {
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    accuracy: (tp + tn) / Math.max(tp + tn + fp + fn, 1),
    contamination: fp + tn > 0 ? fp / (fp + tn) : 0,
    threshold: sweep.thresholds[best],
  };
}

/** Confusion-matrix quadrants, in the order the shader's `uCell` uniform expects. */
export const CELLS = [
  { id: 0, key: "tn", label: "Milky Way, called Milky Way", short: "True negative" },
  { id: 1, key: "fp", label: "Milky Way, called LMC", short: "False positive" },
  { id: 2, key: "fn", label: "LMC, called Milky Way", short: "False negative" },
  { id: 3, key: "tp", label: "LMC, called LMC", short: "True positive" },
] as const;
