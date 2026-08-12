/**
 * The Lagrange-point geometry for Shot 1.
 *
 * The centrepiece is a contour map of the effective potential in the co-rotating
 * frame. It is computed, not drawn: marching squares over a grid of the real
 * restricted-three-body potential with the real Sun/Earth mass ratio. The saddles
 * open exactly where L1 and L2 are, because they *are* L1 and L2.
 *
 * Why this runs on the CPU
 * ------------------------
 * Omega(L1) = 1.500448961 and Omega(L2) = 1.500446935. The whole story lives in the
 * 2e-6 gap between them - a relative difference of 1.4e-6. float32 carries about
 * 7 significant digits, so in a fragment shader both values quantise to the same
 * number and the two saddles merge into one meaningless blob. JavaScript numbers are
 * float64 (about 16 digits), which resolves the gap with ten digits to spare.
 *
 * So: contour on the CPU at float64, upload the resulting line segments. It runs
 * once during the preload and costs a few milliseconds.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import {
  AU_KM, KM, LAGRANGE, LISSAJOUS_A_KM, LISSAJOUS_B_KM, MU,
  effectivePotential, L2,
} from "../astro";

const EARTH_X = 1 - MU;

/** Co-rotating normalised coords -> world units (1000 km), Earth at the origin. */
function toWorld(x: number, y: number): [number, number, number] {
  return [(x - EARTH_X) * AU_KM * KM, 0, y * AU_KM * KM];
}

/**
 * Marching squares on a scalar field.
 *
 * Returns flat [x1,y1,x2,y2,...] segment pairs in grid coordinates. Only the two
 * unambiguous four-cases are special: the saddle configurations (5 and 10) are
 * resolved with the cell-centre average, which is what stops contours from
 * cross-connecting right where we most care about them - at a saddle point.
 */
function marchingSquares(
  field: Float64Array, nx: number, ny: number, level: number,
): number[] {
  const out: number[] = [];
  const at = (i: number, j: number) => field[j * nx + i];

  // Linear interpolation along a cell edge to find where the level is crossed.
  const lerp = (a: number, b: number) => (level - a) / (b - a);

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = at(i, j + 1), tr = at(i + 1, j + 1);
      const bl = at(i, j), br = at(i + 1, j);
      if (!isFinite(tl) || !isFinite(tr) || !isFinite(bl) || !isFinite(br)) continue;

      let code = 0;
      if (bl > level) code |= 1;
      if (br > level) code |= 2;
      if (tr > level) code |= 4;
      if (tl > level) code |= 8;
      if (code === 0 || code === 15) continue;

      // Crossing points on each edge, in cell-local [0,1] coordinates.
      const B: [number, number] = [i + lerp(bl, br), j];
      const R: [number, number] = [i + 1, j + lerp(br, tr)];
      const T: [number, number] = [i + lerp(tl, tr), j + 1];
      const L: [number, number] = [i, j + lerp(bl, tl)];

      const push = (a: [number, number], b: [number, number]) =>
        out.push(a[0], a[1], b[0], b[1]);

      switch (code) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(R, T); break;
        case 6: case 9:  push(B, T); break;
        case 7: case 8:  push(L, T); break;
        case 5: case 10: {
          // Ambiguous cell. The centre value decides which way the contour turns;
          // guessing here is exactly what produces spurious X shapes at saddles.
          const centre = (tl + tr + bl + br) / 4;
          const flip = code === 5 ? centre > level : centre <= level;
          if (flip) { push(L, T); push(B, R); } else { push(L, B); push(T, R); }
          break;
        }
      }
      void 0;
    }
  }
  return out;
}

export interface LagrangeRig {
  group: THREE.Group;
  contours: LineSegments2;
  /** World-space anchors for the DOM labels. */
  anchors: { id: string; text: string; sub: string; position: THREE.Vector3 }[];
  setOpacity: (contours: number, markers: number) => void;
  setResolution: (w: number, h: number) => void;
  dispose: () => void;
}

/**
 * Contour map of the effective potential over a window around the Earth.
 *
 * `halfWidthAu` spans roughly +/-0.03 AU by default, which comfortably contains both
 * collinear saddles (they sit at +/-0.01 AU) with room for the closed curves outside.
 */
export function makeLagrangeField(halfWidthAu = 0.03, n = 420): LagrangeRig {
  const group = new THREE.Group();

  // --- sample the potential ------------------------------------------------
  const field = new Float64Array(n * n);
  const x0 = EARTH_X - halfWidthAu;
  const y0 = -halfWidthAu;
  const step = (2 * halfWidthAu) / (n - 1);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const y = y0 + j * step;
      // Blank a small disc around the Earth: the potential diverges there, and an
      // infinite value would drag every contour level into the same few cells.
      const r = Math.hypot(x - EARTH_X, y);
      field[j * n + i] = r < 4e-4 ? NaN : effectivePotential(x, y);
    }
  }

  // --- pick levels from the physics, not by eye ----------------------------
  // Everything is expressed as a multiple of the L1-L2 saddle gap, so the spacing
  // automatically follows the structure instead of needing hand tuning.
  const c1 = effectivePotential(LAGRANGE[0].x, 0);
  const c2 = effectivePotential(L2.x, 0);
  const gap = c1 - c2;
  const steps = [-14, -8, -4.5, -2, -0.7, 0, 0.6, 1, 1.5, 2.6, 5, 9, 16, 28];

  const positions: number[] = [];
  const colors: number[] = [];
  const near = new THREE.Color(0x5fd0ff);   // close to the saddles - the ones that matter
  const far = new THREE.Color(0x1d3a5c);    // context

  for (const s of steps) {
    const level = c2 + s * gap;
    const segs = marchingSquares(field, n, n, level);
    // Highlight the two contours that pass through the saddles themselves.
    const isSaddle = s === 0 || Math.abs(s - 1) < 1e-9;
    const col = isSaddle ? new THREE.Color(0x9fe8ff) : near.clone().lerp(far, Math.min(1, Math.abs(s) / 12));

    for (let k = 0; k < segs.length; k += 4) {
      const ax = x0 + segs[k] * step;
      const ay = y0 + segs[k + 1] * step;
      const bx = x0 + segs[k + 2] * step;
      const by = y0 + segs[k + 3] * step;
      positions.push(...toWorld(ax, ay), ...toWorld(bx, by));
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }
  }

  const geo = new LineSegmentsGeometry();
  geo.setPositions(positions);
  geo.setColors(colors);

  const mat = new LineMaterial({
    linewidth: 1.4,          // in pixels - LineMaterial resolves this against `resolution`
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const contours = new LineSegments2(geo, mat);
  contours.computeLineDistances();
  contours.frustumCulled = false;
  group.add(contours);

  // --- the five points -----------------------------------------------------
  const markerGeo = new THREE.BufferGeometry();
  const mpos: number[] = [];
  const mstable: number[] = [];
  const anchors: LagrangeRig["anchors"] = [];

  for (const p of LAGRANGE) {
    const w = toWorld(p.x, p.y);
    mpos.push(...w);
    mstable.push(p.stable ? 1 : 0);
    const sub = p.fromEarthKm !== null
      ? `${(Math.abs(p.fromEarthKm) / 1e6).toFixed(2)} million km`
      : p.stable ? "stable" : "unstable";
    anchors.push({ id: p.id, text: p.id, sub, position: new THREE.Vector3(...w) });
  }
  markerGeo.setAttribute("position", new THREE.Float32BufferAttribute(mpos, 3));
  markerGeo.setAttribute("aStable", new THREE.Float32BufferAttribute(mstable, 1));

  const markerMat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aStable;
      uniform float uPixelRatio;
      varying float vStable;
      void main() {
        vStable = aStable;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (aStable > 0.5 ? 17.0 : 21.0) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uOpacity;
      varying float vStable;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float r = length(p) * 2.0;
        if (r > 1.0) discard;
        // Unstable points get a ring, stable ones a filled dot. A viewer can read
        // the difference without the legend, and it is a real physical distinction:
        // L4/L5 collect material, L1/L2/L3 need station-keeping to stay put.
        float shape = vStable > 0.5
          ? smoothstep(0.55, 0.25, r)
          : smoothstep(0.95, 0.75, r) * smoothstep(0.45, 0.62, r);
        vec3 col = vStable > 0.5 ? vec3(0.55, 1.0, 0.75) : vec3(1.0, 0.80, 0.42);
        gl_FragColor = vec4(col * shape, shape * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const markers = new THREE.Points(markerGeo, markerMat);
  markers.frustumCulled = false;
  markers.renderOrder = 950;
  group.add(markers);

  return {
    group,
    contours,
    anchors,
    setOpacity: (c, m) => {
      // Scaled down hard. Contour levels crowd together near a saddle - that is what
      // a saddle *is* - so at full opacity the two most important regions in the
      // frame additively blow out to solid white and lose the very structure they are
      // there to show. 0.5 keeps the crowding legible as crowding.
      mat.opacity = c * 0.5;
      markerMat.uniforms.uOpacity.value = m;
      contours.visible = c > 0.01;
      markers.visible = m > 0.01;
    },
    setResolution: (w, h) => mat.resolution.set(w, h),
    dispose: () => {
      geo.dispose(); mat.dispose(); markerGeo.dispose(); markerMat.dispose();
    },
  };
}

/** A closed ring in the ecliptic plane, as a fat line. */
export function makeRing(
  radiusUnits: number, color: number, segments = 512, linewidth = 1.2,
): { line: Line2; material: LineMaterial } {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radiusUnits, 0, Math.sin(a) * radiusUnits);
  }
  const geo = new LineSegmentsGeometry();
  const segs: number[] = [];
  for (let i = 0; i < segments; i++) {
    segs.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2],
              pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]);
  }
  geo.setPositions(segs);
  const material = new LineMaterial({
    color, linewidth, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const line = new LineSegments2(geo, material) as unknown as Line2;
  line.frustumCulled = false;
  return { line, material };
}

/**
 * Gaia's actual orbit: a Lissajous figure around L2, 340,000 x 90,000 km, 180-day
 * period. Worth drawing because it answers the obvious question - why isn't the
 * spacecraft in Earth's shadow? It never goes near it. The orbit is wider than the
 * umbra, so Gaia sits in permanent sunlight and its shade comes from the sunshield.
 */
export function makeLissajous(
  color = 0x7ab4ff, segments = 400,
): { line: Line2; material: LineMaterial; sample: (phase: number) => THREE.Vector3 } {
  const a = LISSAJOUS_A_KM * KM;
  const b = LISSAJOUS_B_KM * KM;
  const l2x = L2.fromEarthKm! * KM;

  // In-plane and out-of-plane motion at the same period but a quarter-cycle apart,
  // which is what makes the projected path an ellipse rather than a line.
  const at = (p: number) =>
    new THREE.Vector3(
      l2x + b * Math.sin(p) * 0.35,
      b * Math.sin(p + Math.PI / 2),
      a * Math.cos(p),
    );

  const segs: number[] = [];
  for (let i = 0; i < segments; i++) {
    const p0 = at((i / segments) * Math.PI * 2);
    const p1 = at(((i + 1) / segments) * Math.PI * 2);
    segs.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
  }
  const geo = new LineSegmentsGeometry();
  geo.setPositions(segs);
  const material = new LineMaterial({
    color, linewidth: 1.3, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const line = new LineSegments2(geo, material) as unknown as Line2;
  line.frustumCulled = false;
  return { line, material, sample: at };
}
