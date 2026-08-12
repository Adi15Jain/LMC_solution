/**
 * The four coordinate spaces the star field morphs between.
 *
 * This is the core mechanic of the whole piece: the same 250,000 particles are
 * never destroyed or recreated. Each star carries all four of its positions as
 * vertex attributes, and a weight vector blends between them in the vertex shader.
 * Stars physically *fly* from where they sit on the sky to where they sit in
 * proper-motion space — and that flight is the project's entire argument, made
 * visible for the cost of one lerp.
 */

export const SPACES = ["sky", "depth", "pm", "cmd"] as const;
export type Space = (typeof SPACES)[number];

export const SPACE_INDEX: Record<Space, number> = { sky: 0, depth: 1, pm: 2, cmd: 3 };

export interface SpaceInfo {
  id: Space;
  label: string;
  axes: [string, string];
  /** One line explaining what this view reveals — shown in the HUD. */
  insight: string;
}

export const SPACE_INFO: Record<Space, SpaceInfo> = {
  sky: {
    id: "sky",
    label: "On the sky",
    axes: ["right ascension", "declination"],
    insight: "What Gaia sees. Two galaxies overlapping on one patch of sky — indistinguishable.",
  },
  depth: {
    id: "depth",
    label: "With distance",
    axes: ["right ascension", "declination"],
    insight: "The LMC sits ~50 kpc away. But Gaia's parallax barely reaches that far.",
  },
  pm: {
    id: "pm",
    label: "Proper motion",
    axes: ["pmra (mas/yr)", "pmdec (mas/yr)"],
    insight: "The LMC moves as one body. Here it collapses into a tight clump — this is the signal.",
  },
  cmd: {
    id: "cmd",
    label: "Colour–magnitude",
    axes: ["bp_rp (colour)", "G magnitude"],
    insight: "Two populations, two stellar sequences. Weaker signal, but real.",
  },
};

/** How the field is coloured. Blended, so transitions cross-fade. */
export const COLOR_MODES = ["neutral", "truth", "probability", "error"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const COLOR_MODE_INDEX: Record<ColorMode, number> = {
  neutral: 0,
  truth: 1,
  probability: 2,
  error: 3,
};

/**
 * Build a 4-component weight vector with a single space at full strength.
 * Cross-fades are produced by lerping two of these.
 */
export function weightsFor(space: Space): [number, number, number, number] {
  const w: [number, number, number, number] = [0, 0, 0, 0];
  w[SPACE_INDEX[space]] = 1;
  return w;
}

export function colorWeightsFor(mode: ColorMode): [number, number, number, number] {
  const w: [number, number, number, number] = [0, 0, 0, 0];
  w[COLOR_MODE_INDEX[mode]] = 1;
  return w;
}

/** Which analysis panel accompanies an act. */
export type Panel = "none" | "distributions" | "importance" | "matrix" | "controls";

export interface Act {
  id: string;
  title: string;
  body: string;
  space: Space;
  color: ColorMode;
  panel: Panel;
  /** For distribution acts: which feature's histogram to foreground. */
  feature?: string;
}

export const ACTS: Act[] = [
  {
    id: "hook",
    title: "Which of these is not from around here?",
    body: "1.27 million stars in one patch of southern sky. About 22% of them belong to a different galaxy 160,000 light-years away. Nothing in this view tells you which.",
    space: "sky",
    color: "neutral",
    panel: "none",
  },
  {
    id: "gaia",
    title: "What the satellite actually measures",
    body: "Gaia records five numbers per star: where it is, how far (parallax), how fast it drifts across the sky in two directions (proper motion), and how bright it is in three colour bands. No labels. Everything downstream is built from these.",
    space: "sky",
    color: "neutral",
    panel: "none",
  },
  {
    id: "box",
    title: "The trap in the data",
    body: "Colour by the truth label and a problem appears: the LMC sits inside a hard rectangle — RA 67.3 to 94.0, Dec -72.5 to -65.2. That is the simulation's selection box, not astrophysics. A model handed sky position would memorise this rectangle, score almost perfectly, and learn nothing. So we exclude ra and dec from the features entirely.",
    space: "sky",
    color: "truth",
    panel: "none",
  },
  {
    id: "depth",
    title: "Distance should separate them — but barely does",
    body: "The LMC is ~50 kpc away, so its parallax is essentially zero. But Gaia's parallax uncertainty at that distance is larger than the signal, and roughly half the LMC's measured parallaxes come out negative. This is why parallax ends up contributing almost nothing to the model.",
    space: "depth",
    color: "truth",
    panel: "distributions",
    feature: "parallax",
  },
  {
    id: "motion",
    title: "The galaxy that moves as one",
    body: "Proper motion is the real signal. Every LMC star shares the galaxy's bulk drift, so in motion space they collapse into one tight clump while Milky Way stars scatter. Same 250,000 stars as the previous view — only the coordinate system changed.",
    space: "pm",
    color: "truth",
    panel: "distributions",
    feature: "pm_total",
  },
  {
    id: "colour",
    title: "Two stellar populations",
    body: "Colour against brightness. The two galaxies trace visibly different sequences — an older, redder LMC population against the Milky Way's foreground dwarfs. Weaker than motion, but genuinely independent information.",
    space: "cmd",
    color: "truth",
    panel: "distributions",
    feature: "bp_rp",
  },
  {
    id: "model",
    title: "What the model actually learned",
    body: "An XGBoost ensemble over 11 physical features. Recolour every star by its predicted probability and the boundary appears. The importances confirm the story: motion carries the model almost entirely, and parallax — despite being the textbook distance measure — is nearly worthless here.",
    space: "pm",
    color: "probability",
    panel: "importance",
  },
  {
    id: "verdict",
    title: "Where the model is wrong",
    body: "Held-out test set only — 253,941 stars the model never trained on. Click any quadrant to isolate those stars in the cloud, and drag the threshold to watch precision trade against recall. The false positives are the interesting ones: Milky Way stars whose motion happens to match the LMC's.",
    space: "pm",
    color: "error",
    panel: "matrix",
  },
  {
    id: "sandbox",
    title: "Explore it yourself",
    body: "Free camera and manual control over every dimension of the view.",
    space: "pm",
    color: "probability",
    panel: "controls",
  },
];
