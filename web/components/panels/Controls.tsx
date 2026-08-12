"use client";

/**
 * Sandbox controls — manual override of every dimension of the view.
 *
 * `exposure` is here rather than hard-coded because it is the knob that decides
 * whether the dense LMC core reads as orange or saturates to a white disc, and the
 * right value depends on display and point density.
 */

import { COLOR_MODES, SPACES, SPACE_INFO, type ColorMode, type Space } from "@/lib/spaces";
import { useStore } from "@/lib/store";

const COLOR_LABELS: Record<ColorMode, string> = {
  neutral: "Unlabelled",
  truth: "Truth label",
  probability: "Predicted P(LMC)",
  error: "Correct vs wrong",
};

export function Controls() {
  // Individual selectors, not `useStore()` — subscribing to the whole store would
  // re-render this panel on every scroll tick, 60 times a second.
  const spaceOverride = useStore((s) => s.spaceOverride);
  const colorOverride = useStore((s) => s.colorOverride);
  const exposure = useStore((s) => s.exposure);
  const threshold = useStore((s) => s.threshold);
  const testOnly = useStore((s) => s.testOnly);
  const truthDepth = useStore((s) => s.truthDepth);
  const setSpace = useStore((s) => s.setSpace);
  const setColor = useStore((s) => s.setColor);
  const setExposure = useStore((s) => s.setExposure);
  const setThreshold = useStore((s) => s.setThreshold);
  const setTestOnly = useStore((s) => s.setTestOnly);
  const setTruthDepth = useStore((s) => s.setTruthDepth);

  return (
    <div className="panel">
      <header className="panel-head">
        <h2>Controls</h2>
        <p className="panel-sub">Manual override — scroll no longer drives the view</p>
      </header>

      <fieldset className="ctl">
        <legend>Coordinate space</legend>
        <div className="chips">
          {SPACES.map((sp: Space) => (
            <button
              key={sp}
              type="button"
              className={`chip${spaceOverride === sp ? " is-active" : ""}`}
              onClick={() => setSpace(spaceOverride === sp ? null : sp)}
            >
              {SPACE_INFO[sp].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="ctl">
        <legend>Colour by</legend>
        <div className="chips">
          {COLOR_MODES.map((c: ColorMode) => (
            <button
              key={c}
              type="button"
              className={`chip${colorOverride === c ? " is-active" : ""}`}
              onClick={() => setColor(colorOverride === c ? null : c)}
            >
              {COLOR_LABELS[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="slider-row">
        <label htmlFor="exposure">
          Exposure <strong>{exposure.toFixed(2)}</strong>
        </label>
        <input
          id="exposure"
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={exposure}
          onChange={(e) => setExposure(Number(e.target.value))}
        />
      </div>

      <div className="slider-row">
        <label htmlFor="threshold-sandbox">
          Decision threshold <strong>{threshold.toFixed(2)}</strong>
        </label>
        <input
          id="threshold-sandbox"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
      </div>

      <div className="toggles">
        <label className="toggle">
          <input
            type="checkbox"
            checked={testOnly}
            onChange={(e) => setTestOnly(e.target.checked)}
          />
          <span>Held-out test split only</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={truthDepth}
            onChange={(e) => setTruthDepth(e.target.checked)}
          />
          <span>
            Schematic depth <em>(not a measurement)</em>
          </span>
        </label>
      </div>
    </div>
  );
}
