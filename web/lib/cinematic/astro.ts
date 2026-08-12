/**
 * Verified physical constants and the restricted three-body maths behind Shot 1.
 *
 * Every number here has a source in the comment beside it. Nothing is tuned by eye:
 * where a value is exaggerated for visibility (spin rate, spacecraft size) it is
 * exposed as an explicit named factor so the UI can display it, rather than being
 * quietly folded into a magic number.
 *
 * Sources
 *   Scanning law (60"/s, 6 h, 63 d, 45deg)   Gaia EDR3 docs, sec 1.1.4
 *   Basic angle 106.5deg, FOV 1.7deg x 0.6deg  ESA / Gaia payload module
 *   L2 distance, Lissajous 340000x90000 km   ESA Gaia fact sheet
 *   Launch / end of science                  ESA, 19 Dec 2013 - 15 Jan 2025
 *   LMC distance 49.59 +/- 0.09 +/- 0.54 kpc Pietrzynski et al. 2019, Nature 567
 */

// ---------------------------------------------------------------- scene units

/**
 * One world unit = 1000 km, for every shot that lives in the solar system.
 *
 * Chosen so the whole range of interest fits comfortably inside float32:
 * Earth's radius is 6.371 units, L2 is 1500, the Sun is 149,600. A metre-scale
 * unit would put the Sun at 1.5e11 and lose all precision near Earth.
 *
 * The star-field shots use their own abstract space; the two never share a frame.
 */
export const KM = 1e-3;

// ------------------------------------------------------------------ the bodies

export const EARTH_RADIUS_KM = 6371;
export const EARTH_TILT_RAD = (23.44 * Math.PI) / 180;
/** Sidereal day, seconds. Not 86400 - that is the *solar* day. */
export const EARTH_DAY_S = 86164.1;

export const SUN_RADIUS_KM = 695_700;
/** 1 astronomical unit. */
export const AU_KM = 149_597_871;

export const MOON_ORBIT_KM = 384_400;
export const MOON_RADIUS_KM = 1737;

// --------------------------------------------------------------------- Gaia

/** ESA fact sheet: 1.5 million km from Earth, anti-sunward. */
export const L2_DISTANCE_KM = 1.5e6;

/** Lissajous orbit around L2, ESA fact sheet: typically 340,000 x 90,000 km. */
export const LISSAJOUS_A_KM = 340_000 / 2;
export const LISSAJOUS_B_KM = 90_000 / 2;
/** Period of that orbit, days. */
export const LISSAJOUS_PERIOD_D = 180;

/** Spin: 60 arcsec/s about the spin axis -> exactly 6 hours per revolution. */
export const SPIN_PERIOD_S = 6 * 3600;
export const SPIN_RATE_ARCSEC_S = 60;

/** The spin axis precesses around the Sun direction with this period. */
export const PRECESSION_PERIOD_D = 63;

/** Angle between the spin axis and the Sun direction. Fixed by thermal design. */
export const SOLAR_ASPECT_ANGLE_RAD = (45 * Math.PI) / 180;

/** Separation between the two telescopes' lines of sight. */
export const BASIC_ANGLE_RAD = (106.5 * Math.PI) / 180;

/** Each astrometric field of view, radians. 1.7deg along scan x 0.6deg across. */
export const FOV_ALONG_RAD = (1.7 * Math.PI) / 180;
export const FOV_ACROSS_RAD = (0.6 * Math.PI) / 180;

export const LAUNCH_DATE = "19 December 2013";
export const SCIENCE_END_DATE = "15 January 2025";
/** Days of science operations, launch to end of observations. */
export const MISSION_DAYS = 4045;
export const LAUNCH_MASS_KG = 2030;

/**
 * A quiet coincidence worth putting on screen: the basic angle in degrees and the
 * field-crossing delay in minutes are the same number. 106.5deg of a 360deg turn that
 * takes 360 minutes is 106.5 minutes. A star seen by the leading telescope is seen
 * by the trailing one 106.5 minutes later, and comparing those two views across a
 * wide angle is what makes the parallaxes absolute rather than relative.
 */
export const FIELD_CROSSING_DELAY_MIN =
  (BASIC_ANGLE_RAD / (2 * Math.PI)) * (SPIN_PERIOD_S / 60);

// ------------------------------------------------------------- the LMC target

/** Pietrzynski et al. 2019 - the 1% distance. Inferred for our stars, never measured. */
export const LMC_DISTANCE_KPC = 49.59;
export const LMC_DISTANCE_STAT_KPC = 0.09;
export const LMC_DISTANCE_SYS_KPC = 0.54;

/** Centre of the LMC field, degrees. Matches RA0/DEC0 in scripts/export_web_data.py. */
export const LMC_RA_DEG = 80.9;
export const LMC_DEC_DEG = -69.3;

export const PC_KM = 3.0857e13;

// ------------------------------------------------ restricted three-body problem

/**
 * Mass ratio mu = M_earth / (M_sun + M_earth).
 *
 * Strictly this should be the Earth+Moon barycentre, since the Moon orbits well
 * inside the L1/L2 region and the pair moves as one body on this timescale. Using
 * the Earth alone shifts L2 by about 5000 km - small, but free to get right.
 */
export const SUN_MASS_KG = 1.98847e30;
export const EARTH_MOON_MASS_KG = 5.9722e24 + 7.342e22;
export const MU = EARTH_MOON_MASS_KG / (SUN_MASS_KG + EARTH_MOON_MASS_KG);

/**
 * Collinear-point equation in the co-rotating, normalised frame.
 *
 * Units: Sun-Earth separation = 1, total mass = 1, angular velocity = 1, origin at
 * the barycentre. The Sun sits at -mu, the Earth at 1-mu.
 *
 * Every term is a force per unit mass along x:
 *   x                       centrifugal, outward
 *   -(1-mu)(x+mu)/r1^3      the Sun's pull
 *   -mu(x-1+mu)/r2^3        the Earth's pull
 *
 * A root is a place where they cancel: an object put there co-rotates with the
 * Earth-Sun line and stays put. This single function has all three collinear roots.
 */
export function collinearResidual(x: number): number {
  const d1 = x + MU;
  const d2 = x - 1 + MU;
  const r1 = Math.abs(d1);
  const r2 = Math.abs(d2);
  return x - ((1 - MU) * d1) / (r1 * r1 * r1) - (MU * d2) / (r2 * r2 * r2);
}

/**
 * Bisection rather than Newton.
 *
 * The residual has poles at the Sun and the Earth, and Newton started anywhere near
 * one of them will happily step across a singularity into the wrong root. Bisection
 * on a bracket that excludes the poles cannot do that. 200 iterations takes it to
 * float64 precision and costs nothing - this runs once at module load.
 */
function bisect(lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  let fa = collinearResidual(a);
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b);
    const fm = collinearResidual(m);
    if (fa * fm <= 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

export interface LagrangePoint {
  id: "L1" | "L2" | "L3" | "L4" | "L5";
  /** Position in the co-rotating frame, units of the Sun-Earth separation. */
  x: number;
  y: number;
  /** Signed distance from Earth along the Sun-Earth line, km. Null for L4/L5. */
  fromEarthKm: number | null;
  stable: boolean;
  note: string;
}

const earthX = 1 - MU;

/** All five points, solved rather than quoted. */
export const LAGRANGE: LagrangePoint[] = (() => {
  // Brackets chosen to sit strictly between the poles (at -MU and 1-MU).
  const l1x = bisect(earthX - 0.05, earthX - 1e-5);
  const l2x = bisect(earthX + 1e-5, earthX + 0.05);
  const l3x = bisect(-1.5, -0.5);

  const km = (x: number) => (x - earthX) * AU_KM;

  return [
    {
      id: "L1", x: l1x, y: 0, fromEarthKm: km(l1x), stable: false,
      note: "Sunward. Earth's pull subtracts, so a shorter orbit keeps period.",
    },
    {
      id: "L2", x: l2x, y: 0, fromEarthKm: km(l2x), stable: false,
      note: "Anti-sunward. Earth's pull adds to the Sun's.",
    },
    {
      id: "L3", x: l3x, y: 0, fromEarthKm: null, stable: false,
      note: "Opposite the Sun, permanently hidden from Earth.",
    },
    // L4/L5 are exact: they close an equilateral triangle with the two masses.
    { id: "L4", x: 0.5 - MU, y: Math.sqrt(3) / 2, fromEarthKm: null, stable: true,
      note: "60deg ahead. Genuinely stable - it collects dust and asteroids." },
    { id: "L5", x: 0.5 - MU, y: -Math.sqrt(3) / 2, fromEarthKm: null, stable: true,
      note: "60deg behind. Stable for the same reason." },
  ];
})();

export const L2 = LAGRANGE[1];

/**
 * Effective potential in the co-rotating frame.
 *
 *   Omega = 1/2 (x^2 + y^2) + (1-mu)/r1 + mu/r2
 *
 * The first term is the centrifugal potential, the other two are gravity. Contours
 * of Omega are what make the five points legible: L1/L2/L3 sit on saddles, L4/L5 on
 * maxima. This is the honest picture of "why here" - not a balance of two gravities,
 * but a balance of gravity against the motion needed to keep station.
 */
export function effectivePotential(x: number, y: number): number {
  const r1 = Math.hypot(x + MU, y);
  const r2 = Math.hypot(x - 1 + MU, y);
  return 0.5 * (x * x + y * y) + (1 - MU) / r1 + MU / r2;
}

/**
 * The one-line answer to "why is L2 further out, if gravity is stronger there?"
 *
 * Kepler says a circular orbit at 1.01 AU around the Sun alone takes longer than a
 * year, so an unpowered probe out there would fall behind the Earth. At L2 the Earth
 * is pulling in the *same* direction as the Sun; the extra pull is exactly what a
 * 365.25-day orbit at that larger radius requires. Returns the two periods in days.
 */
export function orbitalPeriodComparison(): { sunOnly: number; withEarth: number; radiusAu: number } {
  const r = L2.x + MU; // distance from the Sun in AU
  return {
    // Kepler's third law, T proportional to r^(3/2), with the Earth's year as the anchor.
    sunOnly: 365.25 * Math.pow(r, 1.5),
    withEarth: 365.25,
    radiusAu: r,
  };
}

// ------------------------------------------------------------------- scanning

/**
 * Gaia's spin-axis direction at mission time `days`, in ecliptic coordinates.
 *
 * The nominal scanning law: the axis stays at a fixed 45deg from the Sun and walks
 * around that direction once every 63 days, while the Sun direction itself moves
 * once a year. The two rates together are what tile the sky - a fixed axis would
 * scan one great circle forever.
 *
 * Returns a unit vector in the scene's Y-up frame.
 */
export function spinAxis(days: number): [number, number, number] {
  const sunLon = (2 * Math.PI * days) / 365.25;
  const nu = (2 * Math.PI * days) / PRECESSION_PERIOD_D;
  const xi = SOLAR_ASPECT_ANGLE_RAD;

  // Sun direction in the ecliptic plane (scene: x-z plane, y is ecliptic north).
  const s: [number, number, number] = [Math.cos(sunLon), 0, Math.sin(sunLon)];
  // Two axes perpendicular to the Sun direction, to sweep the precession cone.
  const e1: [number, number, number] = [0, 1, 0];
  const e2: [number, number, number] = [-Math.sin(sunLon), 0, Math.cos(sunLon)];

  const c = Math.cos(xi);
  const sn = Math.sin(xi);
  const a = Math.cos(nu) * sn;
  const b = Math.sin(nu) * sn;

  return [
    c * s[0] + a * e1[0] + b * e2[0],
    c * s[1] + a * e1[1] + b * e2[1],
    c * s[2] + a * e1[2] + b * e2[2],
  ];
}

/** Spin phase in radians at mission time `days` - exactly 4 turns per day. */
export function spinPhase(days: number): number {
  return (2 * Math.PI * days * 86400) / SPIN_PERIOD_S;
}

// -------------------------------------------------------------- presentation

/**
 * Where the model is not to scale, say so and say by how much.
 *
 * Gaia is 10 m across and L2 is 1.5e6 km from Earth: at true scale the spacecraft is
 * 1e-8 of the distance we watch it travel, which is not a rendering problem so much
 * as a physical impossibility on one screen. Rather than silently cheating, the shot
 * carries a live exaggeration readout driven by this number.
 */
export const GAIA_TRUE_DIAMETER_M = 10;

export function exaggerationLabel(factor: number): string {
  if (factor < 1.5) return "to scale";
  if (factor < 1000) return `×${Math.round(factor)}`;
  if (factor < 1e6) return `×${(factor / 1e3).toFixed(0)}k`;
  return `×${(factor / 1e6).toFixed(1)}M`;
}
