"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Preloader } from "@/components/cinematic/Preloader";
import { Stage, type Controller, type Telemetry } from "@/components/cinematic/Stage";
import type { LoadProgress } from "@/lib/cinematic/assets";
import { SHOTS, SHOT_STARTS, TOTAL_DURATION, shotIndexAt } from "@/lib/cinematic/timeline";
import "./cinematic.css";

/** Available playback rates. 1x is the authored pace; the rest are for review. */
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

/** Gaia's launch, so the mission clock can read as a real date. */
const LAUNCH = Date.UTC(2013, 11, 19);

function missionDate(days: number): string {
  const d = new Date(LAUNCH + days * 86_400_000);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * Live instrument readouts.
 *
 * Deliberately separate from the caption: the caption is the argument, this is the
 * evidence. Everything here derives from the same clock that drives the scene, so it
 * cannot drift out of step with what is on screen - if the sky is 40% covered, the
 * number says 40%.
 */
function Readouts({ tel }: { tel: Telemetry | null }) {
  if (!tel) return null;

  const rows: { k: string; v: string }[] = [];

  if (tel.world === "system" && tel.missionDays > 0.01) {
    rows.push({ k: "Mission date", v: missionDate(tel.missionDays) });
    rows.push({ k: "Elapsed", v: `${Math.round(tel.missionDays).toLocaleString()} days` });
    rows.push({ k: "Revolutions", v: Math.round(tel.revolutions).toLocaleString() });
    if (tel.coveredFraction > 0.001) {
      rows.push({ k: "Sky covered", v: `${(tel.coveredFraction * 100).toFixed(1)}%` });
    }
  }

  if (tel.world === "corridor" && tel.distanceKpc !== null) {
    const d = tel.distanceKpc;
    rows.push({
      k: "Distance from Gaia",
      v: d < 1 ? `${(d * 1000).toFixed(0)} pc` : `${d.toFixed(1)} kpc`,
    });
  }

  if (tel.earthScale) {
    rows.push({
      k: "Earth scale",
      v: `×${Math.round(tel.earthScale).toLocaleString()}`,
    });
  }

  if (tel.exaggeration) {
    rows.push({
      k: "Spacecraft scale",
      v: `×${tel.exaggeration.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    });
  }

  if (!rows.length) return null;

  return (
    <dl className="cine-readout">
      {rows.map((r) => (
        <div key={r.k}>
          <dt>{r.k}</dt>
          <dd>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function CinematicPage() {
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [shotIndex, setShotIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tel, setTel] = useState<Telemetry | null>(null);

  const ctrlRef = useRef<Controller | null>(null);

  // Called every frame. Both setters are guarded so React only commits when the
  // *displayed* value changes - the clock reads whole seconds and the caption
  // changes once a shot, so an unguarded setState here would re-render the entire
  // HUD 60 times a second for no visible difference.
  const onTime = useCallback((t: number) => {
    const whole = Math.floor(t);
    setElapsed((prev) => (prev === whole ? prev : whole));
    const i = shotIndexAt(t);
    setShotIndex((prev) => (prev === i ? prev : i));
  }, []);

  const onTelemetry = useCallback((next: Telemetry) => setTel(next), []);
  const onReady = useCallback(() => setReady(true), []);
  const onController = useCallback((c: Controller) => {
    ctrlRef.current = c;
    // Dev-only hook so a headless browser can park the sequence at an exact time and
    // screenshot it. Frame-accurate review is the only way to catch the things that
    // compile fine and still look wrong - bad framing, a body off screen, a layer
    // that never fades in. Stripped from production builds.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __cineSeek?: (t: number) => void }).__cineSeek = (t) => {
        c.setPlaying(false);
        c.seek(t);
      };
    }
  }, []);

  const jump = useCallback((i: number) => {
    ctrlRef.current?.seek(SHOT_STARTS[i] + 0.05);
  }, []);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      ctrlRef.current?.setPlaying(!p);
      return !p;
    });
  }, []);

  /** Nudge the clock by a few seconds, clamped to the sequence. */
  const scrub = useCallback((delta: number) => {
    setElapsed((prev) => {
      const next = Math.max(0, Math.min(TOTAL_DURATION - 0.1, prev + delta));
      ctrlRef.current?.seek(next);
      return Math.floor(next);
    });
  }, []);

  const changeSpeed = useCallback((v: number) => {
    setSpeed(v);
    ctrlRef.current?.setSpeed(v);
  }, []);

  // Keyboard transport.
  //
  // Arrows scrub by 5 seconds rather than jumping whole shots. A shot is 7-13
  // seconds, so shot-jumping meant the smallest possible step skipped an entire
  // beat - there was no way to move *within* one. Shift-arrow still jumps shots,
  // for when that is what you want.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) jump(Math.min(SHOTS.length - 1, shotIndex + 1));
        else scrub(5);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) jump(Math.max(0, shotIndex - 1));
        else scrub(-5);
      } else if (e.key >= "1" && e.key <= "5") {
        changeSpeed(SPEEDS[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, shotIndex, toggle, jump, scrub, changeSpeed]);

  const shot = SHOTS[shotIndex];

  // Act boundaries for the transport bar, so the chapter groupings are visible.
  const actBreaks = useMemo(
    () => SHOTS.map((s, i) => i > 0 && s.act !== SHOTS[i - 1].act),
    [],
  );

  return (
    <main className="cine">
      <Stage
        autoStart={started}
        onProgress={setProgress}
        onReady={onReady}
        onTime={onTime}
        onTelemetry={onTelemetry}
        onController={onController}
      />

      {ready && (
        <>
          <div className="cine-hud">
            <div className="cine-slate">
              <span className="cine-num">
                {(shotIndex + 1).toString().padStart(2, "0")}
                <i>/{SHOTS.length.toString().padStart(2, "0")}</i>
              </span>
              <span className="cine-act">{shot.act}</span>
              <span className="cine-shot">{shot.title}</span>
            </div>

            <div className="cine-copy">
              <p key={shot.id}>{shot.caption}</p>
              {shot.disclaimer && <p className="cine-disclaimer">{shot.disclaimer}</p>}
            </div>
          </div>

          <Readouts tel={tel} />

          <div className="cine-transport">
            <button
              type="button"
              className="cine-play"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚" : "▶"}
            </button>

            {/* Segment widths are proportional to real shot duration, so the bar
                shows how long is left rather than just how many chapters. */}
            <div className="cine-track">
              {SHOTS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={[
                    i === shotIndex ? "is-current" : i < shotIndex ? "is-past" : "",
                    actBreaks[i] ? "is-act-start" : "",
                  ].join(" ").trim()}
                  style={{ flexGrow: s.duration }}
                  onClick={() => jump(i)}
                  title={`${i + 1}. ${s.act} — ${s.title}`}
                  aria-label={`Jump to shot ${i + 1}: ${s.title}`}
                />
              ))}
            </div>

            <div className="cine-speeds" role="group" aria-label="Playback speed">
              {SPEEDS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={v === speed ? "is-on" : ""}
                  onClick={() => changeSpeed(v)}
                  aria-pressed={v === speed}
                >
                  {v}×
                </button>
              ))}
            </div>

            <span className="cine-clock">
              {clock(elapsed)}
              <i> / {clock(TOTAL_DURATION)}</i>
            </span>
          </div>

          <p className="cine-hint">
            space · pause &nbsp; ← → · 5s &nbsp; ⇧← ⇧→ · shots &nbsp; 1–5 · speed
          </p>
        </>
      )}

      <Preloader progress={progress} onStart={() => setStarted(true)} started={started} />
    </main>
  );
}
