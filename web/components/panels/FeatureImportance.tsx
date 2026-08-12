"use client";

/**
 * What the model leaned on, ranked by XGBoost gain.
 *
 * The headline finding lives here: motion features carry ~93% of the model, while
 * parallax — the textbook way to measure distance — contributes ~0.3%. That single
 * comparison is the clearest evidence that the model learned real astrophysics
 * rather than a shortcut.
 */

import type { Analysis } from "@/lib/analysis";

export function FeatureImportance({ analysis }: { analysis: Analysis }) {
  const max = Math.max(...analysis.importances.map((i) => i.value), 1e-6);
  const motion = analysis.importances
    .filter((i) => ["pm_total", "pmra", "pmdec"].includes(i.name))
    .reduce((sum, i) => sum + i.value, 0);

  return (
    <div className="panel">
      <header className="panel-head">
        <h2>Feature importance</h2>
        <p className="panel-sub">
          {analysis.model.kind} · {analysis.model.nEstimators} trees · depth{" "}
          {analysis.model.maxDepth} · scale_pos_weight {analysis.model.scalePosWeight}
        </p>
      </header>

      <ul className="bars">
        {analysis.importances.map((imp) => (
          <li key={imp.name} className="bar-row">
            <div className="bar-head">
              <span className="bar-label">{imp.label}</span>
              <span className="bar-value">{(imp.value * 100).toFixed(1)}%</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(imp.value / max) * 100}%` }} />
            </div>
            <p className="bar-blurb">{imp.blurb}</p>
          </li>
        ))}
      </ul>

      <div className="callout">
        <p>
          <strong>Motion is {(motion * 100).toFixed(0)}% of the model.</strong> Parallax —
          the standard way to measure distance — contributes{" "}
          {(
            (analysis.importances.find((i) => i.name === "parallax")?.value ?? 0) * 100
          ).toFixed(1)}
          %, because at 50 kpc Gaia&rsquo;s parallax error is larger than the parallax itself.
        </p>
      </div>

      <div className="callout is-warn">
        <p>
          <strong>Excluded on purpose: {analysis.model.excluded.join(", ")}.</strong>{" "}
          {analysis.model.excludedReason}
        </p>
      </div>
    </div>
  );
}
