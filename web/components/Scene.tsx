"use client";

/**
 * Canvas host + progressive data loading.
 *
 * Two tiers: a 25k preview paints almost immediately, then the full 250k set
 * streams in behind it and swaps. The user never watches a spinner over an
 * empty canvas.
 */

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useState } from "react";

import { loadAnalysis } from "@/lib/analysis";
import { loadMeta, loadStars, type StarData } from "@/lib/loadStars";
import { useStore } from "@/lib/store";
import { StarField } from "./StarField";

export function Scene() {
  const data = useStore((s) => s.data);
  const setData = useStore((s) => s.setData);
  const setAnalysis = useStore((s) => s.setAnalysis);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meta = await loadMeta();

        const preview = await loadStars("/data/stars.preview.bin", meta, meta.counts.preview);
        if (cancelled) return;
        setData(preview, "preview");

        // Analysis is small (~21 KB) and the panels need it early; the full star
        // tier is 4.75 MB, so kick both off and let them race.
        void loadAnalysis()
          .then((a) => !cancelled && setAnalysis(a))
          .catch(() => undefined);

        const full = await loadStars("/data/stars.bin", meta, meta.counts.full);
        if (cancelled) return;
        setData(full, "full");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setData, setAnalysis]);

  // Honour the OS-level motion preference — the scroll morphs are intense.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => useStore.getState().setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (error) {
    return (
      <div className="scene-error">
        <p>Could not load star data.</p>
        <code>{error}</code>
        <p>Run <code>python scripts/export_web_data.py</code> from the project root.</p>
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: [0, 0, 220], fov: 55, near: 0.1, far: 4000 }}
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#05070d"]} />
      {data && <StarField data={data as StarData} />}
      <OrbitControls enablePan={false} enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
