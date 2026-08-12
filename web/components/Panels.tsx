"use client";

/**
 * Picks the analysis panel that accompanies the current act.
 * Mounted outside the Canvas — this is ordinary DOM, not 3D.
 */

import { ACTS } from "@/lib/spaces";
import { useStore } from "@/lib/store";
import { ConfusionMatrix } from "./panels/ConfusionMatrix";
import { Controls } from "./panels/Controls";
import { Distributions } from "./panels/Distributions";
import { FeatureImportance } from "./panels/FeatureImportance";

export function Panels() {
  const actIndex = useStore((s) => s.actIndex);
  const analysis = useStore((s) => s.analysis);

  const act = ACTS[actIndex];
  if (act.panel === "none") return null;
  if (act.panel === "controls") return <aside className="panel-slot"><Controls /></aside>;
  if (!analysis) return null;

  return (
    <aside className="panel-slot">
      {act.panel === "matrix" && <ConfusionMatrix analysis={analysis} />}
      {act.panel === "importance" && <FeatureImportance analysis={analysis} />}
      {act.panel === "distributions" && (
        <Distributions analysis={analysis} feature={act.feature} />
      )}
    </aside>
  );
}
