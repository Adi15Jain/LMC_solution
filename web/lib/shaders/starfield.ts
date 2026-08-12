/**
 * The star-field shader — four coordinate spaces blended on the GPU.
 *
 * Every star ships all four of its positions as attributes. `uSpaceWeights`
 * blends between them, so morphing 250,000 stars from sky coordinates into
 * proper-motion space costs one lerp per vertex and zero CPU work.
 *
 * All position attributes arrive as `normalized` int16, which means the GPU
 * hands them back in [-1, 1] — and that range IS the plotting coordinate.
 * No dequantisation in the hot path at all.
 */

import { Vector3, Vector4 } from "three";

export const starVertexShader = /* glsl */ `
  attribute vec2  aSky;    // gnomonic tangent-plane x, y
  attribute vec2  aPm;     // pmra, pmdec
  attribute vec2  aCmd;    // bp_rp, g_mag
  attribute float aDepth;  // log distance from measured parallax
  attribute float aType;   // 0.0 = Milky Way, 1.0 = LMC
  attribute float aProb;   // predicted P(LMC), 0..1
  attribute float aIsTest; // 1.0 if in the held-out split

  uniform vec4  uSpaceWeights;  // sky, depth, pm, cmd — blended, need not be one-hot
  uniform vec3  uExtent;        // world-space size of the plotting volume
  uniform float uDepthScale;
  uniform float uTruthDepth;    // 0 = measured parallax (honest, noisy), 1 = schematic
  uniform float uPointScale;
  uniform float uPixelRatio;
  uniform float uThreshold;
  uniform float uCell;          // -1 none, 0 TN, 1 FP, 2 FN, 3 TP
  uniform float uTestOnly;      // 1 = fade everything not in the held-out split

  varying float vType;
  varying float vProb;
  varying float vBright;
  varying float vFocus;   // 1 = fully in focus, ~0 = dimmed context

  void main() {
    // --- the four spaces -------------------------------------------------
    vec3 pSky = vec3(aSky.x, aSky.y, 0.0) * uExtent;

    // Measured depth is deliberately messy: at LMC distance Gaia's parallax
    // error swamps the signal, so many stars land nonsensically near. The
    // schematic view is clean but is NOT a measurement — the UI must say so.
    float zMeasured  = -aDepth;
    float zSchematic = mix(-0.25, -1.0, aType);   // MW near, LMC far
    float z = mix(zMeasured, zSchematic, uTruthDepth) * uDepthScale;
    vec3 pDepth = vec3(aSky.x * uExtent.x, aSky.y * uExtent.y, z);

    vec3 pPm = vec3(aPm.x, aPm.y, 0.0) * uExtent;

    // Magnitudes run backwards — brighter is a *smaller* number — so flip Y.
    vec3 pCmd = vec3(aCmd.x, -aCmd.y, 0.0) * uExtent;

    // --- blend -----------------------------------------------------------
    vec4 w = uSpaceWeights / max(dot(uSpaceWeights, vec4(1.0)), 1e-4);
    vec3 pos = pSky * w.x + pDepth * w.y + pPm * w.z + pCmd * w.w;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // --- focus: which stars the current view is "about" -------------------
    float focus = 1.0;

    // Held-out filter: training rows fade to context so the error view is honest.
    focus *= mix(1.0, mix(0.06, 1.0, aIsTest), uTestOnly);

    // Confusion-matrix cell selection: light up exactly one quadrant.
    // Reading order matches the matrix on screen: 0 TN, 1 FP, 2 FN, 3 TP.
    if (uCell >= 0.0) {
      float predicted = step(uThreshold, aProb);
      float uiCell = aType * 2.0 + predicted;
      focus *= (abs(uiCell - uCell) < 0.5) ? 1.0 : 0.04;
    }
    vFocus = focus;

    // --- size: brighter stars are bigger --------------------------------
    // aCmd.y is normalised G magnitude in [-1,1]; -1 is the brightest star.
    vBright = 1.0 - (aCmd.y + 1.0) * 0.5;
    float size = uPointScale * mix(0.5, 2.2, vBright) * uPixelRatio;
    // Selected stars stay full size; dimmed context also shrinks, which is what
    // actually makes a highlighted quadrant readable inside a dense cloud.
    size *= mix(0.55, 1.0, focus);
    gl_PointSize = size * (260.0 / max(-mvPosition.z, 0.1));

    vType = aType;
    vProb = aProb;
  }
`;

export const starFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec4  uColorWeights;  // neutral, truth, probability, error
  uniform float uThreshold;     // decision threshold for the error view
  uniform float uOpacity;
  uniform float uExposure;      // master brightness — the saturation control

  varying float vType;
  varying float vProb;
  varying float vBright;
  varying float vFocus;

  const vec3 C_DIM    = vec3(0.80, 0.84, 0.96);
  const vec3 C_MW     = vec3(0.38, 0.56, 0.95);
  const vec3 C_LMC    = vec3(1.00, 0.52, 0.10);
  const vec3 C_LOW    = vec3(0.16, 0.40, 0.92);
  const vec3 C_HIGH   = vec3(1.00, 0.58, 0.06);
  const vec3 C_OK     = vec3(0.18, 0.21, 0.28);
  const vec3 C_WRONG  = vec3(1.00, 0.13, 0.30);

  void main() {
    // Round sprite with a soft core — cheap, and reads as a star rather than a dot.
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    float alpha = smoothstep(0.5, 0.08, r);
    float core  = smoothstep(0.28, 0.0, r);

    vec3 cNeutral = C_DIM;
    vec3 cTruth   = mix(C_MW, C_LMC, vType);
    vec3 cProb    = mix(C_LOW, C_HIGH, smoothstep(0.0, 1.0, vProb));

    // Highlight exactly the stars the model gets wrong.
    float predicted = step(uThreshold, vProb);
    float wrong = abs(predicted - vType);
    vec3 cError = mix(C_OK, C_WRONG, wrong);

    vec4 w = uColorWeights / max(dot(uColorWeights, vec4(1.0)), 1e-4);
    vec3 color = cNeutral * w.x + cTruth * w.y + cProb * w.z + cError * w.w;

    // A modest core lift keeps individual stars crisp. Kept small on purpose:
    // with additive blending, dense regions accumulate fast, and an aggressive
    // core boost is what blew the LMC clump out to a featureless white disc.
    color += core * 0.18 * (0.3 + vBright);

    // Errors are the point of the error view, so let them punch through.
    color += core * wrong * w.w * 0.9;

    gl_FragColor = vec4(color, alpha * uOpacity * uExposure * vFocus);
  }
`;

/**
 * Uniform defaults.
 *
 * These objects are mutated in place inside `useFrame` — never replaced, and never
 * routed through React state. A `setState` per frame would re-render the tree 60
 * times a second and tank the frame rate; this is the single most important
 * performance rule in the whole app.
 */
export function createStarUniforms() {
  return {
    uSpaceWeights: { value: new Vector4(1, 0, 0, 0) },
    uColorWeights: { value: new Vector4(1, 0, 0, 0) },
    uExtent: { value: new Vector3(100, 100, 100) },
    uDepthScale: { value: 60 },
    uTruthDepth: { value: 0 },
    uPointScale: { value: 2.0 },
    uPixelRatio: { value: 1 },
    uThreshold: { value: 0.5 },
    uOpacity: { value: 1 },
    // Additive blending accumulates fast at 250k points. 0.32 keeps the dense
    // LMC core reading as orange instead of saturating to white — it is the
    // single most important visual-quality knob in the app, so it is also
    // exposed as a slider rather than hard-coded on a guess.
    uExposure: { value: 0.32 },
    uCell: { value: -1 },
    uTestOnly: { value: 0 },
  };
}

export type StarUniforms = ReturnType<typeof createStarUniforms>;
