"use client";

/**
 * Start screen and loading gate.
 *
 * The deal this screen makes with the viewer: wait once, then nothing stutters.
 * It says so plainly, shows what is being fetched, and shows the byte count — a
 * progress bar with no context is what makes long loads feel broken.
 */

import { useEffect, useState } from "react";
import { estimatedBytes, type LoadProgress } from "@/lib/cinematic/assets";
import { SHOTS, TOTAL_DURATION } from "@/lib/cinematic/timeline";

const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

function runtime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Preloader({
  progress,
  onStart,
  started,
}: {
  progress: LoadProgress | null;
  onStart: () => void;
  started: boolean;
}) {
  const [hidden, setHidden] = useState(false);

  // Hold the overlay through its fade so the first frame is never seen half-drawn.
  useEffect(() => {
    if (!progress?.done) return;
    const id = setTimeout(() => setHidden(true), 900);
    return () => clearTimeout(id);
  }, [progress?.done]);

  if (hidden) return null;

  const pct = Math.round((progress?.fraction ?? 0) * 100);

  return (
    <div className={`pre ${progress?.done ? "is-done" : ""}`}>
      <div className="pre-inner">
        <p className="pre-eyebrow">Gaia · Large Magellanic Cloud · classification</p>

        <h1 className="pre-title">
          Two galaxies
          <br />
          on one line of sight
        </h1>

        <p className="pre-lede">
          A guided sequence from the Gaia spacecraft at L2 out to the Large Magellanic
          Cloud, 49.59 kiloparsecs away — and the classifier that separates its stars
          from the Milky Way foreground.
        </p>

        <dl className="pre-specs">
          <div>
            <dt>Runtime</dt>
            <dd>{runtime(TOTAL_DURATION)}</dd>
          </div>
          <div>
            <dt>Shots</dt>
            <dd>{SHOTS.length}</dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>{mb(estimatedBytes())}</dd>
          </div>
          <div>
            <dt>Stars</dt>
            <dd>258,920</dd>
          </div>
        </dl>

        {!started ? (
          <>
            <button type="button" className="pre-start" onClick={onStart}>
              Load and begin
            </button>
            <p className="pre-note">
              Everything loads up front — assets, textures and every shader — so the
              sequence runs without interruption once it starts. Expect up to a couple of
              minutes on a slow connection.
            </p>
          </>
        ) : (
          <div className="pre-loading">
            <div className="pre-bar" aria-hidden>
              <span style={{ transform: `scaleX(${(progress?.fraction ?? 0).toFixed(4)})` }} />
            </div>
            <p className="pre-status">
              <span className="pre-pct">{pct.toString().padStart(3, " ")}%</span>
              <span className="pre-label">{progress?.label ?? "…"}</span>
            </p>
          </div>
        )}

        <p className="pre-credits">
          Panorama ESO/S. Brunier · Star catalogue HYG v4.0 (CC BY-SA 4.0) · Spacecraft
          model ESA · LMC field simulated with the Gaia Object Generator
        </p>
      </div>
    </div>
  );
}
