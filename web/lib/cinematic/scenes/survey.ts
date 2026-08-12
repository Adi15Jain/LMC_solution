/**
 * Shot 2: how Gaia actually surveys the sky.
 *
 * Three motions, all at their real rates and all independent:
 *   - a 6-hour spin about the spacecraft axis
 *   - a 63-day precession of that axis around the Sun direction, at a fixed 45 degrees
 *   - the annual march of the Sun direction itself
 *
 * Nothing here is a decorative rotation. The reason the sky fills in at all is that
 * those three periods are mutually incommensurate: a fixed spin axis would retrace
 * one great circle forever, and it is the slow precession that walks the circle
 * across the sphere. That is the point of the shot, so the rates have to be exact.
 *
 * The two fields of view are separated by the 106.5 degree basic angle and both lie
 * in the plane perpendicular to the spin axis, which is why a star crossing the
 * leading field is seen again by the trailing one 106.5 minutes later. Comparing two
 * widely separated directions at once is what makes Gaia's parallaxes absolute
 * instead of relative to some assumed-distant reference frame.
 */

import * as THREE from "three";
import {
  BASIC_ANGLE_RAD, FOV_ACROSS_RAD, FOV_ALONG_RAD, MISSION_DAYS, SPIN_PERIOD_S,
  spinAxis, spinPhase,
} from "../astro";

/** Along-scan is the narrow axis (0.6 deg); across-scan is the wide one (1.7 deg).
 *  Check: 0.6 deg at 60 arcsec/s is a 36-second transit, which matches the real
 *  focal-plane crossing time. The wide axis is what paints a broad band per turn. */
const ACROSS = FOV_ALONG_RAD;   // 1.7 deg, parallel to the spin axis
const ALONG = FOV_ACROSS_RAD;   // 0.6 deg, along the direction of travel

const BEAM_LENGTH = 120;

const BEAM_VERT = /* glsl */ `
  varying float vT;      // 0 at the spacecraft, 1 at the far end
  varying vec2 vUvB;
  void main() {
    vT = uv.y;
    vUvB = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  varying vec2 vUvB;
  void main() {
    // Bright at the aperture, fading out along the beam: a searchlight in vacuum has
    // nothing to scatter off, so a uniform slab would look like a solid object.
    float lengthFade = pow(1.0 - vT, 1.6);
    // Soft edges across the beam so it does not read as a hard-edged polygon.
    float edge = smoothstep(0.0, 0.22, vUvB.x) * smoothstep(1.0, 0.78, vUvB.x);
    gl_FragColor = vec4(uColor, lengthFade * edge * uOpacity * 0.5);
  }
`;

/** One field of view, as a flat wedge whose opening angle is the real FOV. */
function makeBeam(color: number, halfAngle: number): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const spread = Math.tan(halfAngle) * BEAM_LENGTH;
  // A quad from a near sliver to the full angular width at the far end.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.4, 0, 0, 0.4, 0, 0, -spread, 0, -BEAM_LENGTH, spread, 0, -BEAM_LENGTH,
  ], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geo.setIndex([0, 2, 1, 1, 2, 3]);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { mesh: new THREE.Mesh(geo, mat), mat };
}

export interface SurveyRig {
  /** Holds the spacecraft and both beams; oriented by the scanning law. */
  group: THREE.Group;
  /** Sphere showing which parts of the sky have been observed. */
  coverage: THREE.Mesh;
  /**
   * Advance the mission clock to `days` and paint everything observed since the
   * previous call. Returns diagnostics for the HUD.
   */
  update: (days: number) => { coveredFraction: number; revolutions: number };
  setBeamOpacity: (v: number) => void;
  setCoverageOpacity: (v: number) => void;
  reset: () => void;
  dispose: () => void;
}

const COVERAGE_W = 512;
const COVERAGE_H = 256;

const COVERAGE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying vec2 vUvC;
  void main() {
    float c = texture2D(uMap, vUvC).r;
    if (c <= 0.001) discard;
    // Number of visits -> colour. One pass is faint; the deep-coverage regions near
    // the ecliptic poles saturate. This is a real feature of the scanning law, not a
    // shading choice: the 45 degree solar aspect angle over-samples two caps.
    vec3 cold = vec3(0.16, 0.42, 0.85);
    vec3 warm = vec3(1.0, 0.86, 0.45);
    vec3 col = mix(cold, warm, smoothstep(0.25, 1.0, c));
    // Alpha stays proportional to visit count instead of saturating.
    //
    // Clamping it high meant that once the mission neared full coverage every texel
    // sat at maximum alpha in a warm colour, and additive blending turned the entire
    // sky into a flat olive wash that buried the spacecraft. The scan tracks have to
    // stay readable as tracks right to the end of the mission.
    gl_FragColor = vec4(col, c * uOpacity * 0.30);
  }
`;

const COVERAGE_VERT = /* glsl */ `
  varying vec2 vUvC;
  void main() {
    vUvC = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function makeSurvey(gaia: THREE.Object3D | null, radius = 300): SurveyRig {
  const group = new THREE.Group();

  // --- spacecraft + beams --------------------------------------------------
  // Nested frames, one per motion, so each rate is set independently and none of
  // them can silently contaminate another.
  const axisFrame = new THREE.Group();   // orients the spin axis
  const spinner = new THREE.Group();     // the 6-hour rotation
  axisFrame.add(spinner);
  group.add(axisFrame);

  if (gaia) spinner.add(gaia);

  // Both boresights lie in the plane perpendicular to the spin axis (local XZ),
  // separated by the basic angle.
  const leading = makeBeam(0x66ccff, ALONG / 2);
  const trailing = makeBeam(0xffa860, ALONG / 2);
  const lead = new THREE.Group();
  const trail = new THREE.Group();
  lead.add(leading.mesh);
  trail.add(trailing.mesh);
  trail.rotation.y = BASIC_ANGLE_RAD;
  spinner.add(lead, trail);

  // --- coverage sphere -----------------------------------------------------
  const data = new Uint8Array(COVERAGE_W * COVERAGE_H);
  const tex = new THREE.DataTexture(data, COVERAGE_W, COVERAGE_H, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;

  const covMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uOpacity: { value: 0 } },
    vertexShader: COVERAGE_VERT,
    fragmentShader: COVERAGE_FRAG,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const coverage = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), covMat);
  coverage.frustumCulled = false;
  coverage.renderOrder = -400;

  // --- painting ------------------------------------------------------------
  const _axis = new THREE.Vector3();
  const _bore = new THREE.Vector3();
  const _e1 = new THREE.Vector3();
  const _p = new THREE.Vector3();

  let lastDays = 0;
  let painted = 0;

  /** Mark one direction on the coverage map, with the across-scan extent. */
  function paint(dir: THREE.Vector3, axis: THREE.Vector3): void {
    // Across-scan is parallel to the spin axis, so the field sweeps a band of
    // ACROSS radians centred on the boresight, in that direction.
    const steps = 2;
    for (let k = -steps; k <= steps; k++) {
      const a = (k / steps) * (ACROSS / 2);
      _p.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(axis, Math.sin(a)).normalize();

      const lon = Math.atan2(_p.z, _p.x);
      const lat = Math.asin(THREE.MathUtils.clamp(_p.y, -1, 1));
      const u = ((lon / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
      const v = lat / Math.PI + 0.5;

      const ix = Math.min(COVERAGE_W - 1, Math.max(0, Math.floor(u * COVERAGE_W)));
      const iy = Math.min(COVERAGE_H - 1, Math.max(0, Math.floor(v * COVERAGE_H)));
      const idx = iy * COVERAGE_W + ix;
      if (data[idx] === 0) painted++;
      // Saturating add: the value is a visit count, and the shader maps repeat
      // visits to a warmer colour.
      data[idx] = Math.min(255, data[idx] + 4);
    }
  }

  const _e2 = new THREE.Vector3();

  function update(days: number) {
    const d = Math.max(0, days);

    // One step per revolution, and each step paints a whole great circle.
    //
    // The first version of this sampled the boresight direction at four instants per
    // revolution and painted those points. That is not what the instrument does: in
    // one six-hour turn the fields sweep a *complete* great circle. Painting four
    // dots left the sky 22% covered after the full mission when the real answer is
    // essentially all of it, and the map showed drifting speckle instead of scan
    // tracks. Both fields lie in the same plane perpendicular to the spin axis, so
    // one circle per revolution covers both of them.
    const perStep = SPIN_PERIOD_S / 86400;   // 0.25 days
    const raw = Math.ceil((d - lastDays) / perStep);
    // Capped so a long seek cannot lock the main thread painting years in one frame.
    const steps = Math.max(0, Math.min(600, raw));

    for (let i = 1; i <= steps; i++) {
      const t = lastDays + ((d - lastDays) * i) / steps;
      const ax = spinAxis(t);
      _axis.set(ax[0], ax[1], ax[2]).normalize();

      // Any vector perpendicular to the axis works as the phase origin; the choice
      // only rotates where the circle starts, not which sky it covers.
      _e1.set(0, 1, 0);
      if (Math.abs(_axis.y) > 0.95) _e1.set(1, 0, 0);
      _e1.crossVectors(_axis, _e1).normalize();
      _e2.crossVectors(_axis, _e1);

      // 1 degree along the circle: finer than the 0.7 degree texel, so the painted
      // band is continuous rather than dotted.
      for (let a = 0; a < 360; a++) {
        const ph = (a * Math.PI) / 180;
        _bore.copy(_e1).multiplyScalar(Math.cos(ph)).addScaledVector(_e2, Math.sin(ph));
        paint(_bore, _axis);
      }
    }

    if (steps > 0) tex.needsUpdate = true;
    lastDays = d;

    // Orient the rig itself to the same law.
    const ax = spinAxis(d);
    _axis.set(ax[0], ax[1], ax[2]).normalize();
    // The rig is authored with the spin axis along local +Y.
    axisFrame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _axis);
    spinner.rotation.y = spinPhase(d);

    return {
      coveredFraction: painted / (COVERAGE_W * COVERAGE_H),
      revolutions: (d * 86400) / (6 * 3600),
    };
  }

  return {
    group,
    coverage,
    update,
    setBeamOpacity: (v) => {
      leading.mat.uniforms.uOpacity.value = v;
      trailing.mat.uniforms.uOpacity.value = v;
      lead.visible = v > 0.01;
      trail.visible = v > 0.01;
    },
    setCoverageOpacity: (v) => {
      covMat.uniforms.uOpacity.value = v;
      coverage.visible = v > 0.01;
    },
    reset: () => {
      data.fill(0);
      painted = 0;
      lastDays = 0;
      tex.needsUpdate = true;
    },
    dispose: () => {
      tex.dispose();
      covMat.dispose();
      leading.mat.dispose();
      trailing.mat.dispose();
    },
  };
}

/** Mission progress as a fraction, for the HUD readout. */
export function missionFraction(days: number): number {
  return Math.min(1, days / MISSION_DAYS);
}
