/**
 * The cinematic timeline.
 *
 * One number - `t`, seconds - drives the entire sequence. `sample(t)` is a pure
 * function returning the complete scene state at that instant: which world is on,
 * where the camera is, what every layer is doing, which caption is up.
 *
 * Pure and stateless on purpose:
 *   - scrubbing is free (no accumulated state to unwind)
 *   - the whole thing is testable without a renderer
 *   - React never re-renders for it; the frame loop just reads it
 *
 * Three worlds, never on screen together:
 *   "system"    solar-system scale, 1 unit = 1000 km. Earth, Sun, Lagrange points, Gaia.
 *   "corridor"  the line of sight to the LMC, log-scaled in distance.
 *   "field"     the abstract classification spaces shared with the explorer route.
 */

import { LMC_DISTANCE_KPC, MISSION_DAYS, orbitalPeriodComparison } from "./astro";
import { corridorZ, LMC_Z } from "./scenes/corridor";

export type World = "system" | "corridor" | "field";

export interface Shot {
  id: string;
  /** Narrative grouping, shown in the HUD above the shot title. */
  act: string;
  title: string;
  caption: string;
  /** Seconds. */
  duration: number;
  /** Permanent on-screen label where a viewer could otherwise infer something false. */
  disclaimer?: string;
}

const periods = orbitalPeriodComparison();

export const SHOTS: Shot[] = [
  // ---------------------------------------------------------------- Act I ---
  {
    id: "earth",
    act: "I · Where Gaia is",
    title: "Earth",
    caption:
      "Start here. Everything Gaia measures is measured from a platform that has to "
      + "sit still, stay cold, and see the whole sky.",
    duration: 7,
    disclaimer: "Surface imagery: NASA Blue Marble",
  },
  {
    id: "lagrange",
    act: "I · Where Gaia is",
    title: "Five places that hold",
    caption:
      "Pull back to the Sun–Earth system. Five points co-rotate with the Earth: at "
      + "each one, gravity and the motion needed to keep station cancel exactly. "
      + "L4 and L5 close an equilateral triangle with the two bodies.",
    duration: 11,
  },
  {
    id: "why-l2",
    act: "I · Where Gaia is",
    title: "Why L2",
    caption:
      "Contours of the effective potential. L1 and L2 are saddles, 1.50 million km "
      + "either side of Earth. Out at L2 the Sun alone would need "
      + `${periods.sunOnly.toFixed(1)} days to complete an orbit — Earth's pull adds to `
      + `the Sun's, and the sum is exactly the ${periods.withEarth} days needed to keep pace.`,
    duration: 10,
    disclaimer: "Contours computed from the real Sun–Earth mass ratio, μ = 3.04×10⁻⁶",
  },
  {
    id: "arrive-l2",
    act: "I · Where Gaia is",
    title: "Gaia",
    caption:
      "A 340,000 × 90,000 km orbit around L2, once every 180 days — wide enough that "
      + "the spacecraft never enters Earth's shadow. Its shade comes from the "
      + "10-metre sunshield, not from the Earth. Launch mass 2,030 kg.",
    duration: 8,
    disclaimer: "Spacecraft shown ×1,000,000 — it is 10 m across, L2 is 1.5 million km away",
  },

  // --------------------------------------------------------------- Act II ---
  {
    id: "spin",
    act: "II · How it looks",
    title: "Two fields, one turn",
    caption:
      "One rotation every six hours, 60 arcseconds a second. Two telescopes look out "
      + "106.5° apart along the same circle, so a star crossing the leading field is "
      + "seen again by the trailing one 106.5 minutes later.",
    duration: 9,
    disclaimer: "Spacecraft shown ×1,000,000",
  },
  {
    id: "survey",
    act: "II · How it looks",
    title: "Eleven years",
    caption:
      "The spin axis holds 45° from the Sun and precesses around it every 63 days, "
      + "while the Sun itself moves once a year. Three incommensurate periods: the "
      + "scan circle never repeats, and the whole sky fills in.",
    duration: 13,
    disclaimer: "19 Dec 2013 – 15 Jan 2025 · coverage simulated from the nominal scanning law",
  },

  // -------------------------------------------------------------- Act III ---
  {
    id: "depart",
    act: "III · The problem",
    title: "One line of sight",
    caption: "Follow a single boresight outward, toward the Large Magellanic Cloud.",
    duration: 5,
  },
  {
    id: "corridor",
    act: "III · The problem",
    title: "Everything in the way",
    caption:
      "Milky Way stars at a few hundred parsecs — real distances, from parallax. "
      + "Then nothing, for forty kiloparsecs. The two populations are separated by a "
      + "factor of a hundred in distance and by nothing at all on the sky.",
    duration: 12,
    disclaimer: "Distance axis is logarithmic · LMC placed at 49.59 kpc (inferred, not measured)",
  },
  {
    id: "lookback",
    act: "III · The problem",
    title: "Flattened",
    caption:
      "Turn around. Depth collapses, and the foreground lands on top of the target. "
      + "This is all Gaia ever sees: one flat field, two galaxies, no depth cue that "
      + "reaches this far.",
    duration: 7,
  },

  // ----------------------------------------------------- Act IV/V (existing) ---
  {
    id: "field",
    act: "IV · The data",
    title: "The field",
    caption:
      "The Large Magellanic Cloud's patch of sky. 250,000 stars. About 22% belong to that "
      + "galaxy; the rest are Milky Way foreground. Nothing here tells you which is which.",
    duration: 8,
    disclaimer: "Simulated catalogue (Gaia Object Generator)",
  },
  {
    id: "parallax",
    act: "IV · The data",
    title: "Distance, as measured",
    caption:
      "Place every star at 1/parallax. The Milky Way resolves into a real foreground, 0.3 "
      + "to 2.7 kiloparsecs. The LMC shatters — its parallax signal is 14× smaller than its "
      + "own error bar, and 47% of it comes out negative.",
    duration: 10,
    disclaimer: "LMC parallax SNR ≈ 0.07 — the measurement cannot reach this far",
  },
  {
    id: "motion",
    act: "V · The signal",
    title: "Motion",
    caption:
      "Every star's measured proper motion, drawn as a vector. The Milky Way scatters. The "
      + "LMC's arrows are parallel — one galaxy, one bulk motion. This is the entire signal.",
    duration: 12,
    disclaimer: "Proper motion exaggerated for visibility",
  },
  {
    id: "classify",
    act: "V · The signal",
    title: "Classification",
    caption:
      "Eleven features per star — motion, photometry, measurement quality. Never sky "
      + "position: the LMC occupies a hard rectangle in this simulation, and a model given "
      + "coordinates would memorise the box instead of learning the physics.",
    duration: 9,
  },
  {
    id: "resolve",
    act: "V · The signal",
    title: "Resolved",
    caption:
      "The classified LMC contracts onto a shell at 49.59 kiloparsecs. The Milky Way keeps "
      + "its measured distances. Two structures, finally separate.",
    duration: 9,
    disclaimer: "LMC depth inferred from classification, not measured — 49.59 kpc, Pietrzyński et al. 2019",
  },
  {
    id: "verdict",
    act: "V · The signal",
    title: "The verdict",
    caption:
      "253,941 held-out stars. Recall 99.58%, precision 98.04%, contamination 0.56%. "
      + "The 1,106 false positives are Milky Way stars whose motion happens to match.",
    duration: 10,
    disclaimer: "Held-out test split only",
  },
];

export const TOTAL_DURATION = SHOTS.reduce((s, shot) => s + shot.duration, 0);

/** Start time of each shot, precomputed. */
export const SHOT_STARTS: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const shot of SHOTS) {
    out.push(acc);
    acc += shot.duration;
  }
  return out;
})();

export function shotIndexAt(t: number): number {
  for (let i = SHOT_STARTS.length - 1; i >= 0; i--) {
    if (t >= SHOT_STARTS[i]) return i;
  }
  return 0;
}

export function shotProgress(t: number): number {
  const i = shotIndexAt(t);
  return Math.min(1, Math.max(0, (t - SHOT_STARTS[i]) / SHOTS[i].duration));
}

// --------------------------------------------------------------------------
// Easing
// --------------------------------------------------------------------------

/** Slow in, slow out. The default for camera moves - linear reads as robotic. */
export const easeInOut = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

/** Fast start, long settle. For arrivals - gives the sense of decelerating into place. */
export const easeOut = (x: number): number => 1 - Math.pow(1 - x, 4);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Ramp from 0 to 1 between two absolute times. */
export function ramp(t: number, from: number, to: number, ease = easeInOut): number {
  if (to <= from) return t >= to ? 1 : 0;
  return ease(clamp01((t - from) / (to - from)));
}

/** 1 while inside the window, easing in and out at the edges. */
export function window_(t: number, start: number, end: number, fade = 1.5): number {
  return ramp(t, start, start + fade) * (1 - ramp(t, end - fade, end));
}

/**
 * Interpolate a camera distance geometrically, not linearly.
 *
 * Shot 2 travels from 30 units to 235,000 - nearly four orders of magnitude. Linear
 * interpolation is already past 100,000 units a third of the way through, so the
 * viewer gets one instant of departure and then ten seconds of nothing changing.
 * Interpolating the logarithm makes the *apparent* zoom rate constant, which is what
 * pulling back is supposed to feel like.
 */
export const logLerp = (a: number, b: number, k: number): number =>
  a * Math.pow(b / a, clamp01(k));

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// --------------------------------------------------------------------------
// Sampling
// --------------------------------------------------------------------------

export type Vec3 = [number, number, number];

export interface CameraPose {
  eye: Vec3;
  focus: Vec3;
  fov: number;
}

export interface SceneState {
  t: number;
  shotIndex: number;
  shot: Shot;
  world: World;
  camera: CameraPose;

  // --- system world ---
  earthOpacity: number;
  /** Turns of the Earth about its axis. */
  earthSpin: number;
  sunOpacity: number;
  contourOpacity: number;
  markerOpacity: number;
  orbitOpacity: number;
  lissajousOpacity: number;
  gaiaOpacity: number;
  beamOpacity: number;
  coverageOpacity: number;
  /** Mission time in days; drives the scanning law and the HUD clock. */
  missionDays: number;
  /** Which world-space labels the HUD should project and draw. */
  labelSet: "none" | "lagrange" | "corridor";

  // --- corridor world ---
  corridorReveal: number;
  corridorFade: number;
  corridorHighlight: number;

  // --- field world ---
  skyboxOpacity: number;
  brightStarsOpacity: number;
  fieldOpacity: number;
  spaceWeights: [number, number, number, number];
  colorWeights: [number, number, number, number];
  inferredDepth: number;
  vectorScale: number;
}

const at = (id: string): number => SHOT_STARTS[SHOTS.findIndex((s) => s.id === id)];

const T = {
  earth: at("earth"),
  lagrange: at("lagrange"),
  whyL2: at("why-l2"),
  arrive: at("arrive-l2"),
  spin: at("spin"),
  survey: at("survey"),
  depart: at("depart"),
  corridor: at("corridor"),
  lookback: at("lookback"),
  field: at("field"),
  parallax: at("parallax"),
  motion: at("motion"),
  classify: at("classify"),
  resolve: at("resolve"),
  verdict: at("verdict"),
};

/** L2 sits on +X at 1500 units; the Sun is on -X at 1 AU. */
export const L2_POS: Vec3 = [1500, 0, 0];
export const SUN_X = -149_597.871;

/**
 * Place the camera on a sphere of exactly `distance` around `target`.
 *
 * Worth having as one function rather than three inline expressions. The first cut
 * of this scaled the individual components ("d * 0.55" on x, "d * 0.9" on z) to shape
 * the framing, which quietly meant the eye was at 0.62·d from the target rather than
 * d. In the opening shot that put the camera 6,300 km from Earth's centre - i.e.
 * *inside* a planet with a 6,371 km radius, which is why the first frame rendered as
 * empty sky. Framing is the job of `distance` and `fov`; nothing else may touch it.
 */
function orbitPose(target: Vec3, distance: number, azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation);
  return [
    target[0] + distance * ce * Math.cos(azimuth),
    target[1] + distance * Math.sin(elevation),
    target[2] + distance * ce * Math.sin(azimuth),
  ];
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 =>
  [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

const ORIGIN: Vec3 = [0, 0, 0];
/** Centre of the Sun-Earth system, where the L4/L5 triangle is symmetric. */
const SYSTEM_CENTRE: Vec3 = [SUN_X * 0.5, 0, 0];

/**
 * Camera for the solar-system act.
 *
 * An explicit path rather than a generic orbit, because the move *is* the narration:
 * leave Earth, see the whole system, come back to one point in it.
 *
 * Distances are chosen from what has to fit in frame, not by eye:
 *   Earth close-up   11 units against a 6.371-unit radius - the limb fills the frame
 *   whole system     the L4/L5 triangle spans +/-129,500 units, so 360,000 at fov 40
 *   contour map      structure lives inside +/-3,000 units, so 9,000 at fov 40
 *   Lissajous orbit  half-extent 170 units, so 430 at fov 44
 */
function systemCamera(t: number): CameraPose {
  // Beat 1: hold close on Earth, drifting back.
  //
  // Azimuth sits near pi because the Sun is on -X: looking from the sunward side
  // gives a mostly-lit disc with the terminator running down one edge, which is the
  // view that shows both the day map and the city lights.
  if (t < T.lagrange) {
    const k = ramp(t, T.earth, T.lagrange, easeInOut);
    return {
      eye: orbitPose(ORIGIN, logLerp(11, 27, k), lerp(2.35, 2.95, k), lerp(0.22, 0.48, k)),
      focus: ORIGIN,
      fov: 46,
    };
  }

  // Beat 2: out to the whole Sun-Earth system, tilting to look down on the ecliptic
  // so the L4/L5 triangle reads as a triangle rather than edge-on.
  if (t < T.whyL2) {
    // Distance ramps on its own, faster clock than everything else.
    //
    // The L4/L5 triangle spans +/-129,500 units and only fits once the camera is
    // ~360,000 out. Ramping distance over the full shot meant it arrived in the last
    // second and the viewer never saw the triangle the caption talks about. Getting
    // there by two thirds leaves real time to hold on it.
    const kDist = ramp(t, T.lagrange, T.lagrange + (T.whyL2 - T.lagrange) * 0.62, easeInOut);
    const k = ramp(t, T.lagrange, T.whyL2, easeInOut);
    // The look-at lags the pull-back so the Earth stays the subject for the first few
    // seconds instead of sliding off immediately.
    const target = lerp3(ORIGIN, SYSTEM_CENTRE, ramp(t, T.lagrange + 3, T.whyL2 - 2, easeInOut));
    return {
      eye: orbitPose(target, logLerp(27, 360_000, kDist), lerp(2.95, 1.62, k), lerp(0.48, 1.16, k)),
      focus: target,
      fov: lerp(46, 40, k),
    };
  }

  // Beat 3: back into the Earth's neighbourhood for the contour map, from nearly
  // overhead so the saddles read as saddles.
  //
  // The look-at converges on Earth much faster than the distance does. Interpolating
  // both at the same rate leaves the camera aimed at empty space a hundred thousand
  // units from the contours it is supposed to be showing.
  if (t < T.arrive) {
    const k = ramp(t, T.whyL2, T.arrive, easeInOut);
    const target = lerp3(SYSTEM_CENTRE, ORIGIN, ramp(t, T.whyL2, T.whyL2 + 5, easeOut));
    return {
      eye: orbitPose(target, logLerp(360_000, 9_000, k), lerp(1.62, 1.15, k), lerp(1.16, 1.33, k)),
      focus: target,
      fov: 40,
    };
  }

  // Beat 4: cross to L2 and pull up so the whole Lissajous orbit fits.
  if (t < T.spin) {
    const k = ramp(t, T.arrive, T.spin, easeOut);
    const target = lerp3(ORIGIN, L2_POS, ramp(t, T.arrive, T.arrive + 5, easeInOut));
    return {
      eye: orbitPose(target, logLerp(9_000, 430, k), lerp(1.15, 2.2, k), lerp(1.33, 0.42, k)),
      focus: target,
      fov: lerp(40, 44, k),
    };
  }

  // Beat 5: close in on the spacecraft, near enough to read the two beams.
  if (t < T.survey) {
    const k = ramp(t, T.spin, T.survey, easeInOut);
    return {
      eye: orbitPose(L2_POS, logLerp(430, 42, k), lerp(2.2, 3.4, k), lerp(0.42, 0.3, k)),
      focus: L2_POS,
      fov: 44,
    };
  }

  // Beat 6: drift back but stay well inside the 300-unit coverage sphere. The point
  // of this beat is the sky filling in *around* the observer, which only works from
  // inside - retreating outside it would turn the sky into an object being examined.
  const k = ramp(t, T.survey, T.depart, easeInOut);
  return {
    eye: orbitPose(L2_POS, logLerp(42, 130, k), lerp(3.4, 4.5, k), lerp(0.3, 0.62, k)),
    focus: L2_POS,
    fov: lerp(44, 56, k),
  };
}

/** Camera for the corridor act: straight down the line of sight, then turn around. */
function corridorCamera(t: number): CameraPose {
  if (t < T.corridor) {
    const k = ramp(t, T.depart, T.corridor, easeInOut);
    const z = lerp(-14, 6, k);
    return {
      eye: [lerp(3, 0.6, k), lerp(2.2, 0.5, k), z],
      focus: [0, 0, z + 40],
      fov: lerp(52, 60, k),
    };
  }

  if (t < T.lookback) {
    // Linear in z, which is already logarithmic in real distance - so this is a
    // constant *apparent* rate of passing stars rather than a constant km/s.
    const k = ramp(t, T.corridor, T.lookback, easeInOut);
    const z = lerp(6, LMC_Z - 9, k);
    return { eye: [0.6, 0.5, z], focus: [0, 0, z + 40], fov: 60 };
  }

  // Swing around to face the way we came.
  const k = ramp(t, T.lookback, T.field, easeInOut);
  const z = lerp(LMC_Z - 9, LMC_Z - 2, k);
  const ang = lerp(0, Math.PI, k);
  return {
    eye: [0.6, 0.5, z],
    focus: [Math.sin(ang) * 30, 0, z + Math.cos(ang) * 40],
    fov: lerp(60, 48, k),
  };
}

/** Camera for the abstract field shots - a plain orbit is the right tool here. */
function fieldCamera(t: number): CameraPose {
  const distance =
    150 + 90 * ramp(t, T.field, T.parallax) - 40 * ramp(t, T.motion, T.classify);
  const azimuth = 0.35 + 0.9 * ramp(t, T.field, T.motion) + 0.5 * ramp(t, T.motion, T.verdict);
  const elevation = 0.18 + 0.3 * ramp(t, T.motion, T.verdict, easeInOut);
  return {
    eye: [
      distance * Math.cos(elevation) * Math.cos(azimuth),
      distance * Math.sin(elevation),
      distance * Math.cos(elevation) * Math.sin(azimuth),
    ],
    focus: [0, 0, 0],
    fov: 48,
  };
}

/**
 * The whole sequence, as one pure function of time.
 *
 * Written as absolute-time ramps rather than per-shot local state so that any two
 * beats can overlap - a camera move can begin before the previous caption clears,
 * which is what stops it feeling like a slideshow.
 */
export function sample(t: number): SceneState {
  const i = shotIndexAt(t);
  const shot = SHOTS[i];

  const world: World = t < T.depart ? "system" : t < T.field ? "corridor" : "field";

  const camera =
    world === "system" ? systemCamera(t)
      : world === "corridor" ? corridorCamera(t)
        : fieldCamera(t);

  // --- system layers -------------------------------------------------------
  const earthOpacity = 1 - ramp(t, T.lagrange + 5, T.lagrange + 11);
  const sunOpacity =
    ramp(t, T.lagrange + 2, T.lagrange + 8) * (1 - ramp(t, T.arrive, T.arrive + 5));
  const markerOpacity =
    ramp(t, T.lagrange + 6, T.lagrange + 10) * (1 - ramp(t, T.arrive + 4, T.arrive + 8));
  const contourOpacity =
    ramp(t, T.whyL2 + 1, T.whyL2 + 5) * (1 - ramp(t, T.arrive, T.arrive + 4));
  const orbitOpacity =
    ramp(t, T.lagrange + 4, T.lagrange + 9) * (1 - ramp(t, T.whyL2, T.whyL2 + 4));
  const lissajousOpacity =
    ramp(t, T.arrive + 1, T.arrive + 5) * (1 - ramp(t, T.spin + 2, T.spin + 6));

  const gaiaOpacity = ramp(t, T.arrive + 3, T.arrive + 7) * (1 - ramp(t, T.depart - 2, T.depart));
  const beamOpacity = ramp(t, T.spin + 1, T.spin + 4) * (1 - ramp(t, T.depart - 3, T.depart));
  const coverageOpacity = ramp(t, T.survey, T.survey + 4) * (1 - ramp(t, T.depart - 2, T.depart));

  // Mission clock. A handful of turns during the spin shot, then the full 4,045 days
  // of science operations. Only this drives the scanning law, so the spin, the
  // precession and the coverage map can never drift out of step with the HUD.
  const missionDays =
    ramp(t, T.spin, T.survey, (x) => x) * 1.5
    + ramp(t, T.survey + 1, T.depart - 1, easeInOut) * MISSION_DAYS;

  const labelSet: SceneState["labelSet"] =
    markerOpacity > 0.05 ? "lagrange" : world === "corridor" ? "corridor" : "none";

  // --- corridor ------------------------------------------------------------
  const corridorFade = ramp(t, T.depart, T.depart + 3) * (1 - ramp(t, T.field - 3, T.field));
  const corridorReveal = lerp(20, LMC_Z + 30, ramp(t, T.depart, T.lookback, easeInOut));
  const corridorHighlight = ramp(t, T.corridor + 6, T.corridor + 12);

  // --- field ---------------------------------------------------------------
  // Held low through the corridor. The panorama is a backdrop, and at the opacity
  // the later shots want it, it out-competes the 42,000 catalogue stars the corridor
  // is actually about - the frame reads as a photograph of the Milky Way with some
  // dust on it. It comes up only once the corridor is done.
  const skyboxOpacity =
    0.16 + 0.10 * ramp(t, T.depart, T.corridor) + 0.42 * ramp(t, T.lookback, T.field);
  const brightStarsOpacity =
    ramp(t, T.depart, T.corridor) * (1 - ramp(t, T.field - 4, T.field + 2));
  const fieldOpacity = ramp(t, T.field - 2, T.field + 4);

  const toDepth = ramp(t, T.parallax + 2, T.parallax + 12, easeInOut);
  const toPm = ramp(t, T.motion + 1, T.motion + 10, easeInOut);
  const backToDepth = ramp(t, T.resolve, T.resolve + 10, easeInOut);

  const wSky = Math.max(0, 1 - toDepth);
  const wDepth = Math.max(0, toDepth - toPm) + backToDepth;
  const wPm = Math.max(0, toPm - backToDepth);

  const truth = ramp(t, T.motion + 2, T.motion + 8);
  const prob = ramp(t, T.classify + 4, T.classify + 12);
  const err = ramp(t, T.verdict + 2, T.verdict + 8);

  return {
    t,
    shotIndex: i,
    shot,
    world,
    camera,

    earthOpacity,
    // Sped up so the rotation reads in a 9-second shot. Deliberately *not* tied to
    // the mission clock: this beat is establishing, and makes no numerical claim
    // about Earth's rotation that a wrong rate could contradict.
    earthSpin: t * 0.035,
    sunOpacity,
    contourOpacity,
    markerOpacity,
    orbitOpacity,
    lissajousOpacity,
    gaiaOpacity,
    beamOpacity,
    coverageOpacity,
    missionDays,
    labelSet,

    corridorReveal,
    corridorFade,
    corridorHighlight,

    skyboxOpacity,
    brightStarsOpacity,
    fieldOpacity,
    spaceWeights: [wSky, wDepth, wPm, 0],
    colorWeights: [
      Math.max(0, 1 - truth),
      Math.max(0, truth - prob),
      Math.max(0, prob - err),
      err,
    ],
    inferredDepth: backToDepth,
    vectorScale: window_(t, T.motion + 2, T.classify + 6, 3),
  };
}

/** Distance readout for the corridor HUD, in kpc, from a camera z. */
export function corridorDistanceKpc(z: number): number {
  return 0.05 * Math.pow(10, z / 26);
}

export { corridorZ, LMC_Z, LMC_DISTANCE_KPC };
