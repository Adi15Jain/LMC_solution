"use client";

/**
 * Per-feature class distributions — "how the data separates", one feature at a time.
 *
 * Each histogram is normalised to its own class peak so the minority class stays
 * visible; the point is the *shape* overlap, not the raw counts (which would just
 * restate the 78/22 imbalance in every single chart).
 *
 * Features are ranked by Cohen's d — how far apart the class means sit in pooled
 * standard deviations — which makes the motion-vs-parallax gap explicit.
 */

import { useMemo, useState } from "react";
import type { Analysis, Histogram } from "@/lib/analysis";

export function Distributions({
  analysis,
  feature,
}: {
  analysis: Analysis;
  feature?: string;
}) {
  const ranked = useMemo(
    () => [...analysis.histograms].sort((a, b) => b.cohensD - a.cohensD),
    [analysis.histograms],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const active =
    ranked.find((h) => h.name === (selected ?? feature)) ?? ranked[0];

  return (
    <div className="panel">
      <header className="panel-head">
        <h2>How the classes separate</h2>
        <p className="panel-sub">
          Ranked by class-mean separation (Cohen&rsquo;s d) · each class normalised to its own peak
        </p>
      </header>

      <HistogramChart h={active} />

      <ul className="feature-list">
        {ranked.map((h) => (
          <li key={h.name}>
            <button
              type="button"
              className={`feature-btn${h.name === active.name ? " is-active" : ""}`}
              onClick={() => setSelected(h.name)}
            >
              <span className="feature-name">{h.label}</span>
              <span className="feature-d">d = {h.cohensD.toFixed(2)}</span>
              <span className="feature-track">
                <span
                  className="feature-fill"
                  style={{ width: `${Math.min(100, (h.cohensD / ranked[0].cohensD) * 100)}%` }}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistogramChart({ h }: { h: Histogram }) {
  const W = 320;
  const H = 130;
  const n = h.lmc.length;
  const step = W / n;

  // Area paths rather than bars — with 60 bins, bars turn into visual noise.
  const path = (values: number[]) => {
    let d = `M 0 ${H}`;
    values.forEach((v, i) => {
      d += ` L ${(i * step).toFixed(2)} ${(H - v * (H - 6)).toFixed(2)}`;
    });
    d += ` L ${W} ${H} Z`;
    return d;
  };

  return (
    <figure className="hist">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Distribution of ${h.label}`}>
        <path d={path(h.mw)} className="hist-mw" />
        <path d={path(h.lmc)} className="hist-lmc" />
      </svg>
      <figcaption>
        <div className="hist-axis">
          <span>{h.lo.toFixed(2)}</span>
          <strong>{h.label}</strong>
          <span>{h.hi.toFixed(2)}</span>
        </div>
        <p className="hist-blurb">{h.blurb}</p>
        <p className="hist-legend">
          <span className="swatch is-mw" /> Milky Way
          <span className="swatch is-lmc" /> LMC
          <span className="hist-d">separation d = {h.cohensD.toFixed(2)}</span>
        </p>
      </figcaption>
    </figure>
  );
}
