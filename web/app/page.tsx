"use client";

/**
 * Scroll-driven narrative shell.
 *
 * The canvas is fixed; the scroll container above it is what moves. Scroll
 * position is written straight into the Zustand store (not React state), so the
 * 3D scene reads it inside useFrame without re-rendering this component.
 */

import { useEffect, useRef } from "react";

import { Panels } from "@/components/Panels";
import { Scene } from "@/components/Scene";
import { ACTS } from "@/lib/spaces";
import { useStore } from "@/lib/store";

export default function Home() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const actIndex = useStore((s) => s.actIndex);
  const tier = useStore((s) => s.tier);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let frame = 0;
    const onScroll = () => {
      // rAF-throttled: scroll events can fire faster than we render.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = el.scrollHeight - el.clientHeight;
        const t = max > 0 ? el.scrollTop / max : 0;
        useStore.getState().setProgress(t * (ACTS.length - 1));
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const jumpTo = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: (i / (ACTS.length - 1)) * max, behavior: "smooth" });
  };

  const act = ACTS[actIndex];

  return (
    <main className="shell">
      <div className="canvas-layer">
        <Scene />
      </div>

      <div className="hud">
        <p className="hud-eyebrow">
          Chapter {actIndex + 1} of {ACTS.length}
          {tier === "preview" && <span className="hud-loading"> · loading full catalogue…</span>}
        </p>
        <h1 className="hud-title">{act.title}</h1>
        <p className="hud-body">{act.body}</p>
        <ol className="hud-progress" aria-label="Chapters">
          {ACTS.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                className={i === actIndex ? "is-current" : undefined}
                onClick={() => jumpTo(i)}
                aria-label={a.title}
                aria-current={i === actIndex ? "step" : undefined}
              />
            </li>
          ))}
        </ol>
      </div>

      <Panels />

      {/* In the sandbox the scroll layer stops swallowing pointer events, so
          OrbitControls can actually receive drags. Navigate out with the chapter
          dots — they sit in the HUD and stay clickable. */}
      <div
        ref={scrollRef}
        className={`scroll-layer${act.panel === "controls" ? " is-passthrough" : ""}`}
      >
        {ACTS.map((a) => (
          <section key={a.id} id={a.id} className="act" aria-label={a.title} />
        ))}
      </div>
    </main>
  );
}
