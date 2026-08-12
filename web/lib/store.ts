/**
 * Global scene state.
 *
 * Deliberately tiny. Anything read every frame lives here and is read *inside*
 * `useFrame` via `useStore.getState()` — NOT through the `useStore(selector)` hook,
 * which would subscribe the component and re-render it on every scroll tick.
 */

import { create } from "zustand";
import { ACTS, type ColorMode, type Space } from "./spaces";
import type { StarData } from "./loadStars";
import type { Analysis } from "./analysis";

interface SceneState {
  /** Continuous scroll position in act-space: 0 .. ACTS.length - 1 */
  progress: number;
  /** Nearest act index — drives DOM copy, so it may re-render. */
  actIndex: number;

  data: StarData | null;
  tier: "none" | "preview" | "full";
  analysis: Analysis | null;

  /** Manual overrides (sandbox mode). Null means "follow the scroll". */
  spaceOverride: Space | null;
  colorOverride: ColorMode | null;

  threshold: number;
  truthDepth: boolean;
  exposure: number;
  /** Selected confusion-matrix quadrant (0 TN, 1 FP, 2 FN, 3 TP), or null. */
  cell: number | null;
  /** Restrict the view to the held-out split. */
  testOnly: boolean;
  reducedMotion: boolean;

  setProgress: (p: number) => void;
  setData: (d: StarData, tier: "preview" | "full") => void;
  setAnalysis: (a: Analysis) => void;
  setSpace: (s: Space | null) => void;
  setColor: (c: ColorMode | null) => void;
  setThreshold: (t: number) => void;
  setTruthDepth: (v: boolean) => void;
  setExposure: (v: number) => void;
  setCell: (c: number | null) => void;
  setTestOnly: (v: boolean) => void;
  setReducedMotion: (v: boolean) => void;
}

export const useStore = create<SceneState>((set, get) => ({
  progress: 0,
  actIndex: 0,
  data: null,
  tier: "none",
  analysis: null,
  spaceOverride: null,
  colorOverride: null,
  threshold: 0.5,
  truthDepth: false,
  exposure: 0.32,
  cell: null,
  testOnly: false,
  reducedMotion: false,

  setProgress: (p) => {
    const clamped = Math.max(0, Math.min(ACTS.length - 1, p));
    const next = Math.round(clamped);
    // Only touch actIndex when it actually changes — that field drives DOM copy,
    // so writing it every frame would re-render the overlay 60x/sec.
    if (next !== get().actIndex) {
      // Entering the verdict act implies the honest view; leaving it releases both.
      const enteringVerdict = ACTS[next].id === "verdict";
      set({
        progress: clamped,
        actIndex: next,
        testOnly: enteringVerdict ? true : get().testOnly && ACTS[next].id === "sandbox",
        cell: enteringVerdict ? get().cell : null,
      });
    } else {
      set({ progress: clamped });
    }
  },

  setData: (data, tier) => {
    // Never let the preview tier overwrite the full one if it resolves late.
    if (tier === "preview" && get().tier === "full") return;
    set({ data, tier });
  },

  setAnalysis: (analysis) => set({ analysis }),
  setSpace: (spaceOverride) => set({ spaceOverride }),
  setColor: (colorOverride) => set({ colorOverride }),
  setThreshold: (threshold) => set({ threshold }),
  setTruthDepth: (truthDepth) => set({ truthDepth }),
  setExposure: (exposure) => set({ exposure }),
  setCell: (cell) => set({ cell }),
  setTestOnly: (testOnly) => set({ testOnly }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));
