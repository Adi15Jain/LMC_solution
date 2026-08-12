/**
 * Shot 3: the line of sight.
 *
 * The camera leaves Gaia and travels along one boresight until the LMC is ahead of
 * it. What it passes through on the way is the entire problem: Milky Way stars at a
 * few hundred parsecs, sitting in front of a galaxy fifty kiloparsecs away, and
 * every one of them projecting onto the same patch of sky.
 *
 * These are the real catalogue stars - the same `stars.bin` the classifier is
 * trained on - placed at real distances, not scattered for effect:
 *
 *   Milky Way stars   1/parallax, as measured. Parallax is genuinely usable here:
 *                     43% of them have SNR > 3, spanning about 0.33 to 2.73 kpc.
 *   LMC stars         49.59 kpc, inferred from the classification, never measured.
 *                     Permanently captioned as such - their own parallaxes are
 *                     14x smaller than their error bars and 47% come out negative.
 *
 * Depth is drawn on a log scale, because a linear one would put every Milky Way star
 * in the first 6% of the corridor and leave the rest empty. The scale bar on screen
 * is logarithmic and labelled, so the compression is visible rather than implied.
 */

import * as THREE from "three";
import { LMC_DISTANCE_KPC } from "../astro";

export interface StarBlocks {
  count: number;
  skyX: Int16Array;
  skyY: Int16Array;
  depth: Int16Array;
  gmag: Int16Array;
  bpRp: Int16Array;
  type: Uint8Array;
  ranges: Record<string, { lo: number; hi: number }>;
}

/** Scene length assigned to one decade of distance. */
const DECADE = 26;
/** Distance, in kpc, that sits at the corridor origin. */
const NEAR_KPC = 0.05;
/** Height of the distance rule below the corridor axis; labels must match it. */
export const AXIS_Y = -3.2;

export const corridorZ = (kpc: number) =>
  (Math.log10(Math.max(kpc, NEAR_KPC)) - Math.log10(NEAR_KPC)) * DECADE;

export const LMC_Z = corridorZ(LMC_DISTANCE_KPC);

const VERT = /* glsl */ `
  attribute float aType;
  attribute float aMag;
  attribute float aCI;

  uniform float uPixelRatio;
  uniform float uPointScale;
  uniform float uReveal;     // corridor z reached so far; stars beyond are hidden
  uniform float uFade;

  varying float vType;
  varying float vCI;
  varying float vAlpha;

  void main() {
    vType = aType;
    vCI = aCI;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    // Brighter stars are bigger, and everything shrinks with distance from the
    // camera the way a real point source does.
    float bright = clamp((20.5 - aMag) / 9.9, 0.0, 1.0);
    float dist = max(1.0, -mv.z);
    gl_PointSize = uPointScale * uPixelRatio * (0.30 + 1.5 * bright) * (46.0 / dist);
    gl_PointSize = clamp(gl_PointSize, 0.5, 14.0);

    // Reveal along the corridor so the field builds ahead of the camera instead of
    // being there from frame one.
    float ahead = smoothstep(uReveal + 22.0, uReveal - 8.0, position.z);

    // Fade stars that are very close to the camera.
    //
    // Flying *through* a shell of 40,000 additive sprites saturates every pixel to
    // white - the first cut of this shot was an unreadable blob. Attenuating the
    // nearest ones keeps the local density low enough to see structure through, and
    // it reads naturally: things streak past and are gone rather than piling up.
    float near = smoothstep(3.0, 16.0, dist);

    vAlpha = ahead * near * uFade * (0.24 + 0.70 * bright);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uHighlightMw;   // 0..1, pushes Milky Way stars forward in the mix
  varying float vType;
  varying float vCI;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.85, 0.0, r);
    float halo = pow(max(0.0, 1.0 - r), 2.2) * 0.35;

    // Colour index -> tint, same mapping as the backdrop stars so the two layers
    // look like one sky.
    float t = clamp((vCI + 0.4) / 2.4, 0.0, 1.0);
    vec3 natural = vec3(0.66 + 0.34 * t, 0.76 + 0.16 * t - 0.20 * t * t, 1.0 - 0.52 * t * t);

    // The classification colours: Milky Way cool, LMC warm.
    vec3 mw = vec3(0.42, 0.66, 1.0);
    vec3 lmc = vec3(1.0, 0.74, 0.32);
    vec3 tagged = mix(mw, lmc, vType);

    vec3 col = mix(natural, tagged, uHighlightMw);
    // Exposure. Additive blending has no natural ceiling, so overlapping sprites keep
    // summing past white; this is the one knob that decides whether a dense region
    // reads as a star field or as fog.
    float a = (core + halo) * vAlpha * 0.72;
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * The distance axis: a rule running down the corridor with a tick at each decade.
 *
 * Without it the depth compression is invisible - the tick *labels* float in space
 * attached to nothing, and a viewer has no way to see that the gap between 1 and
 * 10 kpc is the same on screen as the gap between 0.1 and 1. Drawing the ruler is
 * what turns "trust me, it's logarithmic" into something you can read off.
 */
function makeAxis(ticks: { z: number }[]): {
  line: THREE.LineSegments; material: THREE.LineBasicMaterial;
} {
  const pts: number[] = [];
  const zEnd = ticks[ticks.length - 1].z;

  // The spine, broken into segments so it can fade along its length in the shader-free
  // way: vertex colours.
  const N = 120;
  const colors: number[] = [];
  for (let i = 0; i < N; i++) {
    const z0 = (i / N) * zEnd;
    const z1 = ((i + 1) / N) * zEnd;
    pts.push(0, AXIS_Y, z0, 0, AXIS_Y, z1);
    // Dim, and dimmer still at the far end where it would otherwise draw the eye
    // away from the LMC.
    const a = 0.30 * (1 - (i / N) * 0.55);
    colors.push(a, a * 1.05, a * 1.25, a, a * 1.05, a * 1.25);
  }

  for (const tk of ticks) {
    pts.push(-1.1, AXIS_Y, tk.z, 1.1, AXIS_Y, tk.z);
    colors.push(0.9, 0.72, 0.36, 0.9, 0.72, 0.36);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const line = new THREE.LineSegments(geo, material);
  line.frustumCulled = false;
  return { line, material };
}

export interface CorridorRig {
  points: THREE.Points;
  /** The distance rule; add to the same group as `points`. */
  axis: THREE.LineSegments;
  /** Distance ticks along the corridor, for DOM labels. */
  ticks: { kpc: number; z: number; label: string }[];
  setReveal: (z: number) => void;
  setFade: (v: number) => void;
  /** 0 = natural star colours, 1 = coloured by which galaxy they belong to. */
  setHighlight: (v: number) => void;
  setPixelRatio: (v: number) => void;
  dispose: () => void;
}

/**
 * Build the corridor from the catalogue.
 *
 * `stride` subsamples: 250k points is more than this shot can use, and at the far
 * end they collapse into a solid wall that hides the structure. Every Nth star is an
 * unbiased sample because the export is already in catalogue order, not sorted by
 * any column that correlates with class.
 */
export function makeCorridor(blocks: StarBlocks, stride = 3): CorridorRig {
  const { ranges } = blocks;
  const n = Math.floor(blocks.count / stride);

  const pos = new Float32Array(n * 3);
  const type = new Float32Array(n);
  const mag = new Float32Array(n);
  const ci = new Float32Array(n);

  // int16 attributes were written normalised to [-1,1]; undo that to real units.
  const deq = (v: number, r: { lo: number; hi: number }) =>
    r.lo + ((v / 32767 + 1) / 2) * (r.hi - r.lo);

  const lmcZ = corridorZ(LMC_DISTANCE_KPC);
  const DEG = Math.PI / 180;

  for (let k = 0; k < n; k++) {
    const i = k * stride;

    // Tangent-plane offsets in degrees -> a direction within the field.
    const dx = deq(blocks.skyX[i], ranges.skyX) * DEG;
    const dy = deq(blocks.skyY[i], ranges.skyY) * DEG;

    const isLmc = blocks.type[i] > 127;
    let z: number;
    if (isLmc) {
      // Inferred, not measured. A little scatter so the shell reads as a galaxy with
      // real depth (the LMC is about 2 kpc thick) rather than a painted backdrop.
      const jitter = 1 + (((i * 2654435761) % 1000) / 1000 - 0.5) * 0.04;
      z = corridorZ(LMC_DISTANCE_KPC * jitter);
    } else {
      // log10(kpc), straight from the export.
      const d = deq(blocks.depth[i], ranges.depth);
      z = corridorZ(Math.pow(10, d));
    }

    // Gnomonic offsets are tangents of the angle, so this inverts the projection
    // exactly rather than using a small-angle approximation.
    pos[k * 3] = Math.tan(dx) * z;
    pos[k * 3 + 1] = Math.tan(dy) * z;
    pos[k * 3 + 2] = z;

    type[k] = isLmc ? 1 : 0;
    mag[k] = deq(blocks.gmag[i], ranges.gmag);
    ci[k] = deq(blocks.bpRp[i], ranges.bp_rp);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aType", new THREE.BufferAttribute(type, 1));
  geo.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
  geo.setAttribute("aCI", new THREE.BufferAttribute(ci, 1));

  const uniforms = {
    uPixelRatio: { value: 1 },
    uPointScale: { value: 2.4 },
    uReveal: { value: 0 },
    uFade: { value: 0 },
    uHighlightMw: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const ticks = [0.1, 1, 10, LMC_DISTANCE_KPC].map((kpc) => ({
    kpc,
    z: corridorZ(kpc),
    label: kpc === LMC_DISTANCE_KPC ? `${kpc} kpc — LMC` : `${kpc} kpc`,
  }));

  const axis = makeAxis(ticks);

  void lmcZ;

  return {
    points,
    axis: axis.line,
    ticks,
    setReveal: (z) => { uniforms.uReveal.value = z; },
    setFade: (v) => {
      uniforms.uFade.value = v;
      points.visible = v > 0.01;
      axis.material.opacity = v;
      axis.line.visible = v > 0.01;
    },
    setHighlight: (v) => { uniforms.uHighlightMw.value = v; },
    setPixelRatio: (v) => { uniforms.uPixelRatio.value = v; },
    dispose: () => {
      geo.dispose(); mat.dispose();
      axis.line.geometry.dispose(); axis.material.dispose();
    },
  };
}
