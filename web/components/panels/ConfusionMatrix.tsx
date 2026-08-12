"use client";

/**
 * Interactive confusion matrix over the held-out test split.
 *
 * Clicking a quadrant sets `cell` in the store, which the vertex shader reads to
 * dim every star outside that quadrant — so "false positives" stops being a number
 * and becomes a visible population inside the proper-motion clump.
 *
 * The threshold slider is a lookup into a precomputed 101-point sweep, so it stays
 * instant despite covering 253,941 stars.
 */

import { CELLS, confusionAt, type Analysis } from "@/lib/analysis";
import { useStore } from "@/lib/store";

const fmt = new Intl.NumberFormat("en-US");
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function ConfusionMatrix({ analysis }: { analysis: Analysis }) {
  const threshold = useStore((s) => s.threshold);
  const setThreshold = useStore((s) => s.setThreshold);
  const cell = useStore((s) => s.cell);
  const setCell = useStore((s) => s.setCell);

  const c = confusionAt(analysis.sweep, threshold);
  const counts: Record<string, number> = { tn: c.tn, fp: c.fp, fn: c.fn, tp: c.tp };
  const rowTotals = { mw: c.tn + c.fp, lmc: c.fn + c.tp };

  return (
    <div className="panel">
      <header className="panel-head">
        <h2>Confusion matrix</h2>
        <p className="panel-sub">
          Held-out test set — {fmt.format(analysis.dataset.testRows)} stars the model never saw
        </p>
      </header>

      <div className="matrix" role="group" aria-label="Confusion matrix">
        <div className="matrix-corner" />
        <div className="matrix-colhead">called MW</div>
        <div className="matrix-colhead">called LMC</div>

        <div className="matrix-rowhead">actually MW</div>
        {[CELLS[0], CELLS[1]].map((cl) => (
          <MatrixCell
            key={cl.key}
            id={cl.id}
            label={cl.short}
            count={counts[cl.key]}
            rate={counts[cl.key] / Math.max(rowTotals.mw, 1)}
            active={cell === cl.id}
            bad={cl.key === "fp"}
            onSelect={() => setCell(cell === cl.id ? null : cl.id)}
          />
        ))}

        <div className="matrix-rowhead">actually LMC</div>
        {[CELLS[2], CELLS[3]].map((cl) => (
          <MatrixCell
            key={cl.key}
            id={cl.id}
            label={cl.short}
            count={counts[cl.key]}
            rate={counts[cl.key] / Math.max(rowTotals.lmc, 1)}
            active={cell === cl.id}
            bad={cl.key === "fn"}
            onSelect={() => setCell(cell === cl.id ? null : cl.id)}
          />
        ))}
      </div>

      <p className="matrix-hint">
        {cell === null
          ? "Click a quadrant to isolate those stars in the cloud."
          : `Showing ${CELLS[cell].label.toLowerCase()}. Click again to clear.`}
      </p>

      <div className="slider-row">
        <label htmlFor="threshold">
          Decision threshold <strong>{c.threshold.toFixed(2)}</strong>
        </label>
        <input
          id="threshold"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
      </div>

      <dl className="metrics">
        <Metric label="LMC recall" value={pct(c.recall)} note="of real LMC stars, caught" />
        <Metric label="LMC precision" value={pct(c.precision)} note="of LMC calls, correct" />
        <Metric label="MW contamination" value={pct(c.contamination)} note="of MW stars, misfiled" />
        <Metric label="F1" value={c.f1.toFixed(4)} note="precision/recall balance" />
        <Metric label="ROC-AUC" value={analysis.headline.rocAuc.toFixed(4)} note="threshold-free" />
        <Metric label="PR-AUC" value={analysis.headline.prAuc.toFixed(4)} note="honest under imbalance" />
      </dl>
    </div>
  );
}

function MatrixCell({
  id,
  label,
  count,
  rate,
  active,
  bad,
  onSelect,
}: {
  id: number;
  label: string;
  count: number;
  rate: number;
  active: boolean;
  bad: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`matrix-cell${active ? " is-active" : ""}${bad ? " is-bad" : ""}`}
      onClick={onSelect}
      aria-pressed={active}
      // Opacity encodes the row-normalised rate, so the diagonal reads instantly.
      style={{ ["--fill" as string]: rate.toFixed(3) }}
      data-cell={id}
    >
      <span className="matrix-count">{fmt.format(count)}</span>
      <span className="matrix-rate">{(rate * 100).toFixed(2)}%</span>
      <span className="matrix-label">{label}</span>
    </button>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <p>{note}</p>
    </div>
  );
}
